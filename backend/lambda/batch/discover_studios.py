"""
discover_studios.py

Google Places API を使って新しいレンタルスタジオ（ダンス・ヨガ）候補を探索し、
Studios テーブルに自動追加するバッチ処理。

釣行AIアプリ（fishing-ai-app）の discover_spots.py と同じ設計思想:
run_discovery() が中核ロジックで、2つの経路から呼ばれる:
    1. generate_studio_score.py の handler（「AI分析を実行」）から、位置指定なしで毎回呼ばれる
       （日本国内を広くカバーする固定キーワード検索）
    2. POST /admin/run-studio-discovery（フロントの「現在地から探す」ボタン）から、
       ユーザーの現在地（lat/lng）を指定して呼ばれる（現在地周辺に絞った検索）

背景:
    実在の場所データを使うため、LLMにスタジオ名や座標を直接生成させるのではなく、
    Google Places API のテキスト検索結果（実POIデータ）のみを候補として採用する。
    Claude は座標や実在性に関わらない付随情報（想定される設備）の推測にのみ使う。

Requirements:
    - 環境変数 STUDIOS_TABLE が設定済みであること
    - SSM パラメータ /studio-search/google-places-api-key が登録済みであること
    - Lambda 実行ロールに SSM 読み取り・DynamoDB 読み書き権限があること
"""

import json
import os
import math
import random
import re
import urllib.request
from decimal import Decimal
from typing import Any, Optional
from urllib.parse import quote

import anthropic

from batch_common import http_get_json, http_get_bytes, get_table, get_ssm_parameter, s3

PLACES_TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
PLACES_NEARBY_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
PLACES_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
PLACES_PHOTO_URL = "https://maps.googleapis.com/maps/api/place/photo"
# TOP3ヒーロー写真として使うため、そこそこの解像度を確保しつつ転送量を抑える
PLACES_PHOTO_MAX_WIDTH = 800

# 公式サイトの料金ページ取得は外部サイト（応答速度が読めない）が対象のため、
# Places/Claude API向けのEXTERNAL_API_TIMEOUT_SEC（5秒）より少し長めに待つ
WEBSITE_FETCH_TIMEOUT_SEC = 8
# Claudeへの入力トークンを抑えるため、取得したHTMLはこの文字数までで切り詰める
WEBSITE_TEXT_MAX_CHARS = 8000

# 収容人数の目安（Claudeへの推測プロンプトと選択肢を一致させる）。
# 実データが無いための推測にすぎないため、3段階の大まかな区分に留める
CAPACITY_CATEGORIES = ["少人数向け（〜5人）", "小グループ向け（6〜10人）", "中〜大人数対応（11人〜）"]
DEFAULT_CAPACITY_CATEGORY = CAPACITY_CATEGORIES[1]

# ユーザー投稿・スタジオ写真のアップロード先（presignUploadHandler等と共通のバケット）
UPLOADS_BUCKET = os.environ.get("UPLOADS_BUCKET", "")

# SSMパラメータ名は "/"を含む階層型のため先頭スラッシュ必須（AWSの仕様）
GOOGLE_PLACES_API_KEY_PARAM = "/studio-search/google-places-api-key"
ANTHROPIC_API_KEY_PARAM = "/studio-search/anthropic-api-key"

# Claude Haiku（低コスト・高速なモデル）を使用
CLAUDE_MODEL = "claude-haiku-4-5-20251001"

STUDIOS_TABLE = os.environ.get("STUDIOS_TABLE", "studio-studios")

# 位置指定なし（全国探索）時の検索キーワード
NATIONWIDE_QUERIES = ["ダンススタジオ レンタル", "ヨガスタジオ レンタル", "レンタルスタジオ 鏡張り"]
# 現在地指定あり（近傍探索）時の検索キーワード。位置バイアスで絞り込むためクエリは単純でよい
NEARBY_QUERY = "レンタルスタジオ"
# 現在地指定時の検索半径（メートル）
NEARBY_RADIUS_M = 15000

