/**
 * @fileoverview おすすめスタジオカードコンポーネント。
 *
 * TOP3・その他一覧・お気に入り一覧で共通利用するカード UI。
 * スコア・設備・AI コメント・評価/人気度・距離・費用を表示し、
 * ナビボタンとお気に入りトグルボタンを提供する。
 */

import { useState } from "react";
import { Heart, Navigation2, Sparkles } from "lucide-react";
import type { Recommendation } from "../types";
import { getScoreColor, getScoreLabel, formatScore, getRatingIcon, getPopularityIcon } from "../utils/score";
import { ImagePreviewPopover } from "./ImagePreviewPopover";

/**
 * RecommendationCard コンポーネントの Props。
 */
interface RecommendationCardProps {
  /** 表示するおすすめデータ */
  recommendation: Recommendation;
  /** ランク番号（TOP3 表示時のみ渡す。省略時はバッジ非表示） */
  rank?: number;
  /** 現在のお気に入り登録状態 */
  isFavorite: boolean;
  /** お気に入りトグル関数 */
  onToggleFavorite: (studioId: string) => void;
  /** カードクリック時に呼び出す関数（詳細モーダルを開く） */
  onClick: (rec: Recommendation) => void;
}

/**
 * おすすめスタジオカードコンポーネント。
 *
 * - rank が渡されたときのみランクバッジ（#1〜#3）を表示する
 * - rank が渡されており、かつスタジオ写真がある場合はカード上部にヒーロー写真を表示する
 *   （TOP3のみ。その他一覧・お気に入り一覧では従来通りホバー/長押しプレビューのみ）
 * - スコアに応じた色でスコアサークルのボーダーを表示する
 * - ナビボタンクリックで Google Maps のルート案内を新しいタブで開く
 * - お気に入りボタンは登録状態に応じてハートの塗りつぶしを切り替える
 * - カード全体がクリッカブルで onClick で詳細モーダルを開く
 *
 * @param {RecommendationCardProps} props
 * @returns {JSX.Element} おすすめスタジオカード
 */
export const RecommendationCard = ({
  recommendation: rec,
  rank,
  isFavorite,
  onToggleFavorite,
  onClick,
}: RecommendationCardProps) => {
  /** スコアに応じたアクセントカラー */
  const scoreColor = getScoreColor(rec.score);

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
    const url = `https://www.google.com/maps/dir/?api=1&destination=${rec.studio?.lat ?? 0},${rec.studio?.lng ?? 0}`;
    window.open(url, "_blank");
  };

  return (
    <div className="rec-card" onClick={() => onClick(rec)} role="button" tabIndex={0}>
      {/* TOP3ヒーロー写真: rankが渡されており、かつスタジオ写真が登録されている場合のみ表示。
          読み込みに失敗した場合はimgFailedを立てて非表示にフォールバックする */}
      {rank && rec.studio?.imageUrl && !imgFailed && (
        <img
          className="rec-card-photo"
          src={rec.studio.imageUrl}
          alt={rec.studio?.name ?? ""}
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      )}

      {/* ランクバッジ: rank が渡されたときのみ表示（1位: 金・2位: 銀・3位: 銅） */}
      {rank && (
        <div className="rank-badge" style={{ background: rank === 1 ? "#f5a623" : rank === 2 ? "#aaa" : "#cd7f32" }}>
          #{rank}
        </div>
      )}

      {/* カードヘッダー: スタジオ名・設備タグ・スコアサークル */}
      <div className="card-header">
        <div>
          {/* スタジオ名: hover(PC)/長押し(スマホ)でスタジオ写真をプレビュー表示 */}
          <ImagePreviewPopover imageUrl={rec.studio?.imageUrl}>
            <h3 className="card-name">{rec.studio?.name ?? rec.studioId}</h3>
          </ImagePreviewPopover>
          {/* 設備タグ一覧 */}
          <div className="facility-tags">
            {rec.facilityTags.map((f) => (
              <span key={f} className="facility-tag">
                <Sparkles size={11} />
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* スコアサークル: スコアに応じた色のボーダーで囲む */}
        <div className="score-circle" style={{ borderColor: scoreColor, color: scoreColor }}>
          <span className="score-num">{formatScore(rec.score)}</span>
          <span className="score-label">{getScoreLabel(rec.score)}</span>
        </div>
      </div>

      {/* AI コメント: 2行で切り捨て表示 */}
      <p className="reason-text">{rec.reason}</p>

      {/* メタ情報: 評価・人気度・距離・費用 */}
      <div className="card-meta">
        <span>{getRatingIcon(rec.ratingScore ?? 0)} 評価 {Math.round(rec.ratingScore ?? 0)}</span>
        <span>{getPopularityIcon(rec.popularityScore ?? 0)} 人気 {Math.round(rec.popularityScore ?? 0)}</span>
        <span>📍 {rec.distance != null ? rec.distance.toFixed(1) : "0.0"}km</span>
        <span>💰 {!rec.cost || rec.cost === 0 ? "問合せ" : `¥${rec.cost.toLocaleString()}`}</span>
      </div>

      {/* アクションボタン: クリックイベントがカード全体に伝播しないよう stopPropagation */}
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        {/* Google Maps ナビゲーションボタン */}
        <button className="nav-btn" onClick={openNav}>
          <Navigation2 size={15} />
          ナビ開始
        </button>

        {/* お気に入りトグルボタン: 登録済みかどうかでハートの塗りつぶしを切り替え */}
        <button
          className={`fav-btn ${isFavorite ? "active" : ""}`}
          onClick={() => onToggleFavorite(rec.studioId)}
          aria-label={isFavorite ? "お気に入りから削除" : "お気に入りに追加"}
        >
          <Heart size={15} fill={isFavorite ? "currentColor" : "none"} />
          {isFavorite ? "保存済み" : "保存"}
        </button>
      </div>
    </div>
  );
};
