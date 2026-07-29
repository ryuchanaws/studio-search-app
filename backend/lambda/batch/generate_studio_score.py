"""
generate_studio_score.py

レンタルスタジオのスコアを計算し、AIによる推薦理由を生成するバッチ処理 Lambda。

釣行AIアプリ（fishing-ai-app）の generate_score.py と同じ設計思想。

EventBridge スケジュール（毎日AM6:00 JST）または
POST /admin/run-ai-batch による手動実行で起動される。

処理フロー:
    0. discover_studios.run_discovery() で新規スタジオ候補を探索しStudiosテーブルに追加
       （新規に見つかったスタジオもこの回のスコア計算対象に含めるため、
        1のStudios取得より前に実行する。失敗してもスコア計算自体は継続する）
    1. Studios テーブルから全スタジオを取得
    2. 各スタジオの口コミ評価（rating）・レビュー数（user_ratings_total）・設備を評価
    3. ルールベースのスコア式でスコアを計算（毎回・全スタジオ分実行）
    4. Claude API で推薦理由（reason）を日本語生成。ただしスコアがほぼ変わっておらず
       （変化幅がREASON_SCORE_CHANGE_THRESHOLD未満）、かつ前回生成からREASON_MAX_AGE_DAYS日
       以内のスタジオは前回の文章を使い回し、Claudeは呼ばない（無駄なAPI呼び出し・
       コストを避けるため。釣行AIアプリの2026-07-26対応と同じ思想）
    5. Recommendations テーブルに結果を保存（reasonを使い回した場合もスコア・updatedAtは
       毎回更新するため、フロントのポーリング完了判定には影響しない）

Requirements:
    - 環境変数 STUDIOS_TABLE / RECOMMENDATIONS_TABLE が設定済みであること
    - Lambda 実行ロールに DynamoDB の読み書き権限があること
    - anthropic パッケージがインストール済みであること（pip install anthropic）
"""

import json
import os
import random
from decimal import Decimal
from datetime import datetime, timezone
from typing import Any

import anthropic

from batch_common import get_table as _get_table, get_ssm_parameter
from discover_studios import run_discovery, DEFAULT_CAPACITY_CATEGORY

# 環境変数からテーブル名・SSMパラメータ名を取得
STUDIOS_TABLE         = os.environ.get("STUDIOS_TABLE", "studio-studios")
RECOMMENDATIONS_TABLE = os.environ.get("RECOMMENDATIONS_TABLE", "studio-recommendations")
ANTHROPIC_API_KEY_PARAM = os.environ.get(
    "ANTHROPIC_API_KEY_PARAM",
    "/studio-search/anthropic-api-key",
)

# Claude Haiku（低コスト・高速なモデル）を使用
CLAUDE_MODEL = "claude-haiku-4-5-20251001"

# CORS ヘッダー（手動実行APIからのレスポンスに付与）
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
}

# スタジオ数が増えたことで「AI分析を実行」1回がスタジオ数と同じ回数だけAPIを呼ぶように
# なる。Claude Haikuは無料枠の回数制限は無いが、呼び出し自体には費用がかかるため、
# スコアがほとんど変わっていない・最近生成済みのスタジオは理由文（reason）を使い回し、
# 呼び出しを本当に必要な分だけに絞る（釣行AIアプリと同じ対応）。
REASON_SCORE_CHANGE_THRESHOLD = 10.0  # スコアがこれ以上動いたら理由文を再生成する
REASON_MAX_AGE_DAYS = 3  # スコアが動かなくても、これだけ日数が経ったら再生成する

# 設備タグのうち、利用者に喜ばれやすいとみなす代表的なもの（appeal_scoreの加点対象）
DESIRABLE_FACILITIES = ["鏡張り", "フローリング", "音響設備", "更衣室", "シャワー", "エアコン"]


def _get_anthropic_api_key() -> str:
    """SSM Parameter StoreからAnthropic APIキーを取得する。"""
    return get_ssm_parameter(ANTHROPIC_API_KEY_PARAM)


# 最寄り駅からの距離の正規化しきい値（km）。これ以上離れていると「駅から遠い」として
# 満額のペナルティを課す。徒歩換算で概ね20分弱を想定した値
STATION_DISTANCE_NORM_KM = 1.5
# 最寄り駅距離が取得できなかった場合の中立値（km）。0（ペナルティ無し）にも
# STATION_DISTANCE_NORM_KM（満額ペナルティ）にも寄せず、中間的な扱いにする
DEFAULT_STATION_DISTANCE_KM = 0.8