# 基準地点（東京駅）。位置指定なしの場合の distanceKm 算出に使用。
# フロントの MapPage.tsx の DEFAULT_CENTER と一致させている
DEFAULT_BASE_LAT = 35.681
DEFAULT_BASE_LNG = 139.767

# 重複とみなす距離のしきい値（メートル）
DUPLICATE_THRESHOLD_M = 300

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
}


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """2点間の距離をhaversine公式でkm単位で算出する。"""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def search_places(query: str, api_key: str, location_bias: Optional[dict[str, float]] = None) -> list[dict[str, Any]]:
    """Google Places API Text Search で候補地点を検索する。

    Args:
        query         (str): 検索クエリ（例: "ダンススタジオ レンタル"）
        api_key       (str): Google Places API キー
        location_bias (dict, optional): {"lat": ..., "lng": ...} が指定された場合、
            NEARBY_RADIUS_M 以内の近傍検索として絞り込む

    Returns:
        list[dict[str, Any]]: 検索結果（name / lat / lng / address / rating /
            user_ratings_total / photo_reference を含む辞書のリスト）。
            APIエラー時は空リストを返しバッチ全体は継続させる。
    """
    try:
        # http_get_json は値をそのまま連結する（URLエンコードしない）ため、
        # 日本語クエリはここで事前に percent-encode する
        params = {
            "query": quote(query),
            "region": "jp",
            "language": "ja",
            "key": api_key,
        }
        if location_bias:
            params["location"] = f"{location_bias['lat']},{location_bias['lng']}"
            params["radius"] = str(NEARBY_RADIUS_M)

        data = http_get_json(PLACES_TEXT_SEARCH_URL, params)
        if data.get("status") not in ("OK", "ZERO_RESULTS"):
            print(f"Places API non-OK status for '{query}': {data.get('status')}")
            return []

        results = []
        for r in data.get("results", []):
            loc = r.get("geometry", {}).get("location", {})
            if "lat" not in loc or "lng" not in loc:
                continue
            photos = r.get("photos") or []
            results.append({
                "name": r.get("name", "名称不明"),
                "lat": float(loc["lat"]),
                "lng": float(loc["lng"]),
                "address": r.get("formatted_address", ""),
                "types": r.get("types", []),
                "rating": r.get("rating"),
                "user_ratings_total": r.get("user_ratings_total"),
                # スタジオ写真の自動取得に使う。候補に写真が無ければNone
                "photo_reference": photos[0].get("photo_reference") if photos else None,
                # 公式サイトURL取得（Place Details）・料金推定に使う
                "place_id": r.get("place_id"),
            })
        return results

    except Exception as e:
        print(f"Places API error for '{query}': {e}")
        return []


def fetch_and_store_place_photo(photo_reference: str, studio_id: str, places_key: str) -> str | None:
    """Google Places Photo APIでスタジオ写真を取得し、S3（UploadsBucket）へアップロードする。

    Args:
        photo_reference (str): search_places() が返す候補のphoto_reference
        studio_id       (str): アップロード先キーに使うスタジオID
        places_key      (str): Google Places API キー

    Returns:
        str | None: アップロードした写真の公開URL。取得・アップロードに失敗した場合はNone
            （呼び出し側はNoneのままimageUrlを設定せず、バッチ全体は継続させる）
    """
    if not UPLOADS_BUCKET:
        return None

    try:
        image_bytes = http_get_bytes(PLACES_PHOTO_URL, {
            "maxwidth": str(PLACES_PHOTO_MAX_WIDTH),
            "photo_reference": photo_reference,
            "key": places_key,
        })
        key = f"studio-photos/{studio_id}.jpg"
        s3.put_object(Bucket=UPLOADS_BUCKET, Key=key, Body=image_bytes, ContentType="image/jpeg")
        return f"https://{UPLOADS_BUCKET}.s3.{os.environ.get('AWS_REGION', 'ap-northeast-1')}.amazonaws.com/{key}"

    except Exception as e:
        print(f"Place photo fetch/upload error for studio {studio_id}: {e}")
        return None


