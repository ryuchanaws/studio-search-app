/**
 * @fileoverview トップページ（おすすめスタジオ一覧画面）。
 *
 * AI分析によるおすすめスタジオをスコア降順で表示する。
 * 上位3件をTOP3として強調表示し、残りはリスト形式で表示する。
 * 「AI分析を実行」ボタンでバッチ処理を手動トリガーできる。
 */

import { useState } from "react";
import { useRecommendations } from "../hooks/useRecommendations";
import { useFavorites } from "../hooks/useFavorites";
import { RecommendationCard } from "../components/RecommendationCard";
import { AiBatchButton } from "../components/AiBatchButton";
import { StudioDiscoveryButton } from "../components/StudioDiscoveryButton";
import { DetailModal } from "../components/DetailModal";
import { NearbyModal } from "../components/NearbyModal";
import type { Recommendation } from "../types";
import { RefreshCw, LocateFixed } from "lucide-react";

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

  const top3 = recommendations.slice(0, 3);
  const rest = recommendations.slice(3);

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
                おすすめTOP3
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
