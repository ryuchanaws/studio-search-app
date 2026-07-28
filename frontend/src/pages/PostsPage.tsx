/**
 * @fileoverview レビュー投稿一覧ページ。
 *
 * 投稿を新しい順に一覧表示し、「投稿する」ボタンから新規投稿を作成できる。
 * URLクエリパラメータ ?studioId=X が付いている場合は該当スタジオの投稿のみに絞り込む
 * （DetailModalの「このスタジオのレビューを見る」リンクからの遷移用）。
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "react-oidc-context";
import { Star, Plus, Trash2, Pencil } from "lucide-react";
import { usePosts } from "../hooks/usePosts";
import { PostForm } from "../components/PostForm";
import { getStudios } from "../api/client";
import type { Studio, Post } from "../types";

/**
 * レビュー投稿一覧ページコンポーネント。
 *
 * @returns {JSX.Element} 投稿一覧画面
 */
export const PostsPage = () => {
  const auth = useAuth();
  const { posts, loading, error, deleteError, submitPost, editPost, removePost } = usePosts();
  const [studios, setStudios] = useState<Studio[]>([]);
  /** "create"=新規投稿フォーム、Post=その投稿を編集中、null=フォーム非表示 */
  const [formTarget, setFormTarget] = useState<"create" | Post | null>(null);
  const [searchParams] = useSearchParams();
  const studioIdFilter = searchParams.get("studioId");

  useEffect(() => {
    getStudios().then(setStudios);
  }, []);

  const studioName = (studioId: string) => studios.find((s) => s.studioId === studioId)?.name ?? studioId;

  const visiblePosts = studioIdFilter ? posts.filter((p) => p.studioId === studioIdFilter) : posts;

  /**
   * 確認ダイアログを挟んで投稿を削除する。
   *
   * @param {string} postId - 削除対象の投稿ID
   */
  const handleDelete = (postId: string) => {
    if (window.confirm("この投稿を削除しますか？")) {
      removePost(postId);
    }
  };

  /**
   * 「投稿する」ボタンのクリック処理。
   * /posts (POST) はCognito認証必須のため、未ログイン時はフォームを開かずログイン画面へ誘導する。
   */
  const handleOpenForm = () => {
    if (!auth.isAuthenticated) {
      auth.signinRedirect();
      return;
    }
    setFormTarget("create");
  };

  return (
    <div className="page posts-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">レビュー投稿</h1>
          <p className="page-sub">
            {studioIdFilter ? `${studioName(studioIdFilter)}のレビュー` : "みんなのレビューをチェック"}
          </p>
        </div>
        <button className="icon-btn" onClick={handleOpenForm} title="投稿する">
          <Plus size={18} />
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {deleteError && <div className="error-banner">{deleteError}</div>}

      {loading ? (
        <div className="loading-state">
          <div className="loader" />
          <p>読み込み中...</p>
        </div>
      ) : visiblePosts.length === 0 ? (
        <div className="empty-state">
          <p>まだ投稿がありません</p>
          <p className="empty-hint">「投稿する」ボタンからレビューをシェアしましょう</p>
        </div>
      ) : (
        <div className="posts-list">
          {visiblePosts.map((post) => (
            <div key={post.postId} className="post-card">
              {post.imageUrl && <img className="post-image" src={post.imageUrl} alt={post.content} loading="lazy" />}
              <div className="post-body">
                <div className="post-header-row">
                  <p className="post-studio-name">{studioName(post.studioId)}</p>
                  {auth.user?.profile.sub === post.userId && (
                    <div className="post-header-actions">
                      <button className="icon-btn" onClick={() => setFormTarget(post)} title="編集" aria-label="投稿を編集">
                        <Pencil size={14} />
                      </button>
                      <button className="icon-btn" onClick={() => handleDelete(post.postId)} title="削除" aria-label="投稿を削除">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
                {post.rating != null && (
                  <div className="post-rating">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} size={14} fill={n <= post.rating! ? "currentColor" : "none"} />
                    ))}
                  </div>
                )}
                <p className="post-content">{post.content}</p>
                <p className="post-date">
                  {post.authorName ?? "匿名"} ・ {new Date(post.createdAt).toLocaleString("ja-JP")}
                  {post.updatedAt && <span className="post-edited-badge">（編集済み）</span>}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {formTarget && (
        <PostForm
          studios={studios}
          defaultStudioId={studioIdFilter ?? undefined}
          editingPost={formTarget !== "create" ? formTarget : undefined}
          onSubmit={formTarget === "create" ? submitPost : (input) => editPost(formTarget.postId, input)}
          onClose={() => setFormTarget(null)}
        />
      )}
    </div>
  );
};
