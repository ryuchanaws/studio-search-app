/**
 * @fileoverview スタジオの空き状況モーダルコンポーネント。
 *
 * 日付を選択して GET /studios/{studioId}/availability を呼び出し、
 * 部屋ごとの広さ・料金・30分単位の空き状況をタイムテーブル形式で表示する。
 * scrapedAt が null の場合は「データ未取得」として案内メッセージを表示する
 * （エラー状態としては扱わない）。
 */

import { useEffect, useState } from "react";
import { X, CalendarClock, Loader2 } from "lucide-react";
import type { Studio, StudioAvailability } from "../types";
import { getStudioAvailability } from "../api/client";

/**
 * AvailabilityModal コンポーネントの Props。
 */
interface AvailabilityModalProps {
  /** 空き状況を表示する対象スタジオ */
  studio: Studio;
  /** モーダルを閉じる関数 */
  onClose: () => void;
}

/**
 * 今日の日付を YYYY-MM-DD 形式で返す。
 *
 * @returns {string} 今日の日付文字列
 */
const todayStr = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/**
 * スタジオ空き状況モーダルコンポーネント。
 *
 * - デフォルトで今日の日付の空き状況を取得する
 * - 日付ピッカーで日付を変更すると再取得する
 * - scrapedAt が null（未スクレイピング）の場合はエラーではなく案内メッセージを表示する
 * - rooms が空配列の場合（BUZZ以外のブランド）も同様に案内メッセージを表示する
 *
 * @param {AvailabilityModalProps} props
 * @returns {JSX.Element} スタジオ空き状況モーダル
 */
export const AvailabilityModal = ({ studio, onClose }: AvailabilityModalProps) => {
  const [date, setDate] = useState(todayStr());
  const [availability, setAvailability] = useState<StudioAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getStudioAvailability(studio.studioId, date)
      .then((data) => {
        if (!cancelled) setAvailability(data);
      })
      .catch(() => {
        if (!cancelled) setError("空き状況の取得に失敗しました");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studio.studioId, date]);

  const hasNoData = !loading && !error && (!availability || availability.scrapedAt == null || availability.rooms.length === 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="閉じる">
          <X size={20} />
        </button>

        <div className="modal-hero">
          <h2 className="modal-title-text">
            <CalendarClock size={20} style={{ verticalAlign: "-3px", marginRight: 6 }} />
            {studio.name} の空き状況
          </h2>
          <input
            type="date"
            className="availability-date-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="modal-section">
          {loading && (
            <div className="loading-state">
              <Loader2 size={24} className="spin" />
              <p>空き状況を読み込み中...</p>
            </div>
          )}

          {error && <div className="error-banner">{error}</div>}

          {hasNoData && (
            <p className="reason-text">このスタジオの空き状況データはまだありません</p>
          )}

          {!loading && !error && availability && availability.rooms.length > 0 && availability.scrapedAt != null && (
            <div className="availability-room-list">
              {availability.rooms.map((room) => (
                <div key={room.roomName} className="availability-room">
                  <div className="availability-room-header">
                    <span className="availability-room-name">{room.roomName}</span>
                    <span className="availability-room-spec">
                      {room.areaSqm != null && `${room.areaSqm}㎡`}
                      {room.secondDimensionLabel && room.secondDimensionM != null &&
                        ` / ${room.secondDimensionLabel} ${room.secondDimensionM}m`}
                      {room.minPriceYen != null && ` / ¥${room.minPriceYen.toLocaleString()}〜`}
                    </span>
                  </div>
                  <div className="availability-slot-list">
                    {room.slots.map((slot) => (
                      <span
                        key={slot.time}
                        className={`availability-slot ${slot.available ? "available" : "unavailable"}`}
                      >
                        {slot.time}
                      </span>
                    ))}
                  </div>
                  {room.reserveUrl && (
                    <a href={room.reserveUrl} target="_blank" rel="noreferrer" className="room-reserve-link">
                      公式サイトで予約する
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