def guess_facilities(studio_name: str, address: str, api_key: str) -> list[str]:
    """Claude APIでスタジオ名・住所から想定される設備を推測する。

    APIキー未設定時・エラー時は汎用デフォルトを返し、バッチを継続させる。

    Args:
        studio_name (str): スタジオ名
        address     (str): 住所
        api_key     (str): Anthropic API キー

    Returns:
        list[str]: 推測された設備リスト（3〜5種、例: 鏡張り・フローリング・音響設備）
    """
    default_facilities = ["鏡張り", "フローリング"]
    if not api_key:
        return default_facilities

    try:
        client = anthropic.Anthropic(api_key=api_key)
        prompt = f"""次のレンタルスタジオで一般的に備わっていそうな設備を3〜5個、日本語の単語のみ
カンマ区切りで答えてください（例: 鏡張り, フローリング, 音響設備, 更衣室, シャワー）。
前置き・説明は不要です。

スタジオ名: {studio_name}（{address}）"""
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=100,
            messages=[{"role": "user", "content": prompt}],
        )
        facilities = [f.strip() for f in response.content[0].text.strip().split(",") if f.strip()]
        return facilities[:5] if facilities else default_facilities

    except Exception as e:
        print(f"Claude facility guess error: {e}")
        return default_facilities


def guess_capacity(studio_name: str, address: str, api_key: str) -> str:
    """Claude APIでスタジオ名・住所から収容人数の目安を推測する。

    Google Places APIには収容人数のデータが無いため、店名から受ける印象での
    大まかな推測にすぎない（guess_facilities()と同じ位置づけのヒューリスティック）。
    APIキー未設定時・エラー時・想定外の応答時はデフォルト区分を返し、バッチを継続させる。

    Args:
        studio_name (str): スタジオ名
        address     (str): 住所
        api_key     (str): Anthropic API キー

    Returns:
        str: CAPACITY_CATEGORIES のいずれか1つ
    """
    if not api_key:
        return DEFAULT_CAPACITY_CATEGORY

    try:
        client = anthropic.Anthropic(api_key=api_key)
        options = "\n".join(f"- {c}" for c in CAPACITY_CATEGORIES)
        prompt = f"""次のレンタルスタジオの収容人数の目安を、以下の選択肢から1つだけ選んで
その文字列をそのまま出力してください。前置き・説明は不要です。

選択肢:
{options}

スタジオ名: {studio_name}（{address}）"""
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=50,
            messages=[{"role": "user", "content": prompt}],
        )
        answer = response.content[0].text.strip()
        return answer if answer in CAPACITY_CATEGORIES else DEFAULT_CAPACITY_CATEGORY

    except Exception as e:
        print(f"Claude capacity guess error: {e}")
        return DEFAULT_CAPACITY_CATEGORY


def find_nearest_station_distance_m(lat: float, lng: float, api_key: str) -> Optional[int]:
    """Google Places Nearby Searchで最寄り駅を探し、スタジオからの距離（メートル）を返す。

    rankby=distance を使うため radius は指定できない（Places APIの仕様）。
    結果は距離順で返るため先頭が最寄り駅になる。

    Args:
        lat     (float): スタジオの緯度
        lng     (float): スタジオの経度
        api_key (str): Google Places API キー

    Returns:
        int | None: 最寄り駅までの距離（メートル、四捨五入）。取得失敗・駅が
            見つからない場合はNone（呼び出し側はスコア計算で中立値にフォールバックする）
    """
    try:
        data = http_get_json(PLACES_NEARBY_SEARCH_URL, {
            "location": f"{lat},{lng}",
            "type": "train_station",
            "rankby": "distance",
            "key": api_key,
        })
        if data.get("status") != "OK":
            return None
        results = data.get("results", [])
        if not results:
            return None
        loc = results[0].get("geometry", {}).get("location", {})
        if "lat" not in loc or "lng" not in loc:
            return None
        return round(haversine_km(lat, lng, loc["lat"], loc["lng"]) * 1000)

    except Exception as e:
        print(f"Nearest station lookup error: {e}")
        return None