# ─── Score formula ───────────────────────────────────────────────────
def calc_score(rating_score: float, popularity_score: float, appeal_score: float,
               station_distance_km: float, cost_yen: float) -> float:
    """ルールベースのスコア式でスタジオの総合スコアを計算する。

    スコア式:
        score = rating_score     * 0.4
              + popularity_score * 0.2
              + appeal_score     * 0.2
              - station_dist_norm * 0.1
              - cost_norm        * 0.1

    距離は「基準地点からの距離」ではなく「最寄り駅からのアクセス」を採用している。
    ダンス・ヨガスタジオは天気等と違って毎日変化する要素が無く、
    かつユーザー自身の現在地からの距離は「現在地から探す」機能側で別途扱うため、
    ここでは駅からの近さ（通いやすさ）をスタジオ自体の固有スコアとして使う。
    station_distance と cost は 0〜100 に正規化してからマイナス方向に加算する。
    重みの合計は0.8のため、満点条件でもスコア上限は80点になる
    （釣行AIアプリのcalc_score()と同じ構造）。

    Args:
        rating_score        (float): 口コミ評価スコア（0〜100）
        popularity_score     (float): レビュー数（人気度）スコア（0〜100）
        appeal_score         (float): 設備等から見た魅力度スコア（0〜100）
        station_distance_km (float): 最寄り駅からの距離（km）
        cost_yen             (float): 利用料金（円、不明な場合は0）

    Returns:
        float: 総合スコア（0.0〜100.0）
    """
    station_dist_norm = min(station_distance_km / STATION_DISTANCE_NORM_KM, 1.0) * 100
    cost_norm = min(cost_yen / 5000.0, 1.0) * 100
    score = (
        rating_score     * 0.4
        + popularity_score * 0.2
        + appeal_score     * 0.2
        - station_dist_norm * 0.1
        - cost_norm * 0.1
    )
    return max(0.0, min(100.0, score))


def normalize_rating(rating: float | None) -> float:
    """Google Placesのrating（0〜5、未取得ならNone）を0〜100に正規化する。

    Args:
        rating (float | None): Google Placesのrating。未取得の場合None

    Returns:
        float: 0〜100に正規化した評価スコア。ratingが無い場合は中立的な60を返す
    """
    if rating is None:
        return 60.0
    return max(0.0, min(100.0, (rating / 5.0) * 100))


def normalize_popularity(user_ratings_total: int) -> float:
    """レビュー数を0〜100の人気度スコアに正規化する。

    200件以上のレビューがあれば頭打ちで100点とする単純な線形正規化。
    将来的にはより精緻な対数スケール等への差し替えを想定している。

    Args:
        user_ratings_total (int): Google Placesのレビュー数

    Returns:
        float: 0〜100に正規化した人気度スコア
    """
    return max(0.0, min(100.0, (user_ratings_total / 200.0) * 100))


def estimate_studio_appeal(studio_name: str, facility_tags: list[str]) -> float:
    """設備タグの充実度からスタジオの魅力度スコアをヒューリスティックに推定する。

    DESIRABLE_FACILITIES に含まれる設備を多く持つほど加点する簡易ロジック。
    将来的には実際の利用者フィードバック等を反映したモデルへの差し替えを想定している
    （釣行AIアプリの estimate_fish_probability() と同じ位置づけのプレースホルダー）。

    Args:
        studio_name   (str): スタジオ名（将来の拡張用、現在は未使用）
        facility_tags (list[str]): 設備タグのリスト

    Returns:
        float: 魅力度スコア（30.0〜95.0）
    """
    matched = sum(1 for f in facility_tags if f in DESIRABLE_FACILITIES)
    base = 40 + matched * 12
    return min(95.0, max(30.0, base + random.uniform(-5, 5)))


