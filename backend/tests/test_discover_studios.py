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


def test_is_excluded_by_name_matches_yoga_and_pilates():
    """ヨガ・ピラティス関連のキーワードを含む店名は除外対象と判定される（大文字小文字も無視）。"""
    assert discover_studios.is_excluded_by_name("〇〇ヨガスタジオ") is True
    assert discover_studios.is_excluded_by_name("△△Yoga Studio") is True
    assert discover_studios.is_excluded_by_name("ピラティススタジオ□□") is True
    assert discover_studios.is_excluded_by_name("Pilates Room") is True


def test_is_excluded_by_name_does_not_match_dance_studio():
    """ダンススタジオの店名は除外対象と判定されない。"""
    assert discover_studios.is_excluded_by_name("〇〇ダンススタジオ") is False
    assert discover_studios.is_excluded_by_name("レンタルスタジオ鏡張り") is False


def test_guess_capacity_without_api_key_returns_default():
    """APIキーが空文字の場合、Claude呼び出しをせずデフォルト区分を返す。"""
    result = discover_studios.guess_capacity("テストスタジオ", "テスト住所", api_key="")
    assert result == discover_studios.DEFAULT_CAPACITY_CATEGORY


def test_find_nearest_station_distance_m_returns_none_on_api_error(monkeypatch):
    """Places Nearby Search呼び出しが失敗した場合はNoneを返し、例外を投げない。"""
    def raise_error(url, params):
        raise Exception("boom")

    monkeypatch.setattr(discover_studios, "http_get_json", raise_error)
    assert discover_studios.find_nearest_station_distance_m(35.681, 139.767, "fake-key") is None


def test_find_nearest_station_distance_m_computes_distance(monkeypatch):
    """Nearby Searchの先頭結果（最寄り駅）との距離をメートル単位で返す。"""
    def fake_get_json(url, params):
        return {
            "status": "OK",
            "results": [{"geometry": {"location": {"lat": 35.682, "lng": 139.767}}}],
        }

    monkeypatch.setattr(discover_studios, "http_get_json", fake_get_json)
    distance = discover_studios.find_nearest_station_distance_m(35.681, 139.767, "fake-key")
    assert distance is not None
    assert 0 < distance < 500


def test_fetch_place_details_returns_none_values_when_not_ok(monkeypatch):
    """Place Details APIがOK以外を返した場合はwebsite/phoneNumberともNoneを返す。"""
    monkeypatch.setattr(discover_studios, "http_get_json", lambda url, params: {"status": "NOT_FOUND"})
    result = discover_studios.fetch_place_details("fake-place-id", "fake-key")
    assert result == {"website": None, "phoneNumber": None}


def test_fetch_place_details_returns_website_and_phone_when_present(monkeypatch):
    """Place Details APIがwebsite/formatted_phone_numberを返せばそのまま返す。"""
    monkeypatch.setattr(
        discover_studios, "http_get_json",
        lambda url, params: {
            "status": "OK",
            "result": {"website": "https://example.com", "formatted_phone_number": "03-1234-5678"},
        },
    )
    result = discover_studios.fetch_place_details("fake-place-id", "fake-key")
    assert result == {"website": "https://example.com", "phoneNumber": "03-1234-5678"}


def test_scrape_price_plans_without_api_key_returns_none():
    """Anthropic APIキー未設定時は取得を試みずNoneを返す。"""
    assert discover_studios.scrape_price_plans_from_website("https://example.com", api_key="") is None


def test_scrape_price_plans_returns_none_on_fetch_error(monkeypatch):
    """サイト取得自体が失敗した場合はNoneを返し、例外を投げない。"""
    def raise_error(req, timeout):
        raise Exception("connection refused")

    monkeypatch.setattr(discover_studios.urllib.request, "urlopen", raise_error)
    assert discover_studios.scrape_price_plans_from_website("https://example.com", api_key="fake-anthropic-key") is None


def test_scrape_price_plans_parses_valid_json_array(monkeypatch):
    """Claudeが正しいJSON配列を返せば、label/priceYenのリストとして返す。"""
    class FakeContent:
        def __init__(self, text):
            self.text = text

    class FakeResponse:
        def __init__(self, text):
            self.content = [FakeContent(text)]

    class FakeMessages:
        def create(self, **kwargs):
            return FakeResponse('[{"label": "Aスタジオ 20㎡", "priceYen": 3000}, {"label": "Bスタジオ 40㎡", "priceYen": 5000}]')

    class FakeAnthropic:
        def __init__(self, api_key):
            self.messages = FakeMessages()

    monkeypatch.setattr(discover_studios.urllib.request, "urlopen", lambda req, timeout: _FakeHttpResponse(b"<html>price info</html>"))
    monkeypatch.setattr(discover_studios.anthropic, "Anthropic", FakeAnthropic)

    plans = discover_studios.scrape_price_plans_from_website("https://example.com", api_key="fake-anthropic-key")
    assert plans == [
        {"label": "Aスタジオ 20㎡", "priceYen": 3000},
        {"label": "Bスタジオ 40㎡", "priceYen": 5000},
    ]


def test_scrape_price_plans_returns_empty_list_when_no_price_found(monkeypatch):
    """Claudeが空配列を返せば、料金情報なしとして空リストを返す（Noneとは区別する）。"""
    class FakeContent:
        def __init__(self, text):
            self.text = text

    class FakeResponse:
        def __init__(self, text):
            self.content = [FakeContent(text)]

    class FakeMessages:
        def create(self, **kwargs):
            return FakeResponse("[]")

    class FakeAnthropic:
        def __init__(self, api_key):
            self.messages = FakeMessages()

    monkeypatch.setattr(discover_studios.urllib.request, "urlopen", lambda req, timeout: _FakeHttpResponse(b"<html>no price</html>"))
    monkeypatch.setattr(discover_studios.anthropic, "Anthropic", FakeAnthropic)

    plans = discover_studios.scrape_price_plans_from_website("https://example.com", api_key="fake-anthropic-key")
    assert plans == []


class _FakeHttpResponse:
    """urllib.request.urlopen()の戻り値（コンテキストマネージャ）を模倣する簡易フェイク。"""

    def __init__(self, body: bytes):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self._body


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
    monkeypatch.setattr(ds, "guess_capacity", lambda *a, **k: ds.DEFAULT_CAPACITY_CATEGORY)
    monkeypatch.setattr(ds, "find_nearest_station_distance_m", lambda *a, **k: 300)

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
    monkeypatch.setattr(ds, "guess_capacity", lambda *a, **k: ds.DEFAULT_CAPACITY_CATEGORY)
    monkeypatch.setattr(ds, "find_nearest_station_distance_m", lambda *a, **k: 300)
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