def fetch_place_website(place_id: str, api_key: str) -> Optional[str]:
    """Google Places Details APIでスタジオの公式サイトURLを取得する。

    Args:
        place_id (str): search_places() が返す候補のplace_id
        api_key  (str): Google Places API キー

    Returns:
        str | None: 公式サイトURL。未登録・取得失敗の場合はNone
    """
    try:
        data = http_get_json(PLACES_DETAILS_URL, {
            "place_id": place_id,
            "fields": "website",
            "key": api_key,
        })
        if data.get("status") != "OK":
            return None
        return data.get("result", {}).get("website") or None

    except Exception as e:
        print(f"Place details (website) error: {e}")
        return None


def scrape_price_from_website(website_url: str, api_key: str) -> Optional[int]:
    """スタジオの公式サイトを取得し、Claudeで利用料金（円/時間）の抽出を試みる。

    実在しない金額を作り出さないよう、Claudeには「サイト内に明記されていなければ
    "不明" とだけ答える」よう指示する。サイト取得失敗・Claude未設定・"不明"回答・
    数値として解釈できない応答の場合はすべてNoneを返し、呼び出し側は「問合せ」表示に
    フォールバックする（実データが無いことを偽の数値で埋めないための設計）。

    Args:
        website_url (str): スタジオの公式サイトURL
        api_key     (str): Anthropic API キー

    Returns:
        int | None: 抽出できた場合は概算の円/時間。それ以外はNone
    """
    if not api_key:
        return None

    try:
        req = urllib.request.Request(website_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=WEBSITE_FETCH_TIMEOUT_SEC) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"Website fetch error ({website_url}): {e}")
        return None

    # script/style タグの中身はノイズになるだけなので簡易的に除去してから切り詰める
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    text = text[:WEBSITE_TEXT_MAX_CHARS]

    try:
        client = anthropic.Anthropic(api_key=api_key)
        prompt = f"""以下はレンタルスタジオ公式サイトのHTMLの抜粋です。
1時間あたりの利用料金が明記されていれば、その金額を円単位の数字のみで出力してください
（例: 3000）。複数プランがある場合は最も標準的な/安いプランの金額にしてください。
サイト内に料金が明記されていない、または読み取れない場合は "不明" とだけ出力してください。
数字か「不明」以外は出力しないでください。

HTML抜粋:
{text}"""
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=20,
            messages=[{"role": "user", "content": prompt}],
        )
        answer = response.content[0].text.strip()
        return int(answer) if answer.isdigit() else None

    except Exception as e:
        print(f"Claude price extraction error: {e}")
        return None


