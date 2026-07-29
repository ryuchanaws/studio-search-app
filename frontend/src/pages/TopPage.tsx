/**
 * @fileoverview トップページ（おすすめスタジオ一覧画面）。
 *
 * AI分析によるおすすめスタジオをスコア降順で表示する。
 * 上位3件をTOP3として強調表示し、残りはリスト形式で表示する。
 * 「AI分析を実行」ボタンでバッチ処理を手動トリガーできる。
 */

import { useState, useMemo } from "react";
import { useRecommendations } from "../hooks/useRecommendations";
import { useFavorites } from "../hooks/useFavorites";
import { RecommendationCard } from "../components/RecommendationCard";
import { AiBatchButton } from "../components/AiBatchButton";
import { StudioDiscoveryButton } from "../components/StudioDiscoveryButton";
import { DetailModal } from "../components/DetailModal";
import { NearbyModal } from "../components/NearbyModal";
import type { Recommendation } from "../types";
import { RefreshCw, LocateFixed, Users, Banknote } from "lucide-react";

/** 収容人数の絞り込み選択肢（discover_studios.py の CAPACITY_CATEGORIES と一致させる） */
const CAPACITY_OPTIONS = ["少人数向け（〜5人）", "小グループ向け（6〜10人）", "中〜大人数対応（11人〜）"];

/** 料金の絞り込み選択肢（1時間あたりの上限額） */
const PRICE_OPTIONS: { label: string; max: number }[] = [
  { label: "〜¥2,000", max: 2000 },
  { label: "〜¥4,000", max: 4000 },
  { label: "〜¥6,000", max: 6000 },
];

/**
 * おすすめ1件の最安プラン価格を返す（priceOptionsがあればその最安値、無ければcost）。
 * 価格情報が無い（問合せのみ）場合はnullを返す。
 *
 * @param {Recommendation} rec - おすすめデータ
 * @returns {number | null} 最安プラン価格（円）。不明ならnull
 */
const cheapestPrice = (rec: Recommendation): number | null => {
  if (rec.priceOptions && rec.priceOptions.length > 0) {
    return Math.min(...rec.priceOptions.map((p) => p.priceYen));
  }
  return rec.cost > 0 ? rec.cost : null;
};

/**
 * トップページコンポーネント。
 *
 * - おすすめスタジオをスコア降順で取得して表示する
 * - 上位3件を TOP3 グリッド、残りをリスト形式で表示する
 * - 「AI分析を実行」ボタンでバッチ処理を手動トリガーし、完了後に画面を更新する
 * - カードタップで DetailModal を開く
 *
 * @returns {JSX.Element} トップページ画面
 */
