"""
send_analytics_digest.py

AnalyticsEventsTable の直近24時間分のイベント（view_detail・click_reserve）を集計し、
閲覧数・予約ボタンクリック数・コンバージョン率をメールで通知する日次バッチ。

EventBridge スケジュール（毎日AM6:30 JST、スコア計算バッチの30分後）から起動される。

注意:
    「予約完了」自体は外部サイト（スタジオの公式サイトや電話）で行われるため、
    このアプリからは計測できない。click_reserve が示すのは
    「予約ページ・電話番号へのクリック」までであり、実際に予約が成立したかどうかは
    分からない。コンバージョン率もこの前提のもとでの近似値である。

Requirements:
    - 環境変数 ANALYTICS_TABLE / STUDIOS_TABLE / NOTIFY_EMAIL が設定済みであること
    - Lambda 実行ロールに DynamoDB 読み取り権限・SES送信権限（ses:SendEmail）があること
    - 送信元・宛先メールアドレス（NOTIFY_EMAIL）がSESでVerifiedであること
      （SESサンドボックス環境では未検証のアドレスへは送信できない）
"""

import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

import boto3

AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-1")
ANALYTICS_TABLE = os.environ.get("ANALYTICS_TABLE", "studio-analytics-events")
STUDIOS_TABLE = os.environ.get("STUDIOS_TABLE", "studio-studios")
# SESはサンドボックス環境では送信元・宛先とも事前にVerifiedである必要がある。
# 個人利用のため送信元・宛先を同じアドレスにしている
NOTIFY_EMAIL = os.environ.get("NOTIFY_EMAIL", "")

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
ses = boto3.client("ses", region_name=AWS_REGION)

# 集計対象の期間（時間）。日次バッチのため24時間分を対象にする
DIGEST_WINDOW_HOURS = 24
# メール本文に含めるスタジオ別ランキングの件数
TOP_STUDIOS_LIMIT = 5


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """直近24時間分のアナリティクスイベントを集計し、ダイジェストメールを送信する。

    イベントが1件も無い日はメール送信自体をスキップする（無駄な通知を避けるため）。

    Args:
        event   (dict[str, Any]): Lambda イベントオブジェクト（内容は不使用）
        context (Any): Lambda コンテキストオブジェクト

    Returns:
        dict[str, Any]: {"status": "sent"|"skipped"|"no_recipient", "viewCount": int,
            "clickCount": int}
    """
    print("sendAnalyticsDigestBatch started")

    events_table = dynamodb.Table(ANALYTICS_TABLE)
    items = events_table.scan().get("Items", [])

    cutoff = datetime.now(timezone.utc) - timedelta(hours=DIGEST_WINDOW_HOURS)
    recent = [it for it in items if _is_recent(it.get("createdAt"), cutoff)]

    view_events = [it for it in recent if it.get("eventType") == "view_detail"]
    click_events = [it for it in recent if it.get("eventType") == "click_reserve"]

    view_count = len(view_events)
    click_count = len(click_events)

    if view_count == 0 and click_count == 0:
        print("No analytics events in the last 24h, skipping email")
        return {"status": "skipped", "viewCount": 0, "clickCount": 0}

    conversion_rate = (click_count / view_count * 100) if view_count > 0 else None

    top_studios = _top_studios_by_clicks(click_events)
    body = _build_email_body(view_count, click_count, conversion_rate, top_studios)

    if not NOTIFY_EMAIL:
        print("NOTIFY_EMAIL not configured, skipping email")
        return {"status": "no_recipient", "viewCount": view_count, "clickCount": click_count}

    try:
        ses.send_email(
            Source=NOTIFY_EMAIL,
            Destination={"ToAddresses": [NOTIFY_EMAIL]},
            Message={
                "Subject": {"Data": f"【スタジオサーチ】昨日のアクセス状況（閲覧{view_count}件・予約クリック{click_count}件）"},
                "Body": {"Text": {"Data": body}},
            },
        )
        print(f"Digest email sent: views={view_count} clicks={click_count}")
    except Exception as e:
        # SES未検証・権限不足等でも失敗させず、次回のバッチ実行に影響を残さない
        print(f"SES send_email error: {e}")
        return {"status": "failed", "viewCount": view_count, "clickCount": click_count, "error": str(e)}

    return {"status": "sent", "viewCount": view_count, "clickCount": click_count}


def _is_recent(created_at: str | None, cutoff: datetime) -> bool:
    """createdAt（ISO 8601文字列）がcutoff以降かどうかを判定する。

    Args:
        created_at (str | None): イベントのcreatedAt
        cutoff      (datetime): この時刻以降のイベントのみ対象とする

    Returns:
        bool: cutoff以降ならTrue。created_atが無い/壊れている場合は安全側に倒してFalse
    """
    if not created_at:
        return False
    try:
        return datetime.fromisoformat(created_at) >= cutoff
    except ValueError:
        return False


def _top_studios_by_clicks(click_events: list[dict[str, Any]]) -> list[tuple[str, int]]:
    """予約ボタンクリック数が多いスタジオ上位N件を (スタジオ名, クリック数) で返す。

    Args:
        click_events (list[dict[str, Any]]): click_reserveイベントのリスト

    Returns:
        list[tuple[str, int]]: クリック数降順の (スタジオ名, クリック数) リスト
    """
    counts = Counter(e["studioId"] for e in click_events if e.get("studioId"))
    if not counts:
        return []

    studios_table = dynamodb.Table(STUDIOS_TABLE)
    names: dict[str, str] = {}
    for studio_id in counts:
        try:
            resp = studios_table.get_item(Key={"studioId": studio_id})
            names[studio_id] = resp.get("Item", {}).get("name", studio_id)
        except Exception:
            names[studio_id] = studio_id

    ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:TOP_STUDIOS_LIMIT]
    return [(names.get(studio_id, studio_id), count) for studio_id, count in ranked]


def _build_email_body(view_count: int, click_count: int, conversion_rate: float | None,
                       top_studios: list[tuple[str, int]]) -> str:
    """ダイジェストメールの本文（プレーンテキスト）を組み立てる。

    Args:
        view_count      (int): 詳細表示（view_detail）の件数
        click_count     (int): 予約ボタンクリック（click_reserve）の件数
        conversion_rate (float | None): クリック数/閲覧数（%）。閲覧が0件ならNone
        top_studios     (list[tuple[str, int]]): クリック数上位スタジオ

    Returns:
        str: メール本文
    """
    lines = [
        "直近24時間のアクセス状況です。",
        "",
        f"スタジオ詳細の表示: {view_count}件",
        f"予約ボタンのクリック: {click_count}件",
    ]
    if conversion_rate is not None:
        lines.append(f"コンバージョン率（クリック/表示）: {conversion_rate:.1f}%")
    lines.append("")
    lines.append("※「予約完了」は外部サイトで行われるため計測できません。上記は「予約ページへのクリック」までの数値です。")

    if top_studios:
        lines.append("")
        lines.append("予約クリックが多かったスタジオ:")
        for name, count in top_studios:
            lines.append(f"  {name}: {count}件")

    return "\n".join(lines)