# ─── AI reason generation via Claude ─────────────────────────────────
def generate_reason(studio_name: str, facility_tags: list[str], score: float,
                    rating_score: float, popularity_score: float,
                    station_distance_km: float, capacity_category: str,
                    cost_yen: float) -> str:
    """Claude API を使ってスタジオの推薦理由を日本語で生成する。

    Anthropic APIキーが未設定の場合はフォールバック文言を返す。
    API エラー時もフォールバック文言を返し、Lambda を継続させる。

    Args:
        studio_name          (str): スタジオ名
        facility_tags        (list[str]): 設備タグ一覧
        score                (float): 総合スコア（0〜100）
        rating_score         (float): 口コミ評価スコア（0〜100）
        popularity_score     (float): 人気度スコア（0〜100）
        station_distance_km (float): 最寄り駅からの距離（km）
        capacity_category    (str): 収容人数の目安区分
        cost_yen             (float): 利用料金（円、不明な場合は0）

    Returns:
        str: スタジオの推薦理由（2〜3文の日本語）
    """
    api_key = _get_anthropic_api_key()
    if not api_key:
        return f"{studio_name}は口コミ評価が高く、{', '.join(facility_tags)}などの設備が魅力のスタジオです。"

    try:
        client = anthropic.Anthropic(api_key=api_key)

        cost_line = f"利用料金: 約{cost_yen:.0f}円/時間" if cost_yen > 0 else "利用料金: 不明（公式サイトに記載なし）"

        prompt = f"""あなたはダンス・ヨガスタジオ探しのアドバイザーです。以下のデータを元に、
利用者向けに「なぜこのスタジオが今おすすめか」を2〜3文の自然な日本語で説明してください。
親しみやすい文体で。

スタジオ名: {studio_name}
設備: {', '.join(facility_tags)}
総合スコア: {score:.0f}/100
口コミ評価スコア: {rating_score:.0f}/100
人気度スコア: {popularity_score:.0f}/100
最寄り駅からの距離: {station_distance_km:.2f}km
収容人数の目安: {capacity_category}
{cost_line}

説明文のみ出力してください（前置き不要）:"""

        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text.strip()

    except Exception as e:
        print(f"Claude API error: {e}")
        return f"{studio_name}は現在のコンディションが良好です。{', '.join(facility_tags)}が揃っています。"


def _should_regenerate_reason(existing: dict[str, Any] | None, new_score: float) -> bool:
    """既存の推薦理由（reason）を使い回さず、Claudeで再生成すべきかを判定する。

    以下のいずれかに該当する場合は再生成が必要:
        - このスタジオの推薦データがまだ無い（初回）
        - 既存データにreasonが無い
        - スコアがREASON_SCORE_CHANGE_THRESHOLD以上動いた
        - 前回の更新からREASON_MAX_AGE_DAYS日以上経過している
          （updatedAtが読めない/無い場合も安全側に倒して再生成する）

    Args:
        existing  (dict | None): RecommendationsTableの既存アイテム（無ければNone）
        new_score (float): 今回計算したスコア

    Returns:
        bool: Claudeで理由文を再生成すべきならTrue
    """
    if not existing or not existing.get("reason"):
        return True

    prev_score = float(existing.get("score", 0))
    if abs(new_score - prev_score) >= REASON_SCORE_CHANGE_THRESHOLD:
        return True

    prev_updated_at = existing.get("updatedAt")
    if not prev_updated_at:
        return True
    try:
        prev_dt = datetime.fromisoformat(prev_updated_at)
    except ValueError:
        return True
    age_days = (datetime.now(timezone.utc) - prev_dt).total_seconds() / 86400
    return age_days >= REASON_MAX_AGE_DAYS


