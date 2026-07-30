/**
 * @fileoverview スタジオ詳細モーダルコンポーネント。
 *
 * スタジオカードをタップしたときに表示されるモーダル。
 * ブランド・住所・部屋一覧を表示し、
 * Google Maps ナビとお気に入りトグルボタンを提供する。
 */

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { X, Navigation2, Heart, MessageSquare, CalendarCheck, Phone, Ruler } from "lucide-react";
import type { Studio } from "../types";
import { recordAnalyticsEvent } from "../api/client";
import { ImagePreviewPopover } from "./ImagePreviewPopover";
import { BRAND_LABELS, BRAND_COLORS } from "../utils/brand";

/**
 * DetailModal コンポーネントの Props。
 */
interface DetailModalProps {
  /** 詳細表示するスタジオデータ */
  studio: Studio;
  /** 現在のお気に入り登録状態 */
  isFavorite: boolean;
  /** モーダルを閉じる関数 */
  onClose: () => void;
  /** お気に入りトグル関数 */
  onToggleFavorite: (studioId: string) => void;
}

/**
 * スタジオ詳細モーダルコンポーネント。
 *
 * - バックドロップ（背景）クリックでモーダルを閉じる
 * - ブランドに応じた色でヒーローセクションのボーダーを表示する
 * - お気に入りボタンは登録済みかどうかで表示を切り替える
 *
 * @param {DetailModalProps} props
 * @returns {JSX.Element} スタジオ詳細モーダル
 */
