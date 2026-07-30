"""
scrape_availability.py

23区内の主要レンタルスタジオ（BUZZ / worcle / NOAH / スタジオミッション）の
公式サイトから空き状況・広さをスクレイピングし、ローカルで結果を確認するための
ローカル専用スクリプト。

このスクリプトはローカル実行専用（クラウド上でのバッチ化・定期実行は想定しない）。
実データはstudio-studiosテーブルのスキーマに存在しない項目（広さ・空き状況）を
扱うため、DynamoDBへは書き込まず、標準出力またはJSONファイルへ結果を出力する。

現時点でBUZZのみ実装済み。他ブランド（worcle / NOAH / mission）は空き状況ページの
構造調査中のため未実装。

studio-studios / studio-availability への書き込み時のstudioId命名規則:
    "{brand}-{shop}" （例: "buzz-kichijoji"）。1店舗=1スタジオレコードとし、
    複数部屋の情報はstudio-studiosの"rooms"属性、空き状況はstudio-availabilityの
    "rooms"属性（部屋ごとのslots配列）にまとめて持つ。

Usage:
    cd backend/scripts
    # 標準出力に表示のみ
    ../.venv/Scripts/python.exe scrape_availability.py --brand buzz --shop kichijoji --date 2026-08-01
    # JSONファイルに保存
    ../.venv/Scripts/python.exe scrape_availability.py --brand buzz --shop kichijoji --date 2026-08-01 --json out.json
    # DynamoDBへ書き込み（studio-studios / studio-availability 両方）
    ../.venv/Scripts/python.exe scrape_availability.py --brand buzz --shop kichijoji --date 2026-08-01 --push-to-dynamo
    # 23区内のBUZZ全店舗を一括処理してDynamoDBへ書き込み
    ../.venv/Scripts/python.exe scrape_availability.py --brand buzz --all-shops --date 2026-08-01 --push-to-dynamo
"""

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()

if sys.stdout.encoding is None or sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

AWS_REGION = "ap-northeast-1"
STUDIOS_TABLE = "studio-studios"
AVAILABILITY_TABLE = "studio-availability"

# BUZZ各店舗の住所・緯度経度（地図表示・現在地検索用）。
# 一度きりの手動登録データのため、Google Places APIには頼らずここに直接持つ。
# 緯度経度は住所からの概算値。正確な地図表示が必要になった時点でGoogle Geocoding等で
# 実測値に置き換えること。
BUZZ_SHOP_META = {
    "akasaka2": {"name": "BUZZ赤坂", "address": "東京都港区赤坂3-9-2", "lat": 35.6737, "lng": 139.7368},
    "akasaka3": {"name": "BUZZ赤坂見附", "address": "東京都千代田区平河町2-5-3", "lat": 35.6777, "lng": 139.7385},
    "roppongi": {"name": "BUZZ六本木", "address": "東京都港区六本木7-15-1", "lat": 35.6627, "lng": 139.7318},
    "bayside": {"name": "BUZZ BAYSIDE(浜松町)", "address": "東京都港区浜松町1-30-5", "lat": 35.6553, "lng": 139.7573},
    "ikebukuro3": {"name": "BUZZ池袋西口タワー", "address": "東京都豊島区西池袋1-21-7", "lat": 35.7305, "lng": 139.7100},
    "ikebukuro4": {"name": "BUZZ池袋本店", "address": "東京都豊島区西池袋1-37-6", "lat": 35.7304, "lng": 139.7096},
    "ikebukuro5": {"name": "BUZZ池袋東口BASE", "address": "東京都豊島区東池袋1-25-6", "lat": 35.7302, "lng": 139.7147},
    "ikebukuro6": {"name": "BUZZ池袋西口PARK", "address": "東京都豊島区西池袋3-25-5", "lat": 35.7316, "lng": 139.7086},
    "ikebukuro7": {"name": "BUZZ池袋サンシャイン", "address": "東京都豊島区東池袋1-14-3", "lat": 35.7288, "lng": 139.7175},
    "ikebukuro8": {"name": "BUZZ南池袋", "address": "東京都豊島区南池袋2-11-4", "lat": 35.7280, "lng": 139.7147},
    "kichijoji": {"name": "BUZZ吉祥寺", "address": "東京都武蔵野市吉祥寺本町1-8-24", "lat": 35.7041, "lng": 139.5795},
    # "tl"（BUZZ TL 大久保）はレコーディングスタジオ系の別サービスで、
    # 通常の /{shop}/{date} タイムテーブルページが存在しない（404）ため対象外。
}

# worcle各店舗の住所・緯度経度。BUZZ同様、手動登録データ（概算値）。
WORCLE_SHOP_META = {
    "shibuya": {"name": "studio worcle 渋谷", "address": "東京都渋谷区渋谷", "lat": 35.6595, "lng": 139.7005},
    "yoyogi": {"name": "studio worcle 代々木", "address": "東京都渋谷区代々木", "lat": 35.6832, "lng": 139.7021},
    "gyoen": {"name": "studio worcle 新宿御苑", "address": "東京都新宿区新宿", "lat": 35.6875, "lng": 139.7100},
    "okubo": {"name": "studio worcle 大久保", "address": "東京都新宿区大久保", "lat": 35.7005, "lng": 139.7005},
}

# worcleのスケジュール表は「部屋固有の識別色」でセルを塗り、その色が付いている=予約済み、
# グレー(210,210,210)=空き、という表現方式。ヘッダー行の画像(/scheduler/img/{room}.gif)の
# 背景色から都度その店舗の色マップを構築するため、ここでは固定値を持たない。
WORCLE_EMPTY_COLOR = "rgb(210, 210, 210)"