def run_discovery(location_bias: Optional[dict[str, float]] = None) -> dict[str, Any]:
    """新規レンタルスタジオ候補を探索し、Studios テーブルに追加する中核ロジック。

    generate_studio_score.py の handler（位置指定なし）と、
    POST /admin/run-studio-discovery（現在地指定あり）の両方から呼ばれる。
    既存スタジオと近傍（300m以内）の候補は重複として除外する。

    Args:
        location_bias (dict, optional): {"lat": ..., "lng": ...}。
            指定時は現在地周辺（NEARBY_RADIUS_M以内）に絞った検索を行う。
            未指定時は全国向けの固定キーワードで検索する。

    Returns:
        dict[str, Any]: {"status": "completed"|"skipped", "addedCount": int, "skippedCount": int, "message"?: str}
    """
    places_key = get_ssm_parameter(GOOGLE_PLACES_API_KEY_PARAM)
    if not places_key:
        return {"status": "skipped", "message": "Google Places API key not configured", "addedCount": 0, "skippedCount": 0}

    studios_table = get_table(STUDIOS_TABLE)
    existing_studios: list[dict[str, Any]] = studios_table.scan()["Items"]
    existing_coords = [(float(s.get("lat", 0)), float(s.get("lng", 0))) for s in existing_studios]

    queries = [NEARBY_QUERY] if location_bias else NATIONWIDE_QUERIES

    # 複数クエリの結果を集約し、クエリ間の重複も除去する
    candidates: dict[str, dict[str, Any]] = {}
    for query in queries:
        for c in search_places(query, places_key, location_bias):
            key = f"{c['lat']:.5f},{c['lng']:.5f}"
            candidates.setdefault(key, c)

    anthropic_key = get_ssm_parameter(ANTHROPIC_API_KEY_PARAM)
    base_lat = location_bias["lat"] if location_bias else DEFAULT_BASE_LAT
    base_lng = location_bias["lng"] if location_bias else DEFAULT_BASE_LNG
    added, skipped = 0, 0

    for c in candidates.values():
        # 既存スタジオと近傍（300m以内）なら重複とみなしてスキップ
        is_duplicate = any(
            haversine_km(c["lat"], c["lng"], elat, elng) * 1000 < DUPLICATE_THRESHOLD_M
            for elat, elng in existing_coords
        )
        if is_duplicate:
            skipped += 1
            continue

        # distanceKm は基準地点（東京 or 現在地）からの距離。スコア式には使わなくなったが、
        # フロントの「現在地から探す」機能（recalcScoreForDistance）が距離ベースの
        # 再ランキングに使い続けるため、これまでどおり算出・保存する
        distance_km = haversine_km(base_lat, base_lng, c["lat"], c["lng"])
        facility_tags = guess_facilities(c["name"], c["address"], anthropic_key)
        capacity_category = guess_capacity(c["name"], c["address"], anthropic_key)

        # 新しく見つかった候補にのみ発生する追加コスト（Places Nearby Search /
        # Place Details / 外部サイト取得 / Claude呼び出し2回）。既存スタジオは
        # 重複判定で上のcontinueにより到達しないため、スタジオ1件あたり1回きりで済む
        nearest_station_m = find_nearest_station_distance_m(c["lat"], c["lng"], places_key)

        cost_yen = 0
        place_id = c.get("place_id")
        if place_id:
            website = fetch_place_website(place_id, places_key)
            if website:
                scraped_price = scrape_price_from_website(website, anthropic_key)
                if scraped_price is not None:
                    cost_yen = scraped_price

        studio_id = f"studio-{random.getrandbits(32):08x}"

        # スタジオ写真の自動取得。候補に写真が無い/取得失敗時はimageUrlを設定しない
        image_url = None
        if c.get("photo_reference"):
            image_url = fetch_and_store_place_photo(c["photo_reference"], studio_id, places_key)

        studios_table.put_item(Item={
            "studioId": studio_id,
            "name": c["name"],
            "lat": Decimal(str(c["lat"])),
            "lng": Decimal(str(c["lng"])),
            "facilityTags": facility_tags,
            "capacityCategory": capacity_category,
            "distanceKm": Decimal(str(round(distance_km, 1))),
            "nearestStationDistanceM": nearest_station_m if nearest_station_m is not None else None,
            "costYen": Decimal(str(cost_yen)),
            "description": c["address"],
            "imageUrl": image_url or "",
            "rating": Decimal(str(c["rating"])) if c.get("rating") is not None else None,
            "userRatingsTotal": int(c["user_ratings_total"]) if c.get("user_ratings_total") is not None else 0,
            # 既存データの再取得（バックフィル）でPlace Detailsを直接引けるように保存しておく
            "placeId": place_id,
        })
        # 次の候補との重複判定にも反映させる
        existing_coords.append((c["lat"], c["lng"]))
        added += 1
        print(f"  Added: {c['name']} ({c['address']})")

    return {"status": "completed", "addedCount": added, "skippedCount": skipped}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """POST /admin/run-studio-discovery（adminRunStudioDiscovery経由）のエントリーポイント。

    「現在地から探す」ボタンから呼ばれ、event に lat/lng が含まれていれば
    現在地周辺に絞った検索を、含まれていなければ全国向けの検索を行う。

    Args:
        event   (dict[str, Any]): Lambda イベント。lat (float) / lng (float) を含み得る
        context (Any): Lambda コンテキストオブジェクト

    Returns:
        dict[str, Any]: statusCode=200、body に run_discovery() の結果
    """
    print("discoverStudiosBatch started")

    lat, lng = event.get("lat"), event.get("lng")
    location_bias = {"lat": float(lat), "lng": float(lng)} if lat is not None and lng is not None else None

    result = run_discovery(location_bias)
    return {"statusCode": 200, "headers": CORS, "body": json.dumps(result)}
