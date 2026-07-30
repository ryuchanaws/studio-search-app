/**
 * @fileoverview トップページ（スタジオ一覧・空き状況探索画面）。
 *
 * 4ブランド（BUZZ / worcle / NOAH / スタジオミッション）のスタジオを一覧表示する。
 * 各カードから空き状況モーダルを開いて日付ごとの空きコマを確認できる。
 * 「現在地から探す」機能はそのまま維持する。
 */

import { useState, useEffect, useMemo } from "react";
import { getStudios } from "../api/client";
import { useFavorites } from "../hooks/useFavorites";
import { StudioCard } from "../components/StudioCard";
import { StudioDiscoveryButton } from "../components/StudioDiscoveryButton";
import { DetailModal } from "../components/DetailModal";
import { NearbyModal } from "../components/NearbyModal";
import { AvailabilityModal } from "../components/AvailabilityModal";
import type { Studio } from "../types";
import { RefreshCw, LocateFixed, Ruler, MapPin, CalendarClock } from "lucide-react";
import { extractPrefecture } from "../utils/area";
import { BRANDS, BRAND_LABELS, BRAND_COLORS } from "../utils/brand";

/** 部屋の広さの絞り込み選択肢（各スタジオの最大部屋面積を基準にバケット分けする） */
const ROOM_SIZE_OPTIONS: { label: string; min: number; max: number }[] = [
  { label: "〜15㎡", min: 0, max: 15 },
  { label: "15〜30㎡", min: 15, max: 30 },
  { label: "30㎡〜", min: 30, max: Infinity },
];

/**
 * スタジオの部屋一覧から最大の広さ（㎡）を返す。
 *
 * @param {Studio} studio - 対象スタジオ
 * @returns {number | null} 最大の広さ。部屋データが無ければnull
 */
const maxRoomArea = (studio: Studio): number | null => {
  const areas = (studio.rooms ?? []).map((r) => r.areaSqm).filter((a): a is number => a != null);
  return areas.length > 0 ? Math.max(...areas) : null;
};

/**
 * トップページコンポーネント。
 *
 * - 全スタジオを取得してカード一覧表示する
 * - ブランド・エリア・部屋の広さで絞り込みできる
 * - カードから空き状況モーダル（AvailabilityModal）を開ける
 * - 「現在地から探す」ボタンは維持する
 *
 * @returns {JSX.Element} トップページ画面
 */
