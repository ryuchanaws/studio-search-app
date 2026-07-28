/**
 * @fileoverview レンタルスタジオ一覧画面。
 *
 * 全スタジオをリスト形式で表示する。
 * 各行にスコアカラーバー・設備タグ・スコアラベル・ナビリンクを表示し、
 * おすすめデータがないスタジオはグレーで表示する。
 * スタジオ数が増え一覧が長くなることを見越し、キーワード検索・設備絞り込みに対応する
 * （全件クライアント側取得済みのため追加のAPI呼び出しは発生しない）。
 */

import { useState, useEffect, useMemo } from "react";
import { getStudios, getRecommendations } from "../api/client";
import type { Studio, Recommendation } from "../types";
import { Navigation2, Sparkles, Search } from "lucide-react";
import { getScoreColor, getScoreLabel } from "../utils/score";
import { ImagePreviewPopover } from "../components/ImagePreviewPopover";

/**
 * スタジオ一覧ページコンポーネント。
 *
 * - マウント時に studios・recommendations を並列取得してリスト表示する
 * - 各スタジオ行の左端にスコアに応じた色のバーを表示する
 * - おすすめデータがないスタジオはグレーのバーで表示する
 * - ナビアイコンから Google Maps のルート案内を新しいタブで開ける
 *
 * @returns {JSX.Element} スタジオ一覧画面
 */
export const StudiosPage = () => {
  const [studios, setStudios] = useState<Studio[]>([]);
  const [recMap, setRecMap] = useState<Record<string, Recommendation>>({});
  const [loading, setLoading] = useState(true);

  /** 検索キーワード（スタジオ名・説明文を対象に部分一致で絞り込む） */
  const [searchText, setSearchText] = useState("");
  /** 選択中の設備フィルタ（いずれか1つでも合致すれば表示。空なら絞り込みなし） */
  const [selectedFacilities, setSelectedFacilities] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([getStudios(), getRecommendations()]).then(([s, r]) => {
      setStudios(s);
      const m: Record<string, Recommendation> = {};
      r.forEach((rec) => (m[rec.studioId] = rec));
      setRecMap(m);
      setLoading(false);
    });
  }, []);

  /** 出現する全設備を頻度順に並べたフィルタ用チップ一覧 */
  const allFacilities = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(recMap).forEach((rec) => {
      rec.facilityTags.forEach((f) => counts.set(f, (counts.get(f) ?? 0) + 1));
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  }, [recMap]);

  /** キーワード・設備フィルタの両方を満たすスタジオのみを残す */
  const filteredStudios = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return studios.filter((studio) => {
      if (q) {
        const haystack = `${studio.name} ${studio.description ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (selectedFacilities.size > 0) {
        const facilityTags = recMap[studio.studioId]?.facilityTags ?? [];
        if (!facilityTags.some((f) => selectedFacilities.has(f))) return false;
      }
      return true;
    });
  }, [studios, recMap, searchText, selectedFacilities]);

  /**
   * 設備フィルタチップのON/OFFを切り替える。
   *
   * @param {string} facility - 対象の設備
   */
  const toggleFacility = (facility: string) => {
    setSelectedFacilities((prev) => {
      const next = new Set(prev);
      if (next.has(facility)) next.delete(facility);
      else next.add(facility);
      return next;
    });
  };

  if (loading) return <div className="loading-state"><div className="loader" /><p>読み込み中...</p></div>;

  const isFiltered = searchText.trim() !== "" || selectedFacilities.size > 0;

  return (
    <div className="page studios-page">
      <div className="page-header">
        <h1 className="page-title">スタジオ一覧</h1>
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
        {allFacilities.length > 0 && (
          <div className="studios-facility-filter">
            {allFacilities.map((f) => (
              <button
                key={f}
                className={`facility-tag sm facility-filter-chip ${selectedFacilities.has(f) ? "active" : ""}`}
                onClick={() => toggleFacility(f)}
              >
                <Sparkles size={10} />
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      {filteredStudios.length === 0 ? (
        <div className="empty-state">
          <p>条件に合うスタジオが見つかりませんでした</p>
          <p className="empty-hint">キーワードや設備の絞り込みを変えてみてください</p>
        </div>
      ) : (
      <div className="studios-list">
        {filteredStudios.map((studio) => {
          const rec = recMap[studio.studioId];
          const color = rec ? getScoreColor(rec.score) : "#9ca3af";
          return (
            <div key={studio.studioId} className="studio-row">
              <div className="studio-row-left">
                <div className="studio-score-bar" style={{ background: color }} />
                <div>
                  <ImagePreviewPopover imageUrl={studio.imageUrl}>
                    <p className="studio-row-name">{studio.name}</p>
                  </ImagePreviewPopover>
                  {rec && (
                    <div className="studio-row-facility">
                      {rec.facilityTags.map((f) => (
                        <span key={f} className="facility-tag sm">
                          <Sparkles size={10} />{f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="studio-row-right">
                {rec && (
                  <span className="studio-row-score" style={{ color }}>
                    {Math.round(rec.score)} <small>{getScoreLabel(rec.score)}</small>
                  </span>
                )}
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
