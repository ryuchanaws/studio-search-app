/**
 * @fileoverview レビュー投稿フォームコンポーネント。
 *
 * スタジオ選択・本文・★評価・写真（任意）を入力し、
 * 写真がある場合はS3へアップロードしてから投稿を作成する。
 */

import { useState } from "react";
import { X, Camera, Star } from "lucide-react";
import type { Studio, Post } from "../types";
import { getPresignedUploadUrl, uploadImageToS3 } from "../api/client";

/**
 * PostForm コンポーネントの Props。
 */
interface PostFormProps {
  /** スタジオ選択肢一覧 */
  studios: Studio[];
  /** 初期選択するスタジオID（省略可。クエリパラメータからの絞り込み時などに使用） */
  defaultStudioId?: string;
  /**
   * 編集対象の投稿（省略可）。指定すると編集モードになり、
   * 既存の内容がプリフィルされる。スタジオはAPI側で変更不可のため選択欄も無効化する
   */
  editingPost?: Post;
  /** 投稿作成・編集時に呼び出す関数（編集時もstudioIdは変更されないがそのまま渡される） */
  onSubmit: (input: { studioId: string; content: string; imageUrl?: string; rating?: number }) => Promise<void>;
  /** フォームを閉じる関数 */
  onClose: () => void;
}

/**
 * レビュー投稿フォームコンポーネント。
 *
 * - 写真が選択されている場合、送信時に署名付きURLでS3へアップロードしてから
 *   その publicUrl を imageUrl として投稿を作成する
 * - editingPost が渡された場合は編集モード（既存内容をプリフィル、新しい写真を
 *   選ばなければ既存の写真URLをそのまま維持する）
 *
 * @param {PostFormProps} props
 * @returns {JSX.Element} 投稿作成・編集フォーム（モーダル）
 */
export const PostForm = ({ studios, defaultStudioId, editingPost, onSubmit, onClose }: PostFormProps) => {
  const isEditing = !!editingPost;
  const [studioId, setStudioId] = useState(editingPost?.studioId ?? defaultStudioId ?? studios[0]?.studioId ?? "");
  const [content, setContent] = useState(editingPost?.content ?? "");
  const [rating, setRating] = useState<number>(editingPost?.rating ?? 5);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * フォーム送信処理。写真があればアップロードを先に済ませてから投稿する。
   * 編集モードで新しい写真を選ばなかった場合は、既存のimageUrlをそのまま維持する。
   *
   * @param {React.FormEvent} e - フォーム送信イベント
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studioId || !content.trim()) {
      setError("スタジオと本文は必須です");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      let imageUrl: string | undefined = editingPost?.imageUrl;
      if (file) {
        const { uploadUrl, uploadFields, publicUrl } = await getPresignedUploadUrl(file.type);
        await uploadImageToS3(uploadUrl, uploadFields, file);
        imageUrl = publicUrl;
      }

      await onSubmit({ studioId, content: content.trim(), imageUrl, rating });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "投稿に失敗しました。もう一度お試しください");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="閉じる">
          <X size={20} />
        </button>

        <div className="modal-hero">
          <h2 className="modal-title-text">{isEditing ? "レビューを編集" : "レビューを投稿"}</h2>
        </div>

        <form className="modal-section post-form" onSubmit={handleSubmit}>
          <label className="post-form-label">
            スタジオ
            <select
              className="post-form-select"
              value={studioId}
              onChange={(e) => setStudioId(e.target.value)}
              disabled={isEditing}
              title={isEditing ? "投稿先スタジオは編集できません" : undefined}
            >
              {studios.map((s) => (
                <option key={s.studioId} value={s.studioId}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="post-form-label">
            評価
            <div className="star-rating-input">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="star-rating-btn"
                  onClick={() => setRating(n)}
                  aria-label={`${n}つ星`}
                >
                  <Star size={22} fill={n <= rating ? "currentColor" : "none"} />
                </button>
              ))}
            </div>
          </label>

          <label className="post-form-label">
            本文
            <textarea
              className="post-form-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="スタジオの様子や感想を書いてみましょう"
              rows={4}
            />
          </label>

          <label className="post-form-label post-form-file">
            <Camera size={16} />
            {file ? file.name : editingPost?.imageUrl ? "現在の写真を維持（変更する場合は選択）" : "写真を選択（任意）"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {error && <div className="error-banner">{error}</div>}

          <button className="btn-nav" type="submit" disabled={submitting}>
            {submitting ? (isEditing ? "更新中..." : "投稿中...") : isEditing ? "更新する" : "投稿する"}
          </button>
        </form>
      </div>
    </div>
  );
};