# NOAH各店舗の住所・緯度経度・branch_id（NOAH社内システムの店舗識別子。
# https://www.studionoah.jp/noahweb/webs/chart/shibuya/ の店舗選択フォームの
# checkbox value から採取）。23区内の主要店舗のみ対象とする。
# 緯度経度は住所からの概算値。
NOAH_SHOP_META = {
    "shibuya-honten": {"name": "サウンドスタジオノア渋谷本店", "branch_id": "114", "url_slug": "shibuya", "address": "東京都渋谷区渋谷", "lat": 35.6595, "lng": 139.7005},
    "shibuya1": {"name": "サウンドスタジオノア渋谷1号", "branch_id": "10", "url_slug": "shibuya", "address": "東京都渋谷区渋谷", "lat": 35.6595, "lng": 139.7005},
    "shibuya2": {"name": "サウンドスタジオノア渋谷2号", "branch_id": "14", "url_slug": "shibuya", "address": "東京都渋谷区渋谷", "lat": 35.6595, "lng": 139.7005},
    "shibuya3": {"name": "サウンドスタジオノア渋谷3号", "branch_id": "118", "url_slug": "shibuya", "address": "東京都渋谷区渋谷", "lat": 35.6595, "lng": 139.7005},
    "ebisu": {"name": "サウンドスタジオノア恵比寿", "branch_id": "23", "url_slug": "ebisu", "address": "東京都渋谷区恵比寿", "lat": 35.6467, "lng": 139.7100},
    "yoyogi": {"name": "サウンドスタジオノア代々木", "branch_id": "1", "url_slug": "yoyogi", "address": "東京都渋谷区代々木", "lat": 35.6832, "lng": 139.7021},
    "shinjuku": {"name": "サウンドスタジオノア新宿", "branch_id": "17", "url_slug": "shinjuku", "address": "東京都新宿区新宿", "lat": 35.6938, "lng": 139.7036},
    "shinjuku-ann": {"name": "サウンドスタジオノア新宿ANNEX", "branch_id": "76", "url_slug": "shinjuku", "address": "東京都新宿区新宿", "lat": 35.6938, "lng": 139.7036},
    "takadanobaba": {"name": "サウンドスタジオノア高田馬場", "branch_id": "11", "url_slug": "baba", "address": "東京都新宿区高田馬場", "lat": 35.7126, "lng": 139.7038},
    "ikebukuro": {"name": "サウンドスタジオノア池袋", "branch_id": "13", "url_slug": "ikebukuro", "address": "東京都豊島区池袋", "lat": 35.7295, "lng": 139.7109},
    "ikebukuro-annex": {"name": "サウンドスタジオノア池袋ANNEX", "branch_id": "112", "url_slug": "ikebukuro-annex", "address": "東京都豊島区池袋", "lat": 35.7295, "lng": 139.7109},
    "ochanomizu": {"name": "サウンドスタジオノア御茶ノ水", "branch_id": "100", "url_slug": "ochanomizu", "address": "東京都千代田区neda", "lat": 35.6996, "lng": 139.7658},
    "akihabara": {"name": "サウンドスタジオノア秋葉原", "branch_id": "18", "url_slug": "akihabara", "address": "東京都千代田区外神田", "lat": 35.7022, "lng": 139.7745},
    "hatsudai": {"name": "サウンドスタジオノア初台", "branch_id": "7", "url_slug": "hatsudai", "address": "東京都渋谷区初台", "lat": 35.6797, "lng": 139.6864},
    "nakano": {"name": "サウンドスタジオノア中野", "branch_id": "19", "url_slug": "nakano", "address": "東京都中野区中野", "lat": 35.7056, "lng": 139.6657},
    "ginza": {"name": "サウンドスタジオノア銀座", "branch_id": "16", "url_slug": "ginza", "address": "東京都中央区銀座", "lat": 35.6716, "lng": 139.7654},
    "akasaka": {"name": "サウンドスタジオノア赤坂", "branch_id": "4", "url_slug": "akasaka", "address": "東京都港区赤坂", "lat": 35.6737, "lng": 139.7368},
    "harajuku": {"name": "サウンドスタジオノア原宿", "branch_id": "109", "url_slug": "harajuku", "address": "東京都渋谷区神宮前", "lat": 35.6702, "lng": 139.7027},
    "nakameguro": {"name": "サウンドスタジオノア中目黒", "branch_id": "117", "url_slug": "nakameguro", "address": "東京都目黒区上目黒", "lat": 35.6444, "lng": 139.6989},
    "meguro-fudo": {"name": "サウンドスタジオノア目黒不動", "branch_id": "96", "url_slug": "fudomae", "address": "東京都目黒区下目黒", "lat": 35.6299, "lng": 139.7099},
}

# スタジオミッションは渋谷の単一店舗（秀永道玄坂ビル）に23部屋を持つ構成。
# 予約システム（resv.studio-mission.com）が会員ログイン必須のため、
# backend/.env の MISSION_LOGIN_EMAIL / MISSION_LOGIN_PASSWORD を使ってログインする。
MISSION_SHOP_META = {
    "shibuya": {"name": "スタジオミッション", "address": "東京都渋谷区道玄坂", "lat": 35.6580, "lng": 139.6982},
}


