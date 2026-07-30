/**
 * @fileoverview お気に入りスタジオ一覧画面。
 *
 * ユーザーがハートボタンで保存したスタジオを一覧表示する。
 * 全スタジオデータと突き合わせてブランド・住所付きで表示し、
 * カードタップで詳細モーダルを開くことができる。
 */

import { useState, useEffect } from "react";
import { useFavorites } from "../hooks/useFavorites";
import { getStudios } from "../api/client";
import { StudioCard } from "../components/StudioCard";
import { DetailModal } from "../components/DetailModal";
import type { Studio } from "../types";
import { Heart } from "lucide-react";

/**
 * お気に入りスタジオ一覧ページコンポーネント。
 *
 * - お気に入り登録済みのスタジオIDと全スタジオ一覧を突き合わせて表示する
 * - お気に入りが0件の場合は空状態のガイドメッセージを表示する
 * - カードをタップすると DetailModal が開く
 *
 * @returns {JSX.Element} お気に入り一覧画面
 */
export const FavoritesPage = () => {
  const { favorites, loading, toggleFavorite, isFavorite } = useFavorites();
  const [studios, setStudios] = useState<Studio[]>([]);
  const [selected, setSelected] = useState<Studio | null>(null);

  useEffect(() => {
    getStudios().then(setStudios);
  }, []);

  const favStudios = studios.filter((s) => isFavorite(s.studioId));

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

      {favStudios.length === 0 ? (
        <div className="empty-state">
          <Heart size={48} style={{ color: "#d1d5db", marginBottom: 12 }} />
          <p>まだ保存されたスタジオがありません</p>
          <p className="empty-hint">スタジオ一覧画面からハートをタップして保存しましょう</p>
        </div>
      ) : (
        <div className="rec-list">
          {favStudios.map((studio) => (
            <StudioCard
              key={studio.studioId}
              studio={studio}
              isFavorite={true}
              onToggleFavorite={toggleFavorite}
              onClick={setSelected}
            />
          ))}
        </div>
      )}

      {selected && (
        <DetailModal
          studio={selected}
          isFavorite={isFavorite(selected.studioId)}
          onClose={() => setSelected(null)}
          onToggleFavorite={toggleFavorite}
        />
      )}
    </div>
  );
};
