/**
 * @fileoverview スタジオ比較一覧画面。
 *
 * 全スタジオを「スタジオ × 部屋の広さ」の比較テーブル形式で表示する。
 * トップページ（空き状況の探索）とは異なり、こちらはブランド・住所・
 * 各部屋の広さ/料金を横断的に比較するための詳細一覧としての役割を持つ。
 * ブランド・部屋の広さで絞り込み・キーワード検索ができる。
 */

import { useState, useEffect, useMemo } from "react";
import { getStudios } from "../api/client";
import type { Studio } from "../types";
import { Navigation2, Search } from "lucide-react";
import { BRANDS, BRAND_LABELS, BRAND_COLORS } from "../utils/brand";

const isExcludedFacility = (name: string): boolean => {
  const excludedKeywords = ["ヨガ", "yoga", "ピラティス", "pilates"];
  const nameLower = name.toLowerCase();
  return excludedKeywords.some((kw) => nameLower.includes(kw) || name.includes(kw));
};

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
 * スタジオ比較一覧ページコンポーネント。
 *
 * - マウント時に studios を取得してテーブル表示する
 * - 各スタジオの部屋ごとの広さ・鏡/天井高・最安料金を横並びで比較できる
 * - ブランド・部屋広さ・キーワードで絞り込みできる
 * - ナビアイコンから Google Maps のルート案内を新しいタブで開ける
 *
 * @returns {JSX.Element} スタジオ比較一覧画面
 */
export const StudiosPage = () => {
  const [studios, setStudios] = useState<Studio[]>([]);
  const [loading, setLoading] = useState(true);

  /** 検索キーワード（スタジオ名・住所を対象に部分一致で絞り込む） */
  const [searchText, setSearchText] = useState("");
  /** 選択中のブランドフィルタ（nullなら絞り込みなし） */
  const [brandFilter, setBrandFilter] = useState<Studio["brand"] | null>(null);
  /** 選択中の部屋広さフィルタ（nullなら絞り込みなし） */
  const [sizeFilter, setSizeFilter] = useState<{ label: string; min: number; max: number } | null>(null);

  useEffect(() => {
    getStudios().then((s) => {
      setStudios(s.filter((studio) => !isExcludedFacility(studio.name)));
      setLoading(false);
    });
  }, []);

  /** キーワード・ブランド・部屋広さの条件をすべて満たすスタジオのみを残す */
  const filteredStudios = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return studios.filter((studio) => {
      if (q) {
        const haystack = `${studio.name} ${studio.address ?? studio.description ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (brandFilter && studio.brand !== brandFilter) return false;
      if (sizeFilter) {
        const area = maxRoomArea(studio);
        if (area == null || area < sizeFilter.min || area >= sizeFilter.max) return false;
      }
      return true;
    });
  }, [studios, searchText, brandFilter, sizeFilter]);

  if (loading) return <div className="loading-state"><div className="loader" /><p>読み込み中...</p></div>;

  const isFiltered = searchText.trim() !== "" || brandFilter != null || sizeFilter != null;

  return (
    <div className="page studios-page">
      <div className="page-header">
        <h1 className="page-title">スタジオ比較一覧</h1>
        <p className="page-sub">
          {isFiltered ? `全${studios.length}スタジオ中 ${filteredStudios.length}件` : `全 ${studios.length} スタジオ`}
        </p>
      </div>

      <div className="studios-filter-bar">
        <div className="studios-search-row">
          <Search size={16} className="studios-search-icon" />
          <input
            className="studios-search-input"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="スタジオ名・住所で検索"
          />
        </div>
        <div className="studios-facility-filter">
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

      {filteredStudios.length === 0 ? (
        <div className="empty-state">
          <p>条件に合うスタジオが見つかりませんでした</p>
          <p className="empty-hint">キーワードやブランド・広さの絞り込みを変えてみてください</p>
        </div>
      ) : (
        <div className="studios-compare-list">
          {filteredStudios.map((studio) => {
            const color = studio.brand ? BRAND_COLORS[studio.brand] : "#9ca3af";
            return (
              <div key={studio.studioId} className="studio-row studio-compare-row">
                <div className="studio-row-left">
                  <div className="studio-score-bar" style={{ background: color }} />
                  <div>
                    <p className="studio-row-name">{studio.name}</p>
                    <p className="studio-row-address">{studio.address ?? studio.description ?? "住所不明"}</p>
                    {studio.brand && (
                      <span className="brand-badge sm" style={{ background: color }}>
                        {BRAND_LABELS[studio.brand]}
                      </span>
                    )}
                    {studio.rooms && studio.rooms.length > 0 && (
                      <table className="room-compare-table">
                        <thead>
                          <tr>
                            <th>部屋</th>
                            <th>広さ</th>
                            <th>鏡/天井高</th>
                            <th>最安料金</th>
                          </tr>
                        </thead>
                        <tbody>
                          {studio.rooms.map((room) => (
                            <tr key={room.roomName}>
                              <td>{room.roomName}</td>
                              <td>{room.areaSqm != null ? `${room.areaSqm}㎡` : "-"}</td>
                              <td>
                                {room.secondDimensionLabel && room.secondDimensionM != null
                                  ? `${room.secondDimensionLabel} ${room.secondDimensionM}m`
                                  : "-"}
                              </td>
                              <td>{room.minPriceYen != null ? `¥${room.minPriceYen.toLocaleString()}〜` : "問合せ"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
                <div className="studio-row-right">
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${studio.lat},${studio.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="icon-btn"
                    title="ナビ"
                  >
                    <Navigation2 size={16} />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
