/**
 * @fileoverview イベント登録・おすすめスタジオ表示画面。
 *
 * 個人アカウント（Googleログイン）に「次のイベント」（ステージ実寸・出演人数）を
 * 複数件登録・管理でき、目的（振り入れ/構成）・日付・大体の時間を指定すると、
 * 【広さ条件を満たす】かつ【指定時間帯に空きあり】のスタジオ・部屋を絞り込んで表示する。
 */

import { useState, useEffect } from "react";
import { useAuth } from "react-oidc-context";
import { isAxiosError } from "axios";
import { Plus, Trash2, Sparkles, Ruler, Users, CalendarClock, RotateCcw } from "lucide-react";
import {
  getEvents,
  createEvent,
  deleteEvent,
  getRecommendedStudios,
} from "../api/client";
import type { StudioEvent, EventPurpose, RecommendedRoom } from "../types";
import { DetailModal } from "../components/DetailModal";
import { useFavorites } from "../hooks/useFavorites";
import { BRAND_LABELS, BRAND_COLORS } from "../utils/brand";
import type { Studio } from "../types";

/** 目的の選択肢（バックエンドの EVENT_PURPOSES と一致させる） */
const PURPOSE_OPTIONS: EventPurpose[] = ["振り入れ", "構成"];

/** 今日の日付を YYYY-MM-DD 形式で返す */
const todayStr = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/**
 * イベント登録・おすすめスタジオ表示ページコンポーネント。
 *
 * - ログイン必須。未ログイン時はログイン誘導のみ表示する
 * - 「次のイベント」（イベント名・ステージ実寸・出演人数）を複数件登録・削除できる
 * - 登録済みイベントを選び、目的・日付・大体の時間を指定すると、
 *   広さ条件と空き時間帯の両方を満たすスタジオ・部屋を一覧表示する
 *
 * @returns {JSX.Element} イベント登録・おすすめ表示画面
 */