@dataclass
class RoomInfo:
    room_name: str
    area_sqm: float | None
    second_dimension_label: str | None  # "鏡" または "天井高" など店舗により項目名が異なる
    second_dimension_m: float | None
    min_price_yen: int | None
    photo_urls: list[str] | None = None  # 部屋写真のURL一覧（平面図は含まない）
    floor_plan_url: str | None = None  # 平面図画像のURL
    equipment: list[str] | None = None  # 設備・特記事項（例: "調光利用", "スマホスタンド"）
    reserve_url: str | None = None  # この部屋の公式サイト予約ページへの直接リンク


@dataclass
class AvailabilitySlot:
    time: str
    available: bool


@dataclass
class RoomAvailability:
    room_name: str
    slots: list[AvailabilitySlot]


def _get(url: str) -> str:
    r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=15)
    r.raise_for_status()
    r.encoding = "utf-8"
    return r.text


def fetch_buzz_room_detail(shop: str, room_path: str) -> dict:
    """個別部屋ページから写真・平面図・設備を取得する。

    Args:
        shop (str): 店舗slug（例: kichijoji）
        room_path (str): 部屋ページの絶対パス（例: "/kichijoji/441"）

    Returns:
        dict: {"photo_urls": [...], "floor_plan_url": str|None, "equipment": [...]}
    """
    html = _get(f"https://buzz-st.com{room_path}")
    soup = BeautifulSoup(html, "html.parser")

    slider = soup.select_one(".studio_mv .slider")
    photo_urls = [img["src"] for img in slider.find_all("img")] if slider else []

    # 平面図は写真スライダー内の最後の1枚として掲載されている
    # （studio_spec_floorplanリンクのhref末尾のIDと一致する画像を優先的に採用する）
    floor_plan_url = None
    floorplan_link = soup.select_one("a.studio_spec_floorplan")
    if floorplan_link and floorplan_link.get("href"):
        floorplan_id = floorplan_link["href"].rstrip("/").split("/")[-1]
        for url in photo_urls:
            if f"/m_image/{floorplan_id}/" in url:
                floor_plan_url = url
                photo_urls = [u for u in photo_urls if u != url]
                break

    photo_urls = [f"https://buzz-st.com{u}" if u.startswith("/") else u for u in photo_urls]
    if floor_plan_url and floor_plan_url.startswith("/"):
        floor_plan_url = f"https://buzz-st.com{floor_plan_url}"

    equipment = []
    option_div = soup.find("div", class_="studio_option")
    if option_div:
        equipment = [s.get_text(strip=True) for s in option_div.find_all("span") if s.get_text(strip=True)]

    return {"photo_urls": photo_urls, "floor_plan_url": floor_plan_url, "equipment": equipment}


def fetch_buzz_rooms(shop: str, with_detail: bool = False) -> list[RoomInfo]:
    """店舗ページから各スタジオの広さ・天井高・最低料金を取得する。

    Args:
        shop (str): 店舗slug（例: kichijoji）
        with_detail (bool): Trueの場合、個別部屋ページも取得して写真・平面図・設備を追加する
            （店舗の部屋数だけ追加リクエストが発生するため、必要な時のみ有効にする）

    Returns:
        list[RoomInfo]: 部屋ごとの情報
    """
    html = _get(f"https://buzz-st.com/{shop}")
    soup = BeautifulSoup(html, "html.parser")

    # 個別部屋ページへのリンク（例: "/kichijoji/441"）を収集し、後で部屋名と突き合わせる
    room_links = []
    seen_hrefs = set()
    for a in soup.select(f"a[href^='/{shop}/']"):
        href = a["href"]
        if href not in seen_hrefs and href.rstrip("/").split("/")[-1].isdigit():
            seen_hrefs.add(href)
            room_links.append(href)

    rooms = []
    for idx, item in enumerate(soup.select(".studio_all_view_thumbnail_item_info")):
        name_el = item.find("h3")
        if not name_el:
            continue
        name = name_el.get_text(strip=True)
        ps = item.find_all("p")
        area = second_label = second_value = None
        if ps:
            # 例: "広さ 31.0m | 鏡 4.5m"（吉祥寺店）、"広さ 22.0m | 天井高 2.9m"（六本木店）
            # 面積は実際は㎡だが、2つ目の項目名・単位は店舗により異なる
            m = re.search(r"広さ\s*([\d.]+)m\s*\|\s*(\S+?)\s*([\d.]+)m", ps[0].get_text(strip=True))
            if m:
                area = float(m.group(1))
                second_label = m.group(2)
                second_value = float(m.group(3))
        price = None
        if len(ps) > 1:
            m = re.search(r"(\d+)円", ps[1].get_text(strip=True))
            if m:
                price = int(m.group(1))

        room_path = room_links[idx] if idx < len(room_links) else None
        detail = {}
        if with_detail and room_path:
            try:
                detail = fetch_buzz_room_detail(shop, room_path)
            except Exception as e:
                print(f"  部屋詳細取得エラー（{shop} {name}）: {e}", file=sys.stderr)

        rooms.append(RoomInfo(
            room_name=name, area_sqm=area,
            second_dimension_label=second_label, second_dimension_m=second_value,
            min_price_yen=price,
            photo_urls=detail.get("photo_urls"),
            floor_plan_url=detail.get("floor_plan_url"),
            equipment=detail.get("equipment"),
            reserve_url=f"https://buzz-st.com{room_path}" if room_path else f"https://buzz-st.com/{shop}",
        ))
    return rooms


