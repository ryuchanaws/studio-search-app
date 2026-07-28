/**
 * お気に入りスタジオの状態管理カスタムフック。
 *
 * お気に入りの取得・追加・削除・存在確認を提供する。
 * /favorites系エンドポイントはCognito認証必須のため、未ログイン時は
 * APIを呼ばずに空リストを返し、トグル操作時はログイン画面へ誘導する。
 *
 * @module useFavorites
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "react-oidc-context";
import type { Favorite } from "../types";
import { getFavorites, addFavorite, removeFavorite } from "../api/client";

/**
 * お気に入りスタジオを管理するカスタムフック。
 *
 * @returns {object} お気に入り管理に必要な状態と操作関数
 * @returns {Favorite[]} favorites     - お気に入りスタジオの一覧
 * @returns {boolean}   loading        - データ取得中フラグ
 * @returns {Function}  toggleFavorite - お気に入りの追加・削除トグル
 * @returns {Function}  isFavorite     - 指定スタジオのお気に入り登録有無を返す関数
 * @returns {Function}  refetch        - お気に入り一覧を再取得する関数
 */
export const useFavorites = () => {
  const auth = useAuth();
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFavorites = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getFavorites();
      setFavorites(data);
    } catch {
      console.error("Failed to load favorites");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 指定スタジオのお気に入り状態をトグルする。
   *
   * 未ログイン時はAPIを呼ばず、Cognito Hosted UIのログイン画面へ遷移する。
   *
   * @param {string} studioId - トグル対象のスタジオID
   * @param {string} [memo] - お気に入り登録時のメモ（追加時のみ有効）
   * @returns {Promise<void>}
   */
  const toggleFavorite = useCallback(async (studioId: string, memo?: string) => {
    if (!auth.isAuthenticated) {
      auth.signinRedirect();
      return;
    }

    const exists = favorites.some((f) => f.studioId === studioId);
    if (exists) {
      await removeFavorite(studioId);
      setFavorites((prev) => prev.filter((f) => f.studioId !== studioId));
    } else {
      await addFavorite(studioId, memo);
      setFavorites((prev) => [...prev, { userId: auth.user?.profile.sub ?? "", studioId, memo }]);
    }
  }, [favorites, auth]);

  /**
   * 指定スタジオがお気に入り登録済みかどうかを返す。
   *
   * @param {string} studioId - 確認対象のスタジオID
   * @returns {boolean} お気に入り登録済みなら true
   */
  const isFavorite = useCallback(
    (studioId: string) => favorites.some((f) => f.studioId === studioId),
    [favorites]
  );

  useEffect(() => {
    if (auth.isAuthenticated) {
      fetchFavorites();
    } else {
      setFavorites([]);
      setLoading(false);
    }
  }, [auth.isAuthenticated, fetchFavorites]);

  return { favorites, loading, toggleFavorite, isFavorite, refetch: fetchFavorites };
};
