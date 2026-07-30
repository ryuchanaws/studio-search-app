#!/usr/bin/env python3
"""
ヨガ・ピラティス関連スタジオを DynamoDB から削除するスクリプト。

実行前に確認画面を表示し、ユーザーが明示的に削除を承認する必要があります。
"""

import os
import sys
import boto3

# DynamoDB リソース
dynamodb = boto3.resource("dynamodb", region_name="ap-northeast-1")
STUDIOS_TABLE = "studio-studios"
RECOMMENDATIONS_TABLE = "studio-recommendations"
POSTS_TABLE = "studio-posts"
FAVORITES_TABLE = "studio-favorites"

EXCLUDED_KEYWORDS = {"ヨガ", "yoga", "ピラティス", "pilates"}


def is_excluded_facility(name: str) -> bool:
    """ヨガ・ピラティスなどの除外対象スタジオかどうかを判定する。"""
    name_lower = name.lower()
    return any(kw in name_lower or kw in name for kw in EXCLUDED_KEYWORDS)


def find_excluded_studios():
    """除外対象のスタジオ ID と名前を取得する。"""
    table = dynamodb.Table(STUDIOS_TABLE)
    response = table.scan()
    items = response.get("Items", [])

    excluded = [
        (item["studioId"], item.get("name", "Unknown"))
        for item in items
        if is_excluded_facility(item.get("name", ""))
    ]
    return excluded


def confirm_deletion(excluded_studios):
    """ユーザーに削除対象を表示して、承認を取得する。"""
    print("\n========== 削除対象のスタジオ ==========")
    for studio_id, name in excluded_studios:
        print(f"  - {studio_id}: {name}")
    print(f"\n合計 {len(excluded_studios)} 件を削除します。")
    print("この操作は取り消せません。本当に削除しますか？ (yes/no): ", end="")

    user_input = input().strip().lower()
    return user_input == "yes"


def delete_studios(excluded_studios):
    """DynamoDB から除外対象スタジオとその関連データを削除する。"""
    studio_ids = [sid for sid, _ in excluded_studios]

    # Studio の削除
    studios_table = dynamodb.Table(STUDIOS_TABLE)
    print("\n[1/4] スタジオを削除中...")
    for sid in studio_ids:
        studios_table.delete_item(Key={"studioId": sid})
        print(f"  削除: {sid}")

    # Recommendation の削除
    recs_table = dynamodb.Table(RECOMMENDATIONS_TABLE)
    print("\n[2/4] おすすめデータを削除中...")
    for sid in studio_ids:
        recs_table.delete_item(Key={"studioId": sid})
        print(f"  削除: {sid}")

    # Posts の削除（studioId で紐づき）
    posts_table = dynamodb.Table(POSTS_TABLE)
    print("\n[3/4] 投稿を削除中...")
    response = posts_table.scan()
    posts = response.get("Items", [])
    for post in posts:
        if post.get("studioId") in studio_ids:
            posts_table.delete_item(Key={"postId": post["postId"]})
            print(f"  削除: {post['postId']} ({post.get('studioId')})")

    # Favorites の削除（studioId で紐づき）
    favs_table = dynamodb.Table(FAVORITES_TABLE)
    print("\n[4/4] お気に入りを削除中...")
    response = favs_table.scan()
    favs = response.get("Items", [])
    for fav in favs:
        if fav.get("studioId") in studio_ids:
            favs_table.delete_item(
                Key={"userId": fav["userId"], "studioId": fav["studioId"]}
            )
            print(f"  削除: userId={fav['userId']}, studioId={fav['studioId']}")

    print("\n✓ 削除完了")


if __name__ == "__main__":
    print("=== ヨガ・ピラティススタジオ削除ツール ===\n")

    excluded_studios = find_excluded_studios()

    if not excluded_studios:
        print("削除対象のスタジオがみつかりません。")
        sys.exit(0)

    if not confirm_deletion(excluded_studios):
        print("\n削除がキャンセルされました。")
        sys.exit(0)

    delete_studios(excluded_studios)