def fetch_buzz_availability(shop: str, date: str) -> list[RoomAvailability]:
    """指定日のタイムテーブルページから各部屋・30分刻みの空き状況を取得する。

    Args:
        shop (str): 店舗slug（例: kichijoji）
        date (str): YYYY-MM-DD形式の日付

    Returns:
        list[RoomAvailability]: 部屋ごとの空き状況リスト
    """
    html = _get(f"https://buzz-st.com/{shop}/{date}")
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table.studio_all_reserve_time_table")
    if table is None:
        raise ValueError(f"タイムテーブルが見つかりません: shop={shop} date={date}")

    header_cells = table.select("thead th div.studio_reserve_time_table_studio_name")
    room_names = [c.get_text(strip=True) for c in header_cells]

    rows = table.select("tbody tr")
    slots_per_room: list[list[AvailabilitySlot]] = [[] for _ in room_names]

    for row in rows:
        time_cell = row.find("td", class_="time")
        if time_cell is None:
            continue
        time_text = time_cell.get_text(strip=True)
        cells = row.find_all("td")[1:]
        for i, cell in enumerate(cells):
            if i >= len(room_names):
                break
            btn = cell.find("button")
            is_closed = bool(btn and "studio_reserve_time_table_close" in (btn.get("class") or []))
            slots_per_room[i].append(AvailabilitySlot(time=time_text, available=not is_closed))

    return [
        RoomAvailability(room_name=name, slots=slots)
        for name, slots in zip(room_names, slots_per_room)
    ]


def scrape_buzz(shop: str, date: str, with_detail: bool = False) -> dict:
    rooms = fetch_buzz_rooms(shop, with_detail=with_detail)
    availability = fetch_buzz_availability(shop, date)
    room_info_by_name = {r.room_name: r for r in rooms}

    result_rooms = []
    for avail in availability:
        info = room_info_by_name.get(avail.room_name)
        result_rooms.append({
            "roomName": avail.room_name,
            "areaSqm": info.area_sqm if info else None,
            "secondDimensionLabel": info.second_dimension_label if info else None,
            "secondDimensionM": info.second_dimension_m if info else None,
            "minPriceYen": info.min_price_yen if info else None,
            "reserveUrl": info.reserve_url if info else None,
            "photoUrls": info.photo_urls if info else None,
            "floorPlanUrl": info.floor_plan_url if info else None,
            "equipment": info.equipment if info else None,
            "slots": [asdict(s) for s in avail.slots],
        })

    return {
        "brand": "buzz",
        "shop": shop,
        "date": date,
        "sourceUrl": f"https://buzz-st.com/{shop}/{date}",
        "rooms": result_rooms,
    }


def fetch_worcle_page(shop: str, date: str | None = None) -> str:
    """worcle店舗ページをPlaywrightでレンダリングして取得する。

    worcleの空室スケジュール表はJavaScriptで描画されるため、requestsでの
    静的取得では中身が空になる（Playwrightでのレンダリングが必須）。

    Args:
        shop (str): 店舗slug（例: shibuya）
        date (str | None): YYYY-MM-DD形式の日付。指定するとその日を中心とした
            3日分（前日・当日・翌日）のスケジュールが表示される。省略時は今日を含む3日分。

    Returns:
        str: レンダリング後のHTML
    """
    from playwright.sync_api import sync_playwright

    url = f"https://www.studioworcle.com/{shop}/"
    if date:
        # worcleの ?q=YYMMDD パラメータは「YY年MM月DD日を中央とした3日間」を表示する
        y, m, d = date.split("-")
        url += f"?q={y[2:]}{m}{d}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url, wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(1200)
        html = page.content()
        browser.close()
    return html


def fetch_worcle_rooms(shop: str) -> list[RoomInfo]:
    """店舗ページのroom_listテーブルから各部屋の広さ・床材を取得する。

    worcleは "広さ" を複数部屋でまとめて表記する（例: "約20㎡（〜5人目安）"を
    複数部屋で共有）ため、area_sqmは代表値（レンジの下限）を数値として保持し、
    second_dimension_label に床材（フローリング/畳等）を入れる。

    Args:
        shop (str): 店舗slug（例: shibuya）

    Returns:
        list[RoomInfo]: 部屋ごとの広さ・床材情報
    """
    html = fetch_worcle_page(shop)
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", class_="room_list")
    if table is None:
        raise ValueError(f"room_listテーブルが見つかりません: shop={shop}")

    rooms: list[RoomInfo] = []
    current_area: float | None = None
    current_floor: str | None = None

    for row in table.find_all("tr"):
        cells = row.find_all("td")
        for cell in cells:
            classes = cell.get("class") or []
            text = cell.get_text(strip=True)
            if "col1" in classes:
                m = re.search(r"([\d.]+)\s*m", text)
                current_area = float(m.group(1)) if m else current_area
            elif "col2" in classes:
                current_floor = text or current_floor
            elif "col3" in classes:
                link = cell.find("a")
                room_name = link.get_text(strip=True) if link else text
                if room_name:
                    # 部屋写真は "{room}st.jpeg" というファイル名パターンで存在する
                    # （店舗ページのHTML内に埋め込まれた画像から確認済み。全部屋・全店舗で
                    # 存在するとは限らないため、フロント側は404の可能性を考慮すること）
                    photo_url = f"https://www.studioworcle.com/cms/wp-content/uploads/{room_name}st.jpeg"
                    rooms.append(RoomInfo(
                        room_name=room_name, area_sqm=current_area,
                        second_dimension_label=current_floor, second_dimension_m=None,
                        min_price_yen=None,
                        photo_urls=[photo_url],
                        reserve_url=f"https://www.studioworcle.com/{shop}/",
                    ))
    return rooms


