"""
backfill_studio_details.py

discover_studios.py にスコアリング項目（収容人数・最寄り駅距離・料金）を追加する前に
発見済みだった既存スタジオへ、これらのフィールドを後追いで埋めるための一回限りのメンテナンススクリプト。

新規発見時は run_discovery() の中で自動的に付与されるが、既存スタジオは
重複判定（300m以内）で run_discovery() のループに到達しないため、
このスクリプトで個別にバックフィルする必要がある。

実行対象は本番のDynamoDBテーブル・実際のGoogle Places/Anthropic APIキーを直接使う
（motoでのモックは行わない）。ローカル端末のAWS認証情報（同じIAMユーザー）で実行すること。

Usage:
    cd backend/scripts
    ../.venv/Scripts/python.exe backfill_studio_details.py [--dry-run]
"""

import sys
import os
import time
import argparse
from decimal import Decimal
from pathlib import Path

# backend/lambda/batch を import パスに追加（discover_studios.py の関数を再利用するため）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lambda" / "batch"))

import boto3  # noqa: E402
import discover_studios as ds  # noqa: E402

AWS_REGION = "ap-northeast-1"
STUDIOS_TABLE = "studio-studios"

GOOGLE_PLACES_API_KEY_PARAM = "/studio-search/google-places-api-key"
ANTHROPIC_API_KEY_PARAM = "/studio-search/anthropic-api-key"

PLACES_FIND_PLACE_URL = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"


def find_place_id_by_name(name: str, lat: float, lng: float, api_key: str) -> str | None:
    """スタジオ名+座標からPlace IDを再検索する（既存データにplaceIdが無いための復旧手段）。

    Args:
        name    (str): スタジオ名
        lat     (float): 緯度
        lng     (float): 経度
        api_key (str): Google Places API キー

    Returns:
        str | None: 見つかったPlace ID。取得失敗時はNone
    """
    try:
        from urllib.parse import quote
        data = ds.http_get_json(PLACES_FIND_PLACE_URL, {
            "input": quote(name),
            "inputtype": "textquery",
            "fields": "place_id",
            "locationbias": f"point:{lat},{lng}",
            "key": api_key,
        })
        if data.get("status") != "OK":
            return None
        candidates = data.get("candidates", [])
        return candidates[0]["place_id"] if candidates else None
    except Exception as e:
        print(f"  Find Place error: {e}")
        return None


def main(dry_run: bool) -> None:
    ssm = boto3.client("ssm", region_name=AWS_REGION)
    places_key = ssm.get_parameter(Name=GOOGLE_PLACES_API_KEY_PARAM, WithDecryption=True)["Parameter"]["Value"]
    anthropic_key = ssm.get_parameter(Name=ANTHROPIC_API_KEY_PARAM, WithDecryption=True)["Parameter"]["Value"]

    table = boto3.resource("dynamodb", region_name=AWS_REGION).Table(STUDIOS_TABLE)
    items = table.scan()["Items"]

    targets = [it for it in items if "capacityCategory" not in it or "nearestStationDistanceM" not in it]
    print(f"Total studios: {len(items)} / needs backfill: {len(targets)}")

    for i, studio in enumerate(targets, start=1):
        studio_id = studio["studioId"]
        name = studio.get("name", studio_id)
        address = studio.get("description", "")
        lat = float(studio["lat"])
        lng = float(studio["lng"])
        print(f"[{i}/{len(targets)}] {name}")

        capacity_category = ds.guess_capacity(name, address, anthropic_key)
        nearest_station_m = ds.find_nearest_station_distance_m(lat, lng, places_key)

        place_id = studio.get("placeId")
        if not place_id:
            place_id = find_place_id_by_name(name, lat, lng, places_key)

        cost_yen = int(studio.get("costYen", 0))
        if cost_yen == 0 and place_id:
            website = ds.fetch_place_website(place_id, places_key)
            if website:
                scraped = ds.scrape_price_from_website(website, anthropic_key)
                if scraped is not None:
                    cost_yen = scraped

        print(f"    capacity={capacity_category} station={nearest_station_m}m cost={cost_yen} placeId={'yes' if place_id else 'no'}")

        if not dry_run:
            update_expr = "SET capacityCategory = :cap, costYen = :cost"
            expr_values: dict = {
                ":cap": capacity_category,
                ":cost": Decimal(str(cost_yen)),
            }
            if nearest_station_m is not None:
                update_expr += ", nearestStationDistanceM = :station"
                expr_values[":station"] = nearest_station_m
            if place_id:
                update_expr += ", placeId = :pid"
                expr_values[":pid"] = place_id

            table.update_item(
                Key={"studioId": studio_id},
                UpdateExpression=update_expr,
                ExpressionAttributeValues=expr_values,
            )

        # 外部API・Claude呼び出しが連続するため、レート制限を避けるための小休止
        time.sleep(0.3)

    print("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="DynamoDBを更新せず結果のみ表示する")
    args = parser.parse_args()
    main(dry_run=args.dry_run)