export const EventsPage = () => {
  const auth = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [events, setEvents] = useState<StudioEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // イベント登録フォームの入力state
  const [title, setTitle] = useState("");
  const [stageWidthM, setStageWidthM] = useState("");
  const [stageDepthM, setStageDepthM] = useState("");
  const [performerCount, setPerformerCount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // おすすめ検索条件state
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<EventPurpose>("振り入れ");
  const [date, setDate] = useState(todayStr());
  const [startTime, setStartTime] = useState("18:00");
  const [durationMinutes, setDurationMinutes] = useState(120);

  const [recommendations, setRecommendations] = useState<RecommendedRoom[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedStudio, setSelectedStudio] = useState<Studio | null>(null);

  const fetchEvents = () => {
    setLoadingEvents(true);
    getEvents()
      .then((items) => {
        setEvents(items);
        if (items.length > 0 && !selectedEventId) {
          setSelectedEventId(items[0].eventId);
        }
      })
      .finally(() => setLoadingEvents(false));
  };

  useEffect(() => {
    if (auth.isAuthenticated) fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.isAuthenticated]);

  /**
   * イベント登録フォームを送信する。
   * ステージ実寸・出演人数は必須項目としてバリデーションする。
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const width = parseFloat(stageWidthM);
    const depth = parseFloat(stageDepthM);
    const count = parseInt(performerCount, 10);

    if (!title.trim()) {
      setFormError("イベント名を入力してください");
      return;
    }
    if (Number.isNaN(width) || Number.isNaN(depth) || width <= 0 || depth <= 0) {
      setFormError("ステージ実寸（縦横）を正しく入力してください");
      return;
    }
    if (Number.isNaN(count) || count <= 0) {
      setFormError("出演人数を正しく入力してください");
      return;
    }

    setSubmitting(true);
    try {
      await createEvent({ title, stageWidthM: width, stageDepthM: depth, performerCount: count });
      setTitle("");
      setStageWidthM("");
      setStageDepthM("");
      setPerformerCount("");
      setShowForm(false);
      fetchEvents();
    } catch {
      setFormError("イベントの登録に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (eventId: string) => {
    await deleteEvent(eventId);
    if (selectedEventId === eventId) setSelectedEventId(null);
    fetchEvents();
  };

  /**
   * 選択中のイベント・目的・日付・時間からおすすめスタジオを検索する。
   */
  const handleSearch = async () => {
    if (!selectedEventId) return;
    setSearching(true);
    setSearchError(null);
    setRecommendations(null);
    try {
      const items = await getRecommendedStudios({
        eventId: selectedEventId,
        purpose,
        date,
        startTime,
        durationMinutes,
      });
      setRecommendations(items);
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 401) {
        setSearchError("ログインの有効期限が切れている可能性があります。再度ログインしてください");
      } else {
        setSearchError("おすすめの取得に失敗しました");
      }
    } finally {
      setSearching(false);
    }
  };

  /**
   * 検索条件・検索結果をリセットし、条件を入力し直せるようにする。
   * 選択中のイベントはそのまま維持し、目的・日付・時間・利用時間を初期値に戻す。
   */
  const handleResetSearch = () => {
    setPurpose("振り入れ");
    setDate(todayStr());
    setStartTime("18:00");
    setDurationMinutes(120);
    setRecommendations(null);
    setSearchError(null);
  };

  if (!auth.isAuthenticated) {
    return (
      <div className="page events-page">
        <div className="page-header">
          <h1 className="page-title">
            <Sparkles size={22} />
            イベントからおすすめを探す
          </h1>
        </div>
        <div className="empty-state">
          <p>この機能を使うにはログインが必要です</p>
          <button className="btn-nav" onClick={() => auth.signinRedirect()}>
            ログイン
          </button>
        </div>
      </div>
    );
  }

  const selectedEvent = events.find((e) => e.eventId === selectedEventId) ?? null;

  return (
    <div className="page events-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Sparkles size={22} />
            イベントからおすすめを探す
          </h1>
          <p className="page-sub">ステージ実寸・出演人数を登録して、条件に合うスタジオを探す</p>
        </div>
        <button className="icon-btn" onClick={() => setShowForm((v) => !v)} title="イベントを登録">
          <Plus size={18} />
        </button>
      </div>

      {/* イベント登録フォーム */}
      {showForm && (
        <form className="event-form" onSubmit={handleSubmit}>
          <input
            className="event-form-input"
            placeholder="イベント名（例: 秋公演）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="event-form-row">
            <input
              className="event-form-input"
              type="number"
              step="0.1"
              placeholder="ステージ横幅(m)"
              value={stageWidthM}
              onChange={(e) => setStageWidthM(e.target.value)}
            />
            <input
              className="event-form-input"
              type="number"
              step="0.1"
              placeholder="ステージ奥行き(m)"
              value={stageDepthM}
              onChange={(e) => setStageDepthM(e.target.value)}
            />
            <input
              className="event-form-input"
              type="number"
              placeholder="出演人数"
              value={performerCount}
              onChange={(e) => setPerformerCount(e.target.value)}
            />
          </div>
          {formError && <div className="error-banner">{formError}</div>}
          <button className="btn-nav btn-reserve" type="submit" disabled={submitting}>
            {submitting ? "登録中..." : "イベントを登録"}
          </button>
        </form>
      )}

      {/* 登録済みイベント一覧 */}
      {loadingEvents ? (
        <div className="loading-state"><div className="loader" /></div>
      ) : events.length === 0 ? (
        <div className="empty-state">
          <p>まだイベントが登録されていません</p>
          <p className="empty-hint">右上の＋ボタンからステージ実寸・出演人数を登録しましょう</p>
        </div>
      ) : (
        <>
          <div className="event-list">
            {events.map((ev) => (
              <button
                key={ev.eventId}
                className={`event-chip ${selectedEventId === ev.eventId ? "active" : ""}`}
                onClick={() => setSelectedEventId(ev.eventId)}
              >
                <div className="event-chip-header">
                  <span className="event-chip-title">{ev.title}</span>
                  <Trash2
                    size={16}
                    className="event-chip-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(ev.eventId);
                    }}
                  />
                </div>
                <span className="event-chip-spec">
                  <Ruler size={14} style={{ verticalAlign: "-2px", marginRight: 3 }} />
                  ステージ {ev.stageWidthM}×{ev.stageDepthM}m
                </span>
                <span className="event-chip-spec">
                  <Users size={14} style={{ verticalAlign: "-2px", marginRight: 3 }} />
                  出演 {ev.performerCount}人
                </span>
              </button>
            ))}
          </div>

          {/* おすすめ検索条件 */}
          {selectedEvent && (
            <div className="event-search-bar">
              <div className="top-filter-group">
                <span className="top-filter-label">目的</span>
                {PURPOSE_OPTIONS.map((p) => (
                  <button
                    key={p}
                    className={`facility-tag sm facility-filter-chip ${purpose === p ? "active" : ""}`}
                    onClick={() => setPurpose(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className="event-search-row">
                <label className="event-search-field">
                  <CalendarClock size={12} /> 日付
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <label className="event-search-field">
                  時間
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </label>
                <label className="event-search-field">
                  利用時間
                  <select value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}>
                    <option value={60}>1時間</option>
                    <option value={90}>1.5時間</option>
                    <option value={120}>2時間</option>
                    <option value={180}>3時間</option>
                  </select>
                </label>
                <button className="btn-nav btn-reserve" onClick={handleSearch} disabled={searching}>
                  {searching ? "検索中..." : "おすすめを探す"}
                </button>
                {(recommendations != null || searchError) && (
                  <button className="btn-nav" onClick={handleResetSearch} title="検索条件をクリア">
                    <RotateCcw size={14} />
                    条件をクリア
                  </button>
                )}
              </div>
            </div>
          )}

          {searchError && <div className="error-banner">{searchError}</div>}

          {recommendations != null && (
            <div className="more-section">
              <h2 className="section-title">
                {recommendations.length > 0
                  ? `条件に合うスタジオ・部屋（${recommendations.length}件）`
                  : "条件に合うスタジオが見つかりませんでした"}
              </h2>
              <div className="room-detail-list">
                {recommendations.map(({ studio, room }) => (
                  <div
                    key={`${studio.studioId}-${room.roomName}`}
                    className="room-detail-card room-detail-card-clickable"
                    onClick={() => setSelectedStudio(studio)}
                  >
                    <div className="price-plan-row">
                      <span className="price-plan-label">
                        {studio.brand && (
                          <span
                            className="brand-badge sm"
                            style={{ background: BRAND_COLORS[studio.brand], marginRight: 6 }}
                          >
                            {BRAND_LABELS[studio.brand]}
                          </span>
                        )}
                        {studio.name} / {room.roomName}
                        {room.areaSqm != null && ` ${room.areaSqm}㎡`}
                      </span>
                      <span className="price-plan-yen">
                        {room.minPriceYen != null ? `¥${room.minPriceYen.toLocaleString()}〜` : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {selectedStudio && (
        <DetailModal
          studio={selectedStudio}
          isFavorite={isFavorite(selectedStudio.studioId)}
          onClose={() => setSelectedStudio(null)}
          onToggleFavorite={toggleFavorite}
        />
      )}
    </div>
  );
};
