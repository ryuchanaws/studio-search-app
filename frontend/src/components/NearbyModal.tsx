/**
 * @fileoverview 「現在地から探す」モーダルコンポーネント。
 *
 * ブラウザの現在地を取得し、取得済みのスタジオ一覧を
 * 実際の現在地からの距離が近い順に並べ替えて表示するサブ機能。
 * DBへの書き込みは行わず、クライアント側だけで完結する。
 */

import { useEffect, useMemo } from "react";
import { X, LocateFixed, Loader2 } from "lucide-react";
import type { Studio } from "../types";
import { useGeolocation } from "../hooks/useGeolocation";
import { haversineKm } from "../utils/distance";
import { StudioCard } from "./StudioCard";

/**
 * NearbyModal コンポーネントの Props。
 */
interface NearbyModalProps {
  /** 取得済みのスタジオ一覧（現在地基準に並べ替える元データ） */
  studios: Studio[];
  /** お気に入り確認関数 */
  isFavorite: (studioId: string) => boolean;
  /** お気に入りトグル関数 */
  onToggleFavorite: (studioId: string) => void;
  /** カードクリック時に呼び出す関数（詳細モーダルを開く） */
  onSelect: (studio: Studio) => void;
  /** モーダルを閉じる関数 */
  onClose: () => void;
}

/** 「現在地から探す」で表示する件数の上限 */
const NEARBY_LIMIT = 3;

/**
 * 現在地からのスタジオ探索モーダル。
 *
 * - マウント時に自動で位置情報の取得をリクエストする
 * - 取得できた現在地と各スタジオの緯度経度からhaversine距離を算出し、
 *   近い順に上位3件を表示する
 * - 拒否/エラー時は案内メッセージを表示する
 *
 * @param {NearbyModalProps} props
 * @returns {JSX.Element} 現在地からのスタジオ探索モーダル
 */
export const NearbyModal = ({ studios, isFavorite, onToggleFavorite, onSelect, onClose }: NearbyModalProps) => {
  const { position, status, request } = useGeolocation();

  /** モーダルを開いたら自動で現在地取得をリクエストする */
  useEffect(() => {
    request();
  }, [request]);

  /**
   * 現在地からの実距離が近い順にスタジオを並べ替え、上位3件を返す。
   */
  const nearby = useMemo(() => {
    if (!position) return [];
    return studios
      .map((studio) => ({
        studio,
        distanceKm: haversineKm(position.lat, position.lng, studio.lat, studio.lng),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, NEARBY_LIMIT);
  }, [position, studios]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="閉じる">
          <X size={20} />
        </button>

        <div className="modal-hero">
          <h2 className="modal-title-text">
            <LocateFixed size={20} style={{ verticalAlign: "-3px", marginRight: 6 }} />
            現在地から探す
          </h2>
        </div>

        <div className="modal-section">
          {(status === "idle" || status === "loading") && (
            <div className="loading-state">
              <Loader2 size={24} className="spin" />
              <p>現在地を取得しています...</p>
            </div>
          )}

          {status === "denied" && (
            <p className="reason-text">
              位置情報の利用が許可されていません。ブラウザの設定で位置情報を許可してから、もう一度お試しください。
            </p>
          )}

          {status === "error" && (
            <p className="reason-text">
              現在地の取得に失敗しました。電波状況の良い場所でもう一度お試しください。
            </p>
          )}

          {status === "granted" && nearby.length === 0 && (
            <p className="reason-text">近くのスタジオ情報が見つかりませんでした。</p>
          )}

          {status === "granted" && nearby.length > 0 && (
            <div className="rec-list">
              {nearby.map(({ studio, distanceKm }, i) => (
                <StudioCard
                  key={studio.studioId}
                  studio={studio}
                  rank={i + 1}
                  distanceKm={distanceKm}
                  isFavorite={isFavorite(studio.studioId)}
                  onToggleFavorite={onToggleFavorite}
                  onClick={onSelect}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