export const DetailModal = ({ studio, isFavorite, onClose, onToggleFavorite }: DetailModalProps) => {
  /** ブランドに応じたアクセントカラー */
  const accentColor = studio.brand ? BRAND_COLORS[studio.brand] : "#9ca3af";

  /** ヒーロー画像。studio.imageUrl（旧Google Places由来）が無ければ、
   * スクレイピング済みの部屋写真のうち最初に見つかったものをフォールバックとして使う */
  const heroImageUrl =
    studio.imageUrl ?? studio.rooms?.find((r) => r.photoUrls && r.photoUrls.length > 0)?.photoUrls?.[0];

  // 詳細モーダルが開かれた（=スタジオ詳細を表示した）タイミングで計測する。
  useEffect(() => {
    void recordAnalyticsEvent("view_detail", studio.studioId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Google Maps のルート案内を新しいタブで開く。
   */
  const openNav = () => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${studio.lat},${studio.lng}`;
    window.open(url, "_blank");
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="閉じる">
          <X size={20} />
        </button>

        {/* ヒーローセクション: スタジオ名とブランドを表示 */}
        <div className="modal-hero" style={{ borderBottom: `3px solid ${accentColor}` }}>
          <ImagePreviewPopover imageUrl={heroImageUrl}>
            <h2 className="modal-title-text">{studio.name}</h2>
          </ImagePreviewPopover>
          {studio.brand && (
            <span className="brand-badge" style={{ background: accentColor }}>
              {BRAND_LABELS[studio.brand]}
            </span>
          )}
        </div>

        {/* 住所セクション */}
        {(studio.address ?? studio.description) && (
          <div className="modal-section">
            <h3 className="modal-section-title">住所</h3>
            <p className="modal-reason">{studio.address ?? studio.description}</p>
          </div>
        )}

        {/* 部屋一覧セクション: 広さ・鏡または天井高・最安料金・写真・平面図・設備・予約リンク */}
        {studio.rooms && studio.rooms.length > 0 && (
          <div className="modal-section">
            <h3 className="modal-section-title">部屋一覧</h3>
            <div className="room-detail-list">
              {studio.rooms.map((room) => (
                <div key={room.roomName} className="room-detail-card">
                  <div className="price-plan-row">
                    <span className="price-plan-label">
                      <Ruler size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                      {room.roomName}
                      {room.areaSqm != null && ` ${room.areaSqm}㎡`}
                      {room.secondDimensionLabel && room.secondDimensionM != null &&
                        ` / ${room.secondDimensionLabel} ${room.secondDimensionM}m`}
                    </span>
                    {room.minPriceYen != null ? (
                      <span className="price-plan-yen">¥{room.minPriceYen.toLocaleString()}〜/時間</span>
                    ) : room.reserveUrl ? (
                      <a
                        href={room.reserveUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="price-plan-yen price-plan-inquiry-link"
                        onClick={(e) => e.stopPropagation()}
                      >
                        公式サイトで確認
                      </a>
                    ) : (
                      <span className="price-plan-yen">問合せ</span>
                    )}
                  </div>

                  {/* 部屋写真・平面図（取得できているブランドのみ表示）。
                      ホバー（PC）/長押し（スマホ）で拡大プレビューできる */}
                  {((room.photoUrls && room.photoUrls.length > 0) || room.floorPlanUrl) && (
                    <div className="room-photo-strip">
                      {room.photoUrls?.slice(0, 4).map((url) => (
                        <ImagePreviewPopover key={url} imageUrl={url}>
                          <img src={url} alt={`${room.roomName}の写真`} className="room-photo-thumb" />
                        </ImagePreviewPopover>
                      ))}
                      {room.floorPlanUrl && (
                        <ImagePreviewPopover imageUrl={room.floorPlanUrl}>
                          <img src={room.floorPlanUrl} alt={`${room.roomName}の平面図`} className="room-photo-thumb room-floorplan-thumb" />
                        </ImagePreviewPopover>
                      )}
                    </div>
                  )}

                  {/* 設備・特記事項（取得できているブランドのみ表示） */}
                  {room.equipment && room.equipment.length > 0 && (
                    <div className="room-equipment-tags">
                      {room.equipment.map((e) => (
                        <span key={e} className="facility-tag sm">{e}</span>
                      ))}
                    </div>
                  )}

                  {/* この部屋の公式サイト予約リンク（取得できているブランドのみ表示） */}
                  {room.reserveUrl && (
                    <a
                      href={room.reserveUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="room-reserve-link"
                      onClick={() => recordAnalyticsEvent("click_reserve", studio.studioId)}
                    >
                      <CalendarCheck size={12} />
                      この部屋を公式サイトで見る
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* アクションボタン: 予約・ナビ・お気に入り */}
        <div className="modal-actions">
          {/* 予約はアプリ内で完結させず、公式サイト or 電話番号への外部リンクとして提供する
              （実際の予約処理はスタジオ側のシステムに委ねる） */}
          {studio.website ?? studio.sourceUrl ? (
            <a
              href={studio.website ?? studio.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-nav btn-reserve"
              onClick={() => recordAnalyticsEvent("click_reserve", studio.studioId)}
            >
              <CalendarCheck size={16} />
              予約する（公式サイト）
            </a>
          ) : studio.phoneNumber ? (
            <a
              href={`tel:${studio.phoneNumber}`}
              className="btn-nav btn-reserve"
              onClick={() => recordAnalyticsEvent("click_reserve", studio.studioId)}
            >
              <Phone size={16} />
              電話で予約（{studio.phoneNumber}）
            </a>
          ) : null}

          <button className="btn-nav" onClick={openNav}>
            <Navigation2 size={16} />
            Google Mapsでナビ
          </button>

          <button
            className={`btn-fav ${isFavorite ? "active" : ""}`}
            onClick={() => onToggleFavorite(studio.studioId)}
          >
            <Heart size={16} fill={isFavorite ? "currentColor" : "none"} />
            {isFavorite ? "保存済み" : "お気に入りに追加"}
          </button>

          {/* このスタジオのレビュー一覧へ */}
          <Link to={`/posts?studioId=${studio.studioId}`} className="btn-nav">
            <MessageSquare size={16} />
            このスタジオのレビューを見る
          </Link>
        </div>
      </div>
    </div>
  );
};