def fetch_worcle_availability(shop: str, date: str) -> list[RoomAvailability]:
    """指定日を含む3日分のスケジュール表から、指定日1日分の空き状況を抽出する。

    Args:
        shop (str): 店舗slug（例: shibuya）
        date (str): YYYY-MM-DD形式の日付

    Returns:
        list[RoomAvailability]: 部屋ごとの30分刻みの空き状況（指定日のみ）
    """
    html = fetch_worcle_page(shop, date)
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", id="reserve_tbl")
    if table is None:
        raise ValueError(f"reserve_tblが見つかりません: shop={shop} date={date}")

    rows = table.find_all("tr")
    if len(rows) < 4:
        raise ValueError(f"reserve_tblの行数が不足しています: shop={shop} date={date}")

    # ヘッダー行(0行目)から「列インデックス→部屋番号」と「部屋番号→固有色」を得る。
    # 3日分×N部屋が横に並んでいるため、日付インデックス(0=前日,1=当日,2=翌日)ごとに
    # 部屋の並びが繰り返される
    header_cells = rows[0].find_all("td", class_="TableCell")
    room_order: list[str] = []
    room_colors: dict[str, str] = {}
    for cell in header_cells:
        img = cell.find("img")
        if not img:
            continue
        room_id = img["src"].split("/")[-1].replace(".gif", "")
        room_order.append(room_id)
        m = re.search(r"background-color:\s*(rgb\([^)]+\))", cell.get("style", ""))
        if m:
            room_colors[room_id] = m.group(1)

    rooms_per_day = len(set(room_order))
    if rooms_per_day == 0:
        raise ValueError(f"部屋ヘッダーが取得できません: shop={shop} date={date}")

    # 日付行（3日分、当日は中央）から対象日のインデックスを特定
    date_row_cells = rows[3].find_all("td")
    day_labels = [c.get_text(strip=True) for c in date_row_cells]
    target_day = str(int(date.split("-")[2]))
    if target_day not in day_labels:
        raise ValueError(f"対象日がスケジュール表に見つかりません: shop={shop} date={date} labels={day_labels}")
    day_index = day_labels.index(target_day)
    col_start = day_index * rooms_per_day
    col_end = col_start + rooms_per_day
    target_room_ids = room_order[col_start:col_end]

    # スケジュール本体は2行1組（1行目=xx:00、2行目=xx:30）で9:00始まり。
    # 各行のtdは先頭・末尾にRowHeaderが付くことがあるためScheduleCellのみを対象にする
    slots_per_room: dict[str, list[AvailabilitySlot]] = {rid: [] for rid in target_room_ids}
    current_hour: int | None = None
    half = 0
    for row in rows[4:]:
        header = row.find("td", class_="RowHeader")
        if header and header.get_text(strip=True):
            m = re.search(r"(\d+):00", header.get_text(strip=True))
            if m:
                current_hour = int(m.group(1))
                half = 0
        if current_hour is None:
            continue

        cells = row.find_all("td", class_="ScheduleCell")
        if len(cells) != rooms_per_day * 3:
            continue

        time_label = f"{current_hour:02d}:{'00' if half == 0 else '30'}"
        target_cells = cells[col_start:col_end]
        for room_id, cell in zip(target_room_ids, target_cells):
            m = re.search(r"background-color:\s*(rgb\([^)]+\))", cell.get("style", ""))
            color = m.group(1) if m else WORCLE_EMPTY_COLOR
            is_available = (color == WORCLE_EMPTY_COLOR)
            slots_per_room[room_id].append(AvailabilitySlot(time=time_label, available=is_available))
        half = 1 - half

    return [
        RoomAvailability(room_name=room_id, slots=slots)
        for room_id, slots in slots_per_room.items()
    ]


def scrape_worcle(shop: str, date: str) -> dict:
    rooms = fetch_worcle_rooms(shop)
    availability = fetch_worcle_availability(shop, date)
    room_info_by_name = {r.room_name: r for r in rooms}

    result_rooms = []
    for avail in availability:
        info = room_info_by_name.get(avail.room_name)
        result_rooms.append({
            "roomName": avail.room_name,
            "areaSqm": info.area_sqm if info else None,
            "secondDimensionLabel": info.second_dimension_label if info else None,
            "secondDimensionM": info.second_dimension_m if info else None,
            "minPriceYen": info.min_price_yen if info else None,
            "reserveUrl": info.reserve_url if info else None,
            "photoUrls": info.photo_urls if info else None,
            "slots": [asdict(s) for s in avail.slots],
        })

    return {
        "brand": "worcle",
        "shop": shop,
        "date": date,
        "sourceUrl": f"https://www.studioworcle.com/{shop}/",
        "rooms": result_rooms,
    }


def fetch_noah_rooms(shop: str) -> list[dict]:
    """店舗の全部屋情報（studio_id・部屋名・広さ）を取得する。

    認証不要のJSON API（GET /noahweb/Chart/studios?b[]={branch_id}）を直接叩く。

    Args:
        shop (str): 店舗slug（例: shibuya-honten）

    Returns:
        list[dict]: {"studio_id": int, "room_name": str, "area_tatami": float} のリスト
    """
    branch_id = NOAH_SHOP_META[shop]["branch_id"]
    data = requests.get(
        "https://www.studionoah.jp/noahweb/Chart/studios",
        params={"b[]": branch_id},
        headers={"User-Agent": USER_AGENT},
        timeout=15,
    ).json()
    if data.get("type") != "success" or not data.get("branches"):
        raise ValueError(f"NOAH部屋一覧の取得に失敗しました: shop={shop}")

    rooms = []
    for branch in data["branches"]:
        for s in branch.get("studios", []):
            if not s.get("view_web_flg"):
                continue
            rooms.append({
                "studio_id": s["studio_id"],
                "room_name": s["studio_name"],
                # sizeは「畳」単位。㎡換算は1畳=約1.62㎡（江戸間目安）で近似する
                "area_tatami": s.get("size"),
                "photo_url": s.get("image_path"),
                "reserve_url": s.get("detail_path"),
            })
    return rooms


