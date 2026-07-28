/**
 * @fileoverview お気に入りスタジオ一覧画面。
 *
 * ユーザーがハートボタンで保存したスタジオを一覧表示する。
 * おすすめデータと突き合わせてスコア・AI コメント付きで表示し、
 * カードタップで詳細モーダルを開くことができる。
 */

import { useState } from "react";
import { useFavorites } from "../hooks/useFavorites";
import { useRecommendations } from "../hooks/useRecommendations";
import { RecommendationCard } from "../components/RecommendationCard";
import { DetailModal } from "../components/DetailModal";
import type { Recommendation } from "../types";
import { Heart } from "lucide-react";

/**
 * お気に入りスタジオ一覧ページコンポーネント。
 *
 * - お気に入り登録済みのスタジオIDと recommendations を突き合わせて表示する
 * - お気に入りが0件の場合は空状態のガイドメッセージを表示する
 * - カードをタップすると DetailModal が開く
 *
 * @returns {JSX.Element} お気に入り一覧画面
 */
export const FavoritesPage = () => {
  const { favorites, loading, toggleFavorite, isFavorite } = useFavorites();
  const { recommendations } = useRecommendations();
  const [selected, setSelected] = useState<Recommendation | null>(null);

  const favRecs = recommendations.filter((r) => isFavorite(r.studioId));

  if (loading) return <div className="loading-state"><div className="loader" /><p>読み込み中...</p></div>;

  return (
    <div className="page favorites-page">
      <div className="page-header">
        <h1 className="page-title">
          <Heart size={22} fill="currentColor" style={{ color: "#e05c5c" }} />
          保存済みスタジオ
        </h1>
        <p className="page-sub">{favorites.length} 件</p>
      </div>

      {favRecs.length === 0 ? (
        <div className="empty-state">
          <Heart size={48} style={{ color: "#d1d5db", marginBottom: 12 }} />
          <p>まだ保存されたスタジオがありません</p>
          <p className="empty-hint">おすすめ画面からハートをタップして保存しましょう</p>
        </div>
      ) : (
        <div className="rec-list">
          {favRecs.map((rec) => (
            <RecommendationCard
              key={rec.studioId}
              recommendation={rec}
              isFavorite={true}
              onToggleFavorite={toggleFavorite}
              onClick={setSelected}
            />
          ))}
        </div>
      )}

      {selected && (
        <DetailModal
          recommendation={selected}
          isFavorite={isFavorite(selected.studioId)}
          onClose={() => setSelected(null)}
          onToggleFavorite={toggleFavorite}
        />
      )}
    </div>
  );
};
