"""generate_studio_score.py の純粋関数（calc_score・normalize_*・_should_regenerate_reason）のテスト。"""

from datetime import datetime, timedelta, timezone

import generate_studio_score


def test_calc_score_perfect_conditions_no_distance_no_cost():
    """好条件（rating/popularity/appeal全て100、駅距離・費用0）でも、
    重み(0.4+0.2+0.2=0.8)の合計が1.0未満なのでスコアは80.0が上限になる。"""
    score = generate_studio_score.calc_score(
        rating_score=100, popularity_score=100, appeal_score=100, station_distance_km=0, cost_yen=0
    )
    assert score == 80.0


def test_calc_score_worst_conditions():
    """悪条件（全て0、駅距離・費用が上限超過）ならスコアは最低の0になる。"""
    score = generate_studio_score.calc_score(
        rating_score=0, popularity_score=0, appeal_score=0, station_distance_km=3.0, cost_yen=10000
    )
    assert score == 0.0


def test_calc_score_station_distance_penalty_is_capped():
    """station_distance_km が正規化上限(STATION_DISTANCE_NORM_KM)を超えても、
    ペナルティはそれ以上大きくならない。"""
    cap = generate_studio_score.STATION_DISTANCE_NORM_KM
    score_at_cap = generate_studio_score.calc_score(
        rating_score=80, popularity_score=80, appeal_score=80, station_distance_km=cap, cost_yen=0
    )
    score_over_cap = generate_studio_score.calc_score(
        rating_score=80, popularity_score=80, appeal_score=80, station_distance_km=cap * 10, cost_yen=0
    )
    assert score_at_cap == score_over_cap


def test_calc_score_is_within_valid_range():
    """スコアは常に0.0〜100.0の範囲に収まる。"""
    score = generate_studio_score.calc_score(
        rating_score=50, popularity_score=50, appeal_score=50, station_distance_km=0.75, cost_yen=2500
    )
    assert 0.0 <= score <= 100.0


def test_normalize_rating_scales_to_100():
    """Google Placesのrating(0〜5)を0〜100に正規化する。"""
    assert generate_studio_score.normalize_rating(5.0) == 100.0
    assert generate_studio_score.normalize_rating(0.0) == 0.0
    assert generate_studio_score.normalize_rating(2.5) == 50.0


def test_normalize_rating_returns_neutral_default_when_missing():
    """ratingが取得できない場合は中立的な60を返す。"""
    assert generate_studio_score.normalize_rating(None) == 60.0


def test_normalize_popularity_caps_at_100():
    """レビュー数は200件で頭打ちになる。"""
    assert generate_studio_score.normalize_popularity(0) == 0.0
    assert generate_studio_score.normalize_popularity(100) == 50.0
    assert generate_studio_score.normalize_popularity(1000) == 100.0


def test_estimate_studio_appeal_within_valid_range():
    """設備タグの数に関わらずスコアは30.0〜95.0に収まる。"""
    score_none = generate_studio_score.estimate_studio_appeal("テストスタジオ", [])
    score_many = generate_studio_score.estimate_studio_appeal(
        "テストスタジオ", ["鏡張り", "フローリング", "音響設備", "更衣室", "シャワー"]
    )
    assert 30.0 <= score_none <= 95.0
    assert 30.0 <= score_many <= 95.0
    assert score_many > score_none


def _fresh_recommendation(score: float, minutes_ago: float = 0) -> dict:
    """テスト用のRecommendationsTableアイテムを組み立てる。"""
    updated_at = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    return {"score": score, "reason": "テスト理由文", "updatedAt": updated_at.isoformat()}


def test_should_regenerate_reason_when_no_existing_recommendation():
    """初回（既存データが無い）場合は必ず再生成する。"""
    assert generate_studio_score._should_regenerate_reason(None, new_score=80.0) is True


def test_should_regenerate_reason_when_existing_has_no_reason():
    """既存データにreasonが無い（壊れたデータ等）場合も再生成する。"""
    existing = {"score": 80.0, "updatedAt": datetime.now(timezone.utc).isoformat()}
    assert generate_studio_score._should_regenerate_reason(existing, new_score=80.0) is True


def test_should_regenerate_reason_when_score_changed_significantly():
    """スコアがREASON_SCORE_CHANGE_THRESHOLD以上動いていれば再生成する。"""
    existing = _fresh_recommendation(score=50.0)
    new_score = 50.0 + generate_studio_score.REASON_SCORE_CHANGE_THRESHOLD
    assert generate_studio_score._should_regenerate_reason(existing, new_score) is True


def test_should_regenerate_reason_reuses_when_score_barely_changed_and_fresh():
    """スコアの変化が閾値未満かつ最近生成済みなら、前回の文章を使い回す（再生成しない）。"""
    existing = _fresh_recommendation(score=50.0, minutes_ago=10)
    new_score = 50.0 + (generate_studio_score.REASON_SCORE_CHANGE_THRESHOLD - 1)
    assert generate_studio_score._should_regenerate_reason(existing, new_score) is False


def test_should_regenerate_reason_when_stale_even_if_score_unchanged():
    """スコアが変わっていなくても、REASON_MAX_AGE_DAYS日以上経過していれば再生成する。"""
    old_days = generate_studio_score.REASON_MAX_AGE_DAYS * 24 * 60 + 1
    existing = _fresh_recommendation(score=50.0, minutes_ago=old_days)
    assert generate_studio_score._should_regenerate_reason(existing, new_score=50.0) is True


def test_should_regenerate_reason_when_updated_at_missing_or_invalid():
    """updatedAtが無い/壊れている場合は安全側に倒して再生成する。"""
    no_updated_at = {"score": 50.0, "reason": "テスト理由文"}
    assert generate_studio_score._should_regenerate_reason(no_updated_at, new_score=50.0) is True

    bad_updated_at = {"score": 50.0, "reason": "テスト理由文", "updatedAt": "not-a-date"}
    assert generate_studio_score._should_regenerate_reason(bad_updated_at, new_score=50.0) is True


def test_generate_reason_without_api_key_returns_fallback_text(monkeypatch):
    """Anthropic APIキー未設定時はAPI呼び出しをせずフォールバック文言を返す。"""
    monkeypatch.setattr(generate_studio_score, "_get_anthropic_api_key", lambda: "")
    reason = generate_studio_score.generate_reason(
        "テストスタジオ", ["鏡張り", "フローリング"], score=80.0,
        rating_score=90.0, popularity_score=70.0, station_distance_km=0.3,
        capacity_category="小グループ向け（6〜10人）", cost_yen=3000,
    )
    assert "テストスタジオ" in reason
    assert "鏡張り" in reason