def fetch_noah_room_equipment(detail_path: str) -> list[str]:
    """個別部屋ページから常設機材リストを取得する。

    NOAHの部屋ページは本文中に "EQUIPMENT" という見出しがあり、その直後に
    「機材種別」「型番」が交互に並ぶテキストブロックとして常設機材が列挙されている
    （例: "ギターアンプ" "Marshall JCM900" "ドラムセット" "Pearl MASTERS MAPLE"）。
    このブロックを「種別: 型番」の形式に整形して返す。

    Args:
        detail_path (str): APIレスポンスのdetail_path（部屋個別ページの絶対URL）

    Returns:
        list[str]: "種別: 型番" 形式の機材リスト（取得できなければ空リスト）
    """
    try:
        html = _get(detail_path)
    except Exception:
        return []
    soup = BeautifulSoup(html, "html.parser")
    lines = [line.strip() for line in soup.get_text("\n").split("\n") if line.strip()]

    if "EQUIPMENT" not in lines:
        return []
    start = lines.index("EQUIPMENT") + 2  # 見出し直後の "{部屋名}常設機材" 行はスキップ

    equipment = []
    i = start
    # 「種別」「型番」が交互に並ぶ間だけ拾う。次のセクション見出し（全角記号や短すぎない
    # 単独行が続かなくなる箇所）に達したら打ち切る。最大20行（10機材）までの安全上限を設ける
    while i + 1 < len(lines) and len(equipment) < 10:
        category, spec = lines[i], lines[i + 1]
        if len(category) > 20 or len(spec) > 40:
            break
        equipment.append(f"{category}: {spec}")
        i += 2
    return equipment


def fetch_noah_availability_batch(studio_id: int, center_date: str) -> dict[str, list[AvailabilitySlot]]:
    """1部屋につき1リクエストで、指定日を含む7日分の空き状況をまとめて取得する。

    Args:
        studio_id (int): NOAHのstudio_id
        center_date (str): YYYY-MM-DD形式の日付（このリクエストの中心日。前後合わせて7日分返る）

    Returns:
        dict[str, list[AvailabilitySlot]]: {"YYYY-MM-DD": [スロット...]} の日付→スロット一覧
    """
    y, m, d = center_date.split("-")
    searchdate = f"{y}/{m}/{d}"
    data = requests.get(
        "https://www.studionoah.jp/noahweb/Chart/schedule",
        params={"studio_id": studio_id, "searchdate": searchdate},
        headers={"User-Agent": USER_AGENT},
        timeout=15,
    ).json()

    result: dict[str, list[AvailabilitySlot]] = {}
    for day in data.get("date", []):
        date_key = day["date"].replace("/", "-")
        slots = [
            AvailabilitySlot(time=t["start_time"], available=bool(t.get("is_bookable")))
            for t in day.get("time", [])
        ]
        result[date_key] = slots
    return result


def scrape_noah(shop: str, date: str, with_detail: bool = False) -> dict:
    """NOAH1店舗・1日分の空き状況を取得する。

    fetch_noah_availability_batchは1リクエストで前後7日分を返すが、ここでは
    シンプルさを優先し指定日1日分のみを取り出す（他ブランドと同じインターフェースにするため）。
    大量日数を取得する場合、本来は7日おきにリクエストすれば効率化できるが、
    daterange_from_today()は1日ずつ呼ぶため、このレベルでの最適化はしない
    （NOAHはBUZZ/worcleよりリクエスト数が少なくて済むため許容する）。

    Args:
        shop (str): 店舗slug
        date (str): YYYY-MM-DD形式の日付
        with_detail (bool): Trueの場合、部屋ごとに個別ページを取得して設備テキストを追加する
            （部屋数だけ追加リクエストが発生するため、必要な時のみ有効にする）

    Returns:
        dict: 他ブランドと同じ形式の結果dict
    """
    rooms = fetch_noah_rooms(shop)
    result_rooms = []
    for room in rooms:
        schedule = fetch_noah_availability_batch(room["studio_id"], date)
        slots = schedule.get(date, [])
        area_sqm = round(room["area_tatami"] * 1.62, 1) if room.get("area_tatami") else None
        equipment = None
        if with_detail and room.get("reserve_url"):
            equipment = fetch_noah_room_equipment(room["reserve_url"]) or None
        result_rooms.append({
            "roomName": room["room_name"],
            "areaSqm": area_sqm,
            "secondDimensionLabel": "畳数" if room.get("area_tatami") else None,
            "secondDimensionM": room.get("area_tatami"),
            "minPriceYen": None,
            "photoUrls": [room["photo_url"]] if room.get("photo_url") else None,
            "reserveUrl": room.get("reserve_url"),
            "equipment": equipment,
            "slots": [asdict(s) for s in slots],
        })

    return {
        "brand": "noah",
        "shop": shop,
        "date": date,
        "sourceUrl": f"https://www.studionoah.jp/{NOAH_SHOP_META[shop]['url_slug']}/",
        "rooms": result_rooms,
    }


