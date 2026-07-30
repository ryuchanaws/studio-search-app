/**
 * @fileoverview スタジオカードコンポーネント。
 *
 * トップページ一覧・現在地から探す・お気に入り一覧で共通利用するカード UI。
 * ブランドバッジ・住所・部屋の広さ目安を表示し、
 * ナビボタンとお気に入りトグルボタンを提供する。
 */

import { useState } from "react";
import { Heart, Navigation2, MapPin, Ruler, CalendarCheck, Phone } from "lucide-react";
import type { Studio } from "../types";
import { recordAnalyticsEvent } from "../api/client";
import { ImagePreviewPopover } from "./ImagePreviewPopover";
import { BRAND_LABELS, BRAND_COLORS } from "../utils/brand";

/**
 * StudioCard コンポーネントの Props。
 */
interface StudioCardProps {
  /** 表示するスタジオデータ */
  studio: Studio;
  /** ランク番号（現在地から探す等で渡す。省略時はバッジ非表示） */
  rank?: number;
  /** 現在地からの距離（km・省略可。渡された場合はメタ情報に表示） */
  distanceKm?: number;
  /** 現在のお気に入り登録状態 */
  isFavorite: boolean;
  /** お気に入りトグル関数 */
  onToggleFavorite: (studioId: string) => void;
  /** カードクリック時に呼び出す関数（詳細モーダルを開く） */
  onClick: (studio: Studio) => void;
}

/**
 * スタジオの部屋一覧から広さの目安（最小〜最大㎡）を文字列で返す。
 *
 * @param {Studio} studio - 対象スタジオ
 * @returns {string | null} 広さ目安の文字列。部屋データが無ければnull
 */
const roomSizeSummary = (studio: Studio): string | null => {
  const areas = (studio.rooms ?? []).map((r) => r.areaSqm).filter((a): a is number => a != null);
  if (areas.length === 0) return null;
  const min = Math.min(...areas);
  const max = Math.max(...areas);
  return min === max ? `${min}㎡` : `${min}〜${max}㎡`;
};

/**
 * スタジオカードコンポーネント。
 *
 * - rank が渡されたときのみランクバッジ（#1〜）を表示する
 * - rank が渡されており、かつスタジオ写真がある場合はカード上部にヒーロー写真を表示する
 * - ブランドに応じた色でバッジを表示する
 * - ナビボタンクリックで Google Maps のルート案内を新しいタブで開く
 * - お気に入りボタンは登録状態に応じてハートの塗りつぶしを切り替える
 * - カード全体がクリッカブルで onClick で詳細モーダルを開く
 *
 * @param {StudioCardProps} props
 * @returns {JSX.Element} スタジオカード
 */
export const StudioCard = ({
  studio,
  rank,
  distanceKm,
  isFavorite,
  onToggleFavorite,
  onClick,
}: StudioCardProps) => {
  /** ブランドに応じたアクセントカラー */
  const accentColor = studio.brand ? BRAND_COLORS[studio.brand] : "#9ca3af";

  /** 写真の読み込みに失敗したかどうか（S3オブジェクト未存在・権限エラー等）。
   * 失敗時は壊れた画像アイコンを出さず、写真無し扱いのレイアウトにフォールバックする */
  const [imgFailed, setImgFailed] = useState(false);

  /**
   * Google Maps のルート案内を新しいタブで開く。
   * カード全体のクリックイベントが伝播しないよう stopPropagation する。
   *
   * @param {React.MouseEvent} e - マウスイベント
   */
  const openNav = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `https://www.google.com/maps/dir/?api=1&destination=${studio.lat},${studio.lng}`;
    window.open(url, "_blank");
  };

  const sizeSummary = roomSizeSummary(studio);

  return (
    <div className="rec-card" onClick={() => onClick(studio)} role="button" tabIndex={0}>
      {/* ヒーロー写真: rankが渡されており、かつスタジオ写真が登録されている場合のみ表示 */}
      {rank && studio.imageUrl && !imgFailed && (
        <img
          className="rec-card-photo"
          src={studio.imageUrl}
          alt={studio.name ?? ""}
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      )}

      {/* ランクバッジ: rank が渡されたときのみ表示 */}
      {rank && (
        <div className="rank-badge" style={{ background: accentColor }}>
          #{rank}
        </div>
      )}

      {/* カードヘッダー: スタジオ名・ブランドバッジ */}
      <div className="card-header">
        <div>
          {/* スタジオ名: hover(PC)/長押し(スマホ)でスタジオ写真をプレビュー表示 */}
          <ImagePreviewPopover imageUrl={studio.imageUrl}>
            <h3 className="card-name">{studio.name}</h3>
          </ImagePreviewPopover>
        </div>

        {studio.brand && (
          <span className="brand-badge" style={{ background: accentColor }}>
            {BRAND_LABELS[studio.brand]}
          </span>
        )}
      </div>

      {/* メタ情報: 住所・広さ目安・距離 */}
      <div className="card-meta">
        {(studio.address ?? studio.description) && (
          <span>
            <MapPin size={12} style={{ verticalAlign: "-2px" }} /> {studio.address ?? studio.description}
          </span>
        )}
        {sizeSummary && (
          <span>
            <Ruler size={12} style={{ verticalAlign: "-2px" }} /> {sizeSummary}
          </span>
        )}
        {distanceKm != null && (
          <span>
            <Navigation2 size={12} style={{ verticalAlign: "-2px" }} /> {distanceKm.toFixed(1)}km
          </span>
        )}
      </div>

      {/* アクションボタン: クリックイベントがカード全体に伝播しないよう stopPropagation */}
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        {/* 予約リンク: 詳細モーダルを開かずカードから直接ワンクリックで予約ページへ。
            公式サイトが無ければ電話番号のtel:リンクにフォールバックし、どちらも無ければ非表示 */}
        {studio.website ? (
          <a
            href={studio.website}
            target="_blank"
            rel="noreferrer"
            className="reserve-btn"
            onClick={() => recordAnalyticsEvent("click_reserve", studio.studioId)}
          >
            <CalendarCheck size={15} />
            予約する
          </a>
        ) : studio.phoneNumber ? (
          <a
            href={`tel:${studio.phoneNumber}`}
            className="reserve-btn"
            onClick={() => recordAnalyticsEvent("click_reserve", studio.studioId)}
          >
            <Phone size={15} />
            電話で予約
          </a>
        ) : null}

        {/* Google Maps ナビゲーションボタン */}
        <button className="nav-btn" onClick={openNav}>
          <Navigation2 size={15} />
          ナビ開始
        </button>

        {/* お気に入りトグルボタン: 登録済みかどうかでハートの塗りつぶしを切り替え */}
        <button
          className={`fav-btn ${isFavorite ? "active" : ""}`}
          onClick={() => onToggleFavorite(studio.studioId)}
          aria-label={isFavorite ? "お気に入りから削除" : "お気に入りに追加"}
        >
          <Heart size={15} fill={isFavorite ? "currentColor" : "none"} />
          {isFavorite ? "保存済み" : "保存"}
        </button>
      </div>
    </div>
  );
};