export const TopPage = () => {
  const [studios, setStudios] = useState<Studio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isFavorite, toggleFavorite } = useFavorites();

  const [selected, setSelected] = useState<Studio | null>(null);
  const [availabilityTarget, setAvailabilityTarget] = useState<Studio | null>(null);
  const [showNearby, setShowNearby] = useState(false);

  /** 選択中のブランドフィルタ（nullなら絞り込みなし） */
  const [brandFilter, setBrandFilter] = useState<Studio["brand"] | null>(null);
  /** 選択中の部屋広さフィルタ（nullなら絞り込みなし） */
  const [sizeFilter, setSizeFilter] = useState<{ label: string; min: number; max: number } | null>(null);
  /** 選択中のエリア（都道府県）フィルタ（nullなら絞り込みなし） */
  const [areaFilter, setAreaFilter] = useState<string | null>(null);

  const fetchStudios = () => {
    setLoading(true);
    setError(null);
    getStudios()
      .then(setStudios)
      .catch(() => setError("スタジオ情報の取得に失敗しました"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStudios();
  }, []);

  /** 出現する都道府県を件数順に並べたフィルタ用チップ一覧。
   * Studio.address（無ければdescription）から都道府県を抽出する */
  const availableAreas = useMemo(() => {
    const counts = new Map<string, number>();
    studios.forEach((studio) => {
      const area = extractPrefecture(studio.address ?? studio.description);
      if (area) counts.set(area, (counts.get(area) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  }, [studios]);

  /** ブランド・エリア・部屋広さのすべての条件を満たすスタジオのみを残す */
  const filteredStudios = useMemo(() => {
    return studios.filter((studio) => {
      if (brandFilter && studio.brand !== brandFilter) return false;
      if (areaFilter && extractPrefecture(studio.address ?? studio.description) !== areaFilter) return false;
      if (sizeFilter) {
        const area = maxRoomArea(studio);
        if (area == null || area < sizeFilter.min || area >= sizeFilter.max) return false;
      }
      return true;
    });
  }, [studios, brandFilter, areaFilter, sizeFilter]);

  const isFiltered = brandFilter != null || areaFilter != null || sizeFilter != null;

  return (
    <div className="page top-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">レンタルスタジオを探す</h1>
          <p className="page-sub">BUZZ / worcle / NOAH / スタジオミッションから探す</p>
        </div>
        <div className="page-header-actions">
          <button className="icon-btn" onClick={() => setShowNearby(true)} title="現在地から探す">
            <LocateFixed size={18} />
          </button>
          <button className="icon-btn" onClick={fetchStudios} title="更新" disabled={loading}>
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {/* 新規スタジオ自動発見: Google Places APIで新しいスタジオ候補を探索する */}
      <div className="ai-batch-section">
        <StudioDiscoveryButton />
      </div>

      {/* ブランド・エリア・部屋広さでの絞り込み */}
      {studios.length > 0 && (
        <div className="top-filter-bar">
          <div className="top-filter-group">
            <span className="top-filter-label">ブランド</span>
            {BRANDS.map((b) => (
              <button
                key={b}
                className={`facility-tag sm facility-filter-chip ${brandFilter === b ? "active" : ""}`}
                style={brandFilter === b ? { background: BRAND_COLORS[b] } : undefined}
                onClick={() => setBrandFilter(brandFilter === b ? null : b)}
              >
                {BRAND_LABELS[b]}
              </button>
            ))}
          </div>
          {availableAreas.length > 0 && (
            <div className="top-filter-group">
              <span className="top-filter-label"><MapPin size={12} /> エリア</span>
              {availableAreas.map((a) => (
                <button
                  key={a}
                  className={`facility-tag sm facility-filter-chip ${areaFilter === a ? "active" : ""}`}
                  onClick={() => setAreaFilter(areaFilter === a ? null : a)}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
          <div className="top-filter-group">
            <span className="top-filter-label"><Ruler size={12} /> 広さ</span>
            {ROOM_SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                className={`facility-tag sm facility-filter-chip ${sizeFilter?.label === opt.label ? "active" : ""}`}
                onClick={() => setSizeFilter(sizeFilter?.label === opt.label ? null : opt)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading-state">
          <div className="loader" />
          <p>スタジオを読み込み中...</p>
        </div>
      ) : (
        <>
          {filteredStudios.length > 0 && (
            <section className="more-section">
              <div className="rec-list">
                {filteredStudios.map((studio) => (
                  <div key={studio.studioId} className="studio-card-wrapper">
                    <StudioCard
                      studio={studio}
                      isFavorite={isFavorite(studio.studioId)}
                      onToggleFavorite={toggleFavorite}
                      onClick={setSelected}
                    />
                    <button
                      className="btn-nav availability-btn"
                      onClick={() => setAvailabilityTarget(studio)}
                    >
                      <CalendarClock size={16} />
                      空き状況を見る
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {studios.length === 0 && (
            <div className="empty-state">
              <p>スタジオ情報がまだありません</p>
            </div>
          )}

          {studios.length > 0 && filteredStudios.length === 0 && (
            <div className="empty-state">
              <p>条件に合うスタジオが見つかりませんでした</p>
              <p className="empty-hint">ブランド・エリア・広さの絞り込みを変えてみてください</p>
            </div>
          )}
        </>
      )}

      {selected && (
        <DetailModal
          studio={selected}
          isFavorite={isFavorite(selected.studioId)}
          onClose={() => setSelected(null)}
          onToggleFavorite={toggleFavorite}
        />
      )}

      {availabilityTarget && (
        <AvailabilityModal studio={availabilityTarget} onClose={() => setAvailabilityTarget(null)} />
      )}

      {showNearby && (
        <NearbyModal
          studios={studios}
          isFavorite={isFavorite}
          onToggleFavorite={toggleFavorite}
          onSelect={setSelected}
          onClose={() => setShowNearby(false)}
        />
      )}
    </div>
  );
};