# ─── Main batch handler ───────────────────────────────────────────────
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """全スタジオのスコア計算とAI推薦理由生成を実行するメインハンドラー。

    Studios テーブルの全レコードを処理し、スコアと推薦理由を
    Recommendations テーブルに保存する。

    EventBridge スケジュールまたは admin_trigger.py 経由で呼び出される。

    Args:
        event   (dict[str, Any]): Lambda イベントオブジェクト（内容は不使用）
        context (Any): Lambda コンテキストオブジェクト

    Returns:
        dict[str, Any]:
            成功時 200:
                {
                    "status": "completed",
                    "processedCount": int,
                    "completedAt": str
                }
            スタジオなし 200:
                {
                    "message": "No studios found",
                    "processedCount": 0
                }
    """
    print("generateStudioScoreBatch started")

    # 新規スタジオ候補の探索を先に行い、この回のスコア計算に含める
    # （「AI分析を実行」が新スタジオ探索も兼ねるようにするため）
    # 失敗してもスコア計算自体は継続させる
    try:
        discovery_result = run_discovery()
        print(f"  Discovery: {discovery_result}")
    except Exception as e:
        print(f"Studio discovery error (continuing with scoring): {e}")

    studios_table = _get_table(STUDIOS_TABLE)
    rec_table     = _get_table(RECOMMENDATIONS_TABLE)

    studios: list[dict[str, Any]] = studios_table.scan()["Items"]
    if not studios:
        return {
            "statusCode": 200,
            "headers": CORS,
            "body": json.dumps({"message": "No studios found", "processedCount": 0}),
        }

    # 既存の推薦データをstudioIdごとの辞書にしておく（reason使い回し判定用）
    existing_recs: dict[str, dict[str, Any]] = {r["studioId"]: r for r in rec_table.scan()["Items"]}

    # スタジオごとに直列処理する。並列化していないのは、Claude API呼び出し
    # （1件あたり数秒）が支配的でDynamoDBの負荷は問題にならないため、
    # 実装の単純さを優先している。reason使い回し最適化後は、大半のスタジオで
    # Claudeを呼ばなくなるため所要時間は実行のたびに変動する
    # （スコアが大きく動いた/久しぶりのスタジオが多いほど時間がかかる）。
    processed = 0
    reason_regenerated = 0
    for studio in studios:
        # DynamoDBの必須項目はstudioIdのみのため、他は欠損に備えてデフォルト値を設定
        studio_id:     str       = studio["studioId"]
        studio_name:   str       = studio.get("name", studio_id)
        facility_tags: list[str] = studio.get("facilityTags", ["鏡張り", "フローリング"])
        capacity_category: str   = studio.get("capacityCategory", DEFAULT_CAPACITY_CATEGORY)
        price_options: list      = studio.get("priceOptions") or []
        # distanceKm（基準地点からの距離）はスコアには使わず、フロントの
        # 「現在地から探す」再ランキング機能向けにそのままRecommendationsへ引き継ぐ
        distance_km:   float     = float(studio.get("distanceKm", 20.0))
        cost_yen:      float     = float(studio.get("costYen", 0))
        # 最寄り駅距離が未取得（discover_studios実行時にPlaces APIが失敗した等）の場合は
        # 中立値にフォールバックする（ペナルティを最大にも最小にも寄せない）
        nearest_station_m = studio.get("nearestStationDistanceM")
        station_distance_km: float = (
            float(nearest_station_m) / 1000.0 if nearest_station_m is not None
            else DEFAULT_STATION_DISTANCE_KM
        )
        rating = studio.get("rating")
        rating_val = float(rating) if rating is not None else None
        user_ratings_total = int(studio.get("userRatingsTotal", 0))

        rating_score = normalize_rating(rating_val)
        popularity_score = normalize_popularity(user_ratings_total)
        appeal_score = estimate_studio_appeal(studio_name, facility_tags)

        # スコアはルールベースで決定論的に計算し、reason文だけAIに生成させる
        score = calc_score(rating_score, popularity_score, appeal_score, station_distance_km, cost_yen)

        # reasonはスコアが大きく動いた/一定日数経過した場合のみClaudeで再生成し、
        # そうでなければ前回の文章を使い回す（API呼び出し削減）
        existing = existing_recs.get(studio_id)
        if _should_regenerate_reason(existing, score):
            reason = generate_reason(studio_name, facility_tags, score,
                                     rating_score, popularity_score,
                                     station_distance_km, capacity_category, cost_yen)
            reason_regenerated += 1
        else:
            reason = existing["reason"]

        # studioId をPKとして put_item するため、同じスタジオの前回結果は上書きされる
        # （Recommendationsテーブルは履歴を持たず、スタジオごとに最新1件のみ保持する設計）
        rec_table.put_item(Item={
            "studioId":            studio_id,
            "score":               Decimal(str(round(score, 2))),
            "facilityTags":        facility_tags,
            "capacityCategory":    capacity_category,
            "priceOptions":        price_options,
            "reason":              reason,
            "distance":            Decimal(str(distance_km)),
            "stationDistanceKm":   Decimal(str(round(station_distance_km, 2))),
            "cost":                Decimal(str(cost_yen)),
            "ratingScore":         Decimal(str(round(rating_score, 2))),
            "popularityScore":     Decimal(str(round(popularity_score, 2))),
            "updatedAt":           datetime.now(timezone.utc).isoformat(),
        })
        processed += 1
        print(f"  Processed: {studio_name} → score={score:.1f}")

    print(f"  Claude reason calls: {reason_regenerated}/{processed} (残りは前回の文章を使い回し)")

    result: dict[str, Any] = {
        "status": "completed",
        "processedCount": processed,
        "reasonRegeneratedCount": reason_regenerated,
        "completedAt": datetime.now(timezone.utc).isoformat(),
    }
    return {"statusCode": 200, "headers": CORS, "body": json.dumps(result)}
