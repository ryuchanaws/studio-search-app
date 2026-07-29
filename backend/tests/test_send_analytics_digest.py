"""send_analytics_digest.py のテスト（moto で DynamoDB/SES をモック）。"""

import importlib
import os
from datetime import datetime, timedelta, timezone

import boto3
import pytest
from moto import mock_aws


@pytest.fixture
def digest_env():
    """moto上にAnalyticsEventsTable・StudiosTableを作成し、
    send_analytics_digestモジュールをこのモック配下で再読み込みして返す。
    """
    with mock_aws():
        client = boto3.client("dynamodb", region_name=os.environ["AWS_REGION"])
        client.create_table(
            TableName=os.environ["ANALYTICS_TABLE"],
            AttributeDefinitions=[{"AttributeName": "eventId", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "eventId", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        client.create_table(
            TableName=os.environ["STUDIOS_TABLE"],
            AttributeDefinitions=[{"AttributeName": "studioId", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "studioId", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        ses_client = boto3.client("ses", region_name=os.environ["AWS_REGION"])
        ses_client.verify_email_identity(EmailAddress=os.environ["NOTIFY_EMAIL"])

        import send_analytics_digest as sad
        importlib.reload(sad)
        yield sad


def _put_event(table, event_type: str, studio_id: str, minutes_ago: float = 0):
    created_at = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
    table.put_item(Item={
        "eventId": f"{event_type}-{studio_id}-{minutes_ago}",
        "eventType": event_type,
        "studioId": studio_id,
        "userId": "user-001",
        "createdAt": created_at,
    })


def test_handler_skips_email_when_no_events(digest_env):
    """イベントが1件も無い場合はメール送信をスキップする。"""
    sad = digest_env
    result = sad.handler({}, None)
    assert result["status"] == "skipped"
    assert result["viewCount"] == 0
    assert result["clickCount"] == 0


def test_handler_sends_digest_with_conversion_rate(digest_env):
    """閲覧・クリックの両方があれば集計してメールを送信する。"""
    sad = digest_env
    events_table = sad.dynamodb.Table(sad.ANALYTICS_TABLE)
    studios_table = sad.dynamodb.Table(sad.STUDIOS_TABLE)
    studios_table.put_item(Item={"studioId": "studio-001", "name": "テストスタジオ"})

    _put_event(events_table, "view_detail", "studio-001", minutes_ago=10)
    _put_event(events_table, "view_detail", "studio-001", minutes_ago=20)
    _put_event(events_table, "click_reserve", "studio-001", minutes_ago=5)

    result = sad.handler({}, None)
    assert result["status"] == "sent"
    assert result["viewCount"] == 2
    assert result["clickCount"] == 1


def test_handler_ignores_events_older_than_window(digest_env):
    """集計ウィンドウ（24時間）より古いイベントは対象外になる。"""
    sad = digest_env
    events_table = sad.dynamodb.Table(sad.ANALYTICS_TABLE)

    _put_event(events_table, "view_detail", "studio-001", minutes_ago=60 * 25)  # 25時間前
    result = sad.handler({}, None)
    assert result["status"] == "skipped"


def test_handler_returns_no_recipient_when_notify_email_unset(digest_env, monkeypatch):
    """NOTIFY_EMAIL未設定の場合はメール送信を試みず、no_recipientを返す。"""
    sad = digest_env
    monkeypatch.setattr(sad, "NOTIFY_EMAIL", "")
    events_table = sad.dynamodb.Table(sad.ANALYTICS_TABLE)
    _put_event(events_table, "view_detail", "studio-001")

    result = sad.handler({}, None)
    assert result["status"] == "no_recipient"


def test_top_studios_by_clicks_ranks_by_count(digest_env):
    """クリック数の多いスタジオが先頭に来る。"""
    sad = digest_env
    studios_table = sad.dynamodb.Table(sad.STUDIOS_TABLE)
    studios_table.put_item(Item={"studioId": "studio-a", "name": "スタジオA"})
    studios_table.put_item(Item={"studioId": "studio-b", "name": "スタジオB"})

    click_events = [
        {"studioId": "studio-a"},
        {"studioId": "studio-b"},
        {"studioId": "studio-b"},
    ]
    ranked = sad._top_studios_by_clicks(click_events)
    assert ranked[0] == ("スタジオB", 2)
    assert ranked[1] == ("スタジオA", 1)
