"""discover_studios.py の純粋関数（haversine_km・guess_facilities）のテスト、
および写真取得・新規スタジオ探索ロジック（run_discovery）のテスト（moto で DynamoDB/S3 をモック）。
"""

import importlib
import os
from decimal import Decimal

import boto3
import discover_studios
import pytest
from moto import mock_aws


def test_haversine_km_same_point_is_zero():
    """同一地点同士の距離は0km。"""
    d = discover_studios.haversine_km(35.681, 139.767, 35.681, 139.767)
    assert d == 0.0


def test_haversine_km_known_distance_tokyo_to_yokohama():
    """東京駅〜横浜駅は実際には約27kmであり、許容誤差3km以内に収まること。"""
    tokyo = (35.681, 139.767)
    yokohama = (35.466, 139.622)
    d = discover_studios.haversine_km(*tokyo, *yokohama)
    assert 24.0 <= d <= 30.0


def test_guess_facilities_without_api_key_returns_default():
    """APIキーが空文字の場合、Claude呼び出しをせず汎用デフォルトを返す。"""
    result = discover_studios.guess_facilities("テストスタジオ", "テスト住所", api_key="")
    assert result == ["鏡張り", "フローリング"]


@pytest.fixture
def studios_table_for_discovery():
    """moto上にStudiosTable・アップロード用S3バケットを作成し、
    batch_common/discover_studiosをモック配下で再読み込みして返す。

    batch_common.py はimport時にモジュールレベルでboto3クライアントを生成するため、
    test_handlers_moto.py の dynamodb_tables フィクスチャと同じ理由でreloadが必要。
    discover_studios.py は batch_common から get_table/get_ssm_parameter/s3 を
    `from ... import` しているため、batch_common → discover_studios の順でreloadする。
    """
    with mock_aws():
        client = boto3.client("dynamodb", region_name=os.environ["AWS_REGION"])
        client.create_table(
            TableName=os.environ["STUDIOS_TABLE"],
            AttributeDefinitions=[{"AttributeName": "studioId", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "studioId", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        s3_client = boto3.client("s3", region_name=os.environ["AWS_REGION"])
        s3_client.create_bucket(
            Bucket=os.environ["UPLOADS_BUCKET"],
            CreateBucketConfiguration={"LocationConstraint": os.environ["AWS_REGION"]},
        )
        import batch_common
        import discover_studios as ds

        importlib.reload(batch_common)
        importlib.reload(ds)
        yield ds


def test_run_discovery_skips_duplicate_candidates(monkeypatch, studios_table_for_discovery):
    """既存スタジオと近傍（300m以内）の候補は重複としてスキップされる。"""
    ds = studios_table_for_discovery
    monkeypatch.setattr(ds, "get_ssm_parameter", lambda name: "fake-places-key")
    monkeypatch.setattr(ds, "guess_facilities", lambda *a, **k: ["鏡張り"])

    table = ds.get_table(os.environ["STUDIOS_TABLE"])
    table.put_item(Item={
        "studioId": "existing", "name": "既存スタジオ",
        "lat": Decimal("35.1"), "lng": Decimal("139.1"),
    })

    def fake_search_places(query, api_key, location_bias=None):
        return [
            {"name": "既存スタジオ(重複)", "lat": 35.1, "lng": 139.1, "address": "住所1", "types": [], "rating": 4.5, "user_ratings_total": 10, "photo_reference": None},
            {"name": "新規スタジオ", "lat": 35.2, "lng": 139.2, "address": "住所2", "types": [], "rating": 4.0, "user_ratings_total": 5, "photo_reference": None},
        ]

    monkeypatch.setattr(ds, "search_places", fake_search_places)

    result = ds.run_discovery()
    assert result["addedCount"] == 1
    assert result["skippedCount"] == 1

    names = [i["name"] for i in table.scan()["Items"]]
    assert "新規スタジオ" in names
    assert "既存スタジオ(重複)" not in names


def test_fetch_and_store_place_photo_uploads_and_returns_public_url(monkeypatch, studios_table_for_discovery):
    """写真バイトの取得に成功したらS3へアップロードし、公開URLを返す。"""
    ds = studios_table_for_discovery
    monkeypatch.setattr(ds, "http_get_bytes", lambda url, params: b"fake-jpeg-bytes")

    url = ds.fetch_and_store_place_photo("fake-photo-ref", "studio-abc123", "fake-places-key")

    assert url == f"https://{os.environ['UPLOADS_BUCKET']}.s3.{os.environ['AWS_REGION']}.amazonaws.com/studio-photos/studio-abc123.jpg"

    obj = ds.s3.get_object(Bucket=os.environ["UPLOADS_BUCKET"], Key="studio-photos/studio-abc123.jpg")
    assert obj["Body"].read() == b"fake-jpeg-bytes"


def test_fetch_and_store_place_photo_returns_none_on_error(monkeypatch, studios_table_for_discovery):
    """Places Photo API呼び出しが失敗した場合はNoneを返し、例外を投げない。"""
    ds = studios_table_for_discovery

    def raise_error(url, params):
        raise Exception("boom")

    monkeypatch.setattr(ds, "http_get_bytes", raise_error)

    assert ds.fetch_and_store_place_photo("fake-photo-ref", "studio-abc123", "fake-places-key") is None


def test_run_discovery_sets_image_url_when_photo_reference_present(monkeypatch, studios_table_for_discovery):
    """候補にphoto_referenceがあれば、写真を取得してStudiosのimageUrlに設定する。"""
    ds = studios_table_for_discovery
    monkeypatch.setattr(ds, "get_ssm_parameter", lambda name: "fake-places-key")
    monkeypatch.setattr(ds, "guess_facilities", lambda *a, **k: ["鏡張り"])
    monkeypatch.setattr(ds, "fetch_and_store_place_photo", lambda ref, studio_id, key: "https://example.com/photo.jpg")

    def fake_search_places(query, api_key, location_bias=None):
        return [{
            "name": "写真ありスタジオ", "lat": 35.3, "lng": 139.3,
            "address": "テスト住所3", "types": [], "rating": 4.2, "user_ratings_total": 20,
            "photo_reference": "ref-xyz",
        }]

    monkeypatch.setattr(ds, "search_places", fake_search_places)

    result = ds.run_discovery()
    assert result["addedCount"] == 1

    table = ds.get_table(os.environ["STUDIOS_TABLE"])
    items = table.scan()["Items"]
    assert items[0]["imageUrl"] == "https://example.com/photo.jpg"
    assert float(items[0]["rating"]) == 4.2
    assert items[0]["userRatingsTotal"] == 20