export const TopPage = () => {
  const { recommendations, loading, batchStatus, error, triggerAiBatch, refetch } = useRecommendations();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [selected, setSelected] = useState<Recommendation | null>(null);
  const [showNearby, setShowNearby] = useState(false);

  /** 選択中の収容人数フィルタ（nullなら絞り込みなし） */
  const [capacityFilter, setCapacityFilter] = useState<string | null>(null);
  /** 選択中の料金上限フィルタ（nullなら絞り込みなし） */
  const [maxPriceFilter, setMaxPriceFilter] = useState<number | null>(null);

  /** 人数・料金フィルタの両方を満たすおすすめのみを残す。
   * 料金で絞り込んでいる場合、価格情報が不明（問合せのみ）のスタジオは対象外とする
   * （「上限以下かどうか」を判断できないデータを誤って含めないため） */
  const filteredRecommendations = useMemo(() => {
    return recommendations.filter((rec) => {
      if (capacityFilter && rec.capacityCategory !== capacityFilter) return false;
      if (maxPriceFilter != null) {
        const price = cheapestPrice(rec);
        if (price == null || price > maxPriceFilter) return false;
      }
      return true;
    });
  }, [recommendations, capacityFilter, maxPriceFilter]);

  const isFiltered = capacityFilter != null || maxPriceFilter != null;
  const top3 = filteredRecommendations.slice(0, 3);
  const rest = filteredRecommendations.slice(3);

  return (
    <div className="page top-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">今日、どのスタジオへ行く？</h1>
          <p className="page-sub">AIがあなたのスタジオ選びを最適化します</p>
        </div>
        <div className="page-header-actions">
          <button className="icon-btn" onClick={() => setShowNearby(true)} title="現在地から探す">
            <LocateFixed size={18} />
          </button>
          <button className="icon-btn" onClick={refetch} title="更新" disabled={loading}>
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {/* AI実行ボタンセクション: クリックでバッチ処理を手動トリガー */}
      <div className="ai-batch-section">
        <AiBatchButton status={batchStatus} onRun={triggerAiBatch} />
        {/* 新規スタジオ自動発見: Google Places APIで新しいスタジオ候補を探索する */}
        <StudioDiscoveryButton />
      </div>

      {/* 人数・料金での絞り込み。AI分析・現在地から探すのどちらの結果にも同じ条件で効く */}
      {recommendations.length > 0 && (
        <div className="top-filter-bar">
          <div className="top-filter-group">
            <span className="top-filter-label"><Users size={12} /> 人数</span>
            {CAPACITY_OPTIONS.map((c) => (
              <button
                key={c}
                className={`facility-tag sm facility-filter-chip ${capacityFilter === c ? "active" : ""}`}
                onClick={() => setCapacityFilter(capacityFilter === c ? null : c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="top-filter-group">
            <span className="top-filter-label"><Banknote size={12} /> 料金</span>
            {PRICE_OPTIONS.map((p) => (
              <button
                key={p.label}
                className={`facility-tag sm facility-filter-chip ${maxPriceFilter === p.max ? "active" : ""}`}
                onClick={() => setMaxPriceFilter(maxPriceFilter === p.max ? null : p.max)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading-state">
          <div className="loader" />
          <p>おすすめを読み込み中...</p>
        </div>
      ) : (
        <>
          {top3.length > 0 && (
            <section className="top3-section">
              <h2 className="section-title">
                <span className="section-icon">🏆</span>
                {isFiltered ? "絞り込み結果TOP3" : "おすすめTOP3"}
              </h2>
              <div className="top3-grid">
                {top3.map((rec, i) => (
                  <RecommendationCard
                    key={rec.studioId}
                    recommendation={rec}
                    rank={i + 1}
                    isFavorite={isFavorite(rec.studioId)}
                    onToggleFavorite={toggleFavorite}
                    onClick={setSelected}
                  />
                ))}
              </div>
            </section>
          )}

          {rest.length > 0 && (
            <section className="more-section">
              <h2 className="section-title">その他のスタジオ</h2>
              <div className="rec-list">
                {rest.map((rec) => (
                  <RecommendationCard
                    key={rec.studioId}
                    recommendation={rec}
                    isFavorite={isFavorite(rec.studioId)}
                    onToggleFavorite={toggleFavorite}
                    onClick={setSelected}
                  />
                ))}
              </div>
            </section>
          )}

          {recommendations.length === 0 && (
            <div className="empty-state">
              <p>まだおすすめデータがありません</p>
              <p className="empty-hint">「AI分析を実行」ボタンでデータを生成してください</p>
            </div>
          )}

          {recommendations.length > 0 && filteredRecommendations.length === 0 && (
            <div className="empty-state">
              <p>条件に合うスタジオが見つかりませんでした</p>
              <p className="empty-hint">人数・料金の絞り込みを変えてみてください</p>
            </div>
          )}
        </>
      )}

      {selected && (
        <DetailModal
          recommendation={selected}
          isFavorite={isFavorite(selected.studioId)}
          onClose={() => setSelected(null)}
          onToggleFavorite={toggleFavorite}
        />
      )}

      {showNearby && (
        <NearbyModal
          recommendations={recommendations}
          isFavorite={isFavorite}
          onToggleFavorite={toggleFavorite}
          onSelect={setSelected}
          onClose={() => setShowNearby(false)}
        />
      )}
    </div>
  );
};