def fetch_mission_rooms() -> list[dict]:
    """公開ページ（ログイン不要）から各部屋の広さ・床材・設備・写真・予約リンクを取得する。

    Returns:
        list[dict]: {"room_name", "area_sqm", "material", "options", "photo_url", "reserve_url"}
    """
    html = _get("https://studio-mission.com/room/")
    soup = BeautifulSoup(html, "html.parser")
    rooms = []
    for li in soup.select("ul.roomList li"):
        number_el = li.select_one(".roomType .number")
        size_el = li.select_one(".roomType .size")
        if not number_el:
            continue
        room_name = number_el.get_text(strip=True)
        area_match = re.search(r"([\d.]+)", size_el.get_text(strip=True)) if size_el else None
        area_sqm = float(area_match.group(1)) if area_match else None

        material_el = li.select_one(".material")
        material = material_el.get_text(strip=True) if material_el else None

        option_el = li.select_one(".option")
        options = option_el.get_text(strip=True) if option_el else None

        photo_a = li.select_one(".pic a")
        photo_url = photo_a["href"] if photo_a else None
        if photo_url and photo_url.startswith(".."):
            photo_url = "https://studio-mission.com" + photo_url[2:]

        resv_a = li.select_one(".resv a")
        reserve_url = resv_a["href"] if resv_a else None

        rooms.append({
            "room_name": room_name,
            "area_sqm": area_sqm,
            "material": material,
            "options": options,
            "photo_url": photo_url,
            "reserve_url": reserve_url,
        })
    return rooms


def scrape_mission(shop: str, date: str) -> dict:
    """スタジオミッション渋谷店の空き状況を取得する（会員ログイン必須）。

    backend/.env の MISSION_LOGIN_EMAIL / MISSION_LOGIN_PASSWORD でログインし、
    /reserve/v2/?date=YYYY-MM-DD で指定日の全23部屋分の空き状況をまとめて取得する。

    Args:
        shop (str): 現状"shibuya"のみ
        date (str): YYYY-MM-DD形式の日付

    Returns:
        dict: 他ブランドと同じ形式の結果dict
    """
    from playwright.sync_api import sync_playwright

    email = os.environ.get("MISSION_LOGIN_EMAIL")
    password = os.environ.get("MISSION_LOGIN_PASSWORD")
    if not email or not password:
        raise ValueError(
            "MISSION_LOGIN_EMAIL / MISSION_LOGIN_PASSWORD が設定されていません。"
            "backend/.env.example を参考に backend/.env を作成してください。"
        )

    room_meta = {r["room_name"]: r for r in fetch_mission_rooms()}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("https://resv.studio-mission.com/login", wait_until="networkidle", timeout=30000)
        page.fill("input[name='params[email]']", email)
        page.fill("input[name='params[password]']", password)
        page.click("button[type='submit'], input[type='submit']")
        page.wait_for_timeout(2000)

        page.goto(f"https://resv.studio-mission.com/reserve/v2/?date={date}",
                   wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(1500)
        html = page.content()
        browser.close()

    soup = BeautifulSoup(html, "html.parser")
    time_selector = soup.find("div", class_="time-selector")
    if time_selector is None:
        raise ValueError(f"time-selectorが見つかりません（ログイン失敗の可能性）: date={date}")

    result_rooms = []
    for ul in time_selector.find_all("ul"):
        checkboxes = ul.find_all("input", type="checkbox")
        if not checkboxes:
            continue
        room_name = checkboxes[0].get("data-name")
        slots = [
            AvailabilitySlot(
                time=cb["data-start-time"][:5],
                available=(cb.get("disabled") is None),
            )
            for cb in checkboxes
        ]
        meta = room_meta.get(room_name, {})
        result_rooms.append({
            "roomName": room_name,
            "areaSqm": meta.get("area_sqm"),
            "secondDimensionLabel": meta.get("material"),
            "secondDimensionM": None,
            "minPriceYen": None,
            "slots": [asdict(s) for s in slots],
        })

    return {
        "brand": "mission",
        "shop": shop,
        "date": date,
        "sourceUrl": "https://studio-mission.com/",
        "rooms": result_rooms,
    }


def push_to_dynamo(result: dict) -> None:
    """スクレイピング結果をstudio-studios / studio-availabilityへ書き込む。

    studio-studios側は部屋一覧（広さ等）のみを保持するマスタ情報として都度上書きし、
    studio-availability側は「brand-shop」×「date」単位で1アイテムとして空き状況を保存する。

    Args:
        result (dict): scrape_buzz()等が返す結果dict
    """
    import boto3
    from decimal import Decimal

    def to_decimal(obj):
        if isinstance(obj, float):
            return Decimal(str(obj))
        if isinstance(obj, dict):
            return {k: to_decimal(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [to_decimal(v) for v in obj]
        return obj

    dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
    studios_table = dynamodb.Table(STUDIOS_TABLE)
    availability_table = dynamodb.Table(AVAILABILITY_TABLE)

    studio_id = f"{result['brand']}-{result['shop']}"
    shop_meta_by_brand = {
        "buzz": BUZZ_SHOP_META, "worcle": WORCLE_SHOP_META,
        "noah": NOAH_SHOP_META, "mission": MISSION_SHOP_META,
    }
    meta = shop_meta_by_brand.get(result["brand"], {}).get(result["shop"], {})
    now = datetime.now(timezone.utc).isoformat()

    # photoUrls/floorPlanUrl/equipment/reserveUrlは--with-detail実行時のみ結果に含まれる。
    # 通常の（詳細取得なしの）日次実行がstudio-studiosの詳細情報を空で上書きしないよう、
    # DynamoDB上の既存rooms（部屋名をキーに）と今回の結果をマージする。
    # 今回の結果に無いキーは既存値を保持し、今回の結果にあるキーのみ上書きする。
    existing_item = studios_table.get_item(Key={"studioId": studio_id}).get("Item")
    existing_rooms_by_name = {
        r["roomName"]: r for r in (existing_item.get("rooms") if existing_item else [])
    }

    room_master = []
    for r in result["rooms"]:
        merged = dict(existing_rooms_by_name.get(r["roomName"], {}))
        new_fields = {
            "roomName": r["roomName"],
            "areaSqm": r["areaSqm"],
            "secondDimensionLabel": r["secondDimensionLabel"],
            "secondDimensionM": r["secondDimensionM"],
            "minPriceYen": r["minPriceYen"],
            "reserveUrl": r.get("reserveUrl"),
            "photoUrls": r.get("photoUrls"),
            "floorPlanUrl": r.get("floorPlanUrl"),
            "equipment": r.get("equipment"),
        }
        merged.update({k: v for k, v in new_fields.items() if v is not None})
        room_master.append(merged)

    studios_table.update_item(
        Key={"studioId": studio_id},
        UpdateExpression=(
            "SET brand = :brand, #n = :name, address = :address, lat = :lat, lng = :lng, "
            "sourceUrl = :url, rooms = :rooms, updatedAt = :now"
        ),
        ExpressionAttributeNames={"#n": "name"},
        ExpressionAttributeValues=to_decimal({
            ":brand": result["brand"],
            ":name": meta.get("name", studio_id),
            ":address": meta.get("address", ""),
            ":lat": meta.get("lat"),
            ":lng": meta.get("lng"),
            ":url": result["sourceUrl"],
            ":rooms": room_master,
            ":now": now,
        }),
    )

    availability_table.put_item(Item=to_decimal({
        "studioId": studio_id,
        "date": result["date"],
        "rooms": result["rooms"],
        "scrapedAt": now,
    }))

    print(f"  -> DynamoDBへ登録: studioId={studio_id} date={result['date']}")


def daterange_from_today(days: int) -> list[str]:
    """今日から指定日数分（today含む）のYYYY-MM-DD文字列リストを返す。"""
    from datetime import date, timedelta
    today = date.today()
    return [(today + timedelta(days=i)).isoformat() for i in range(days)]


SCRAPE_FUNCTIONS = {"buzz": scrape_buzz, "worcle": scrape_worcle, "noah": scrape_noah, "mission": scrape_mission}
SHOP_META_BY_BRAND = {
    "buzz": BUZZ_SHOP_META, "worcle": WORCLE_SHOP_META,
    "noah": NOAH_SHOP_META, "mission": MISSION_SHOP_META,
}


def main() -> None:
    parser = argparse.ArgumentParser(description="レンタルスタジオ空き状況スクレイパー（ローカル専用）")
    parser.add_argument("--brand", required=True, choices=["buzz", "worcle", "noah", "mission"], help="対象ブランド")
    parser.add_argument("--shop", help="店舗slug（例: kichijoji, shibuya）。--all-shopsと排他")
    parser.add_argument("--all-shops", action="store_true", help="対象ブランドの全店舗を一括処理する")
    parser.add_argument("--date", help="YYYY-MM-DD形式の日付。--days-aheadと排他")
    parser.add_argument("--days-ahead", type=int,
                         help="今日から指定日数分（今日を含む）を一括取得する。例: 60で今日から60日分")
    parser.add_argument("--json", help="結果をJSONファイルに保存するパス（--all-shops/--days-ahead時は無視）")
    parser.add_argument("--push-to-dynamo", action="store_true", help="結果をDynamoDBに書き込む")
    parser.add_argument("--with-detail", action="store_true",
                         help="部屋ごとに写真・平面図・設備の詳細情報も取得する"
                              "（buzz/noahのみ対応。部屋数だけ追加リクエストが発生するため通常運用では省略推奨）")
    args = parser.parse_args()

    if not args.shop and not args.all_shops:
        print("--shop または --all-shops のいずれかを指定してください", file=sys.stderr)
        sys.exit(1)
    if not args.date and not args.days_ahead:
        print("--date または --days-ahead のいずれかを指定してください", file=sys.stderr)
        sys.exit(1)

    scrape_fn = SCRAPE_FUNCTIONS[args.brand]
    shop_meta = SHOP_META_BY_BRAND[args.brand]
    shops = list(shop_meta.keys()) if args.all_shops else [args.shop]
    dates = daterange_from_today(args.days_ahead) if args.days_ahead else [args.date]

    total = len(shops) * len(dates)
    done = 0
    for shop in shops:
        for date in dates:
            done += 1
            print(f"[{done}/{total}] {shop} {date}")
            try:
                if args.with_detail and args.brand in ("buzz", "noah"):
                    result = scrape_fn(shop, date, with_detail=True)
                else:
                    result = scrape_fn(shop, date)
            except Exception as e:
                print(f"  エラー: {e}", file=sys.stderr)
                continue

            if args.push_to_dynamo:
                push_to_dynamo(result)

            if args.json and len(shops) == 1 and len(dates) == 1:
                with open(args.json, "w", encoding="utf-8") as f:
                    json.dump(result, f, ensure_ascii=False, indent=2)
                print(f"Saved to {args.json}")
            elif not args.push_to_dynamo:
                for room in result["rooms"]:
                    available_slots = [s["time"] for s in room["slots"] if s["available"]]
                    label = room["secondDimensionLabel"] or "?"
                    print(f"  [{room['roomName']}] {room['areaSqm']}㎡ / {label}{room['secondDimensionM']}m / {room['minPriceYen']}円〜")
                    print(f"    空き: {', '.join(available_slots) if available_slots else 'なし'}")

            if total > 1:
                time.sleep(0.5)  # サーバー負荷を避けるための小休止


if __name__ == "__main__":
    main()
