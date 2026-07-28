/**
 * @fileoverview 画像プレビューのポップオーバー表示コンポーネント。
 *
 * hover（PC）/ 長押し（スマホ）で子要素の下に画像プレビューを表示する。
 * imageUrl が渡された場合はそれを表示し、渡されなかった場合はプレースホルダーを表示する。
 */

import { type ReactNode } from "react";
import { ImageOff } from "lucide-react";
import { useLongPress } from "../hooks/useLongPress";

/**
 * ImagePreviewPopover コンポーネントの Props。
 */
interface ImagePreviewPopoverProps {
  /** プレビュー対象となるトリガー要素（スタジオ名など） */
  children: ReactNode;
  /** 直接表示する画像URL */
  imageUrl?: string;
  /** ラッパー要素に付与する追加クラス名（省略可） */
  className?: string;
}

/**
 * hover/長押しで画像プレビューを表示するラッパーコンポーネント。
 *
 * @param {ImagePreviewPopoverProps} props
 * @returns {JSX.Element} トリガー要素 + 条件付きの画像プレビュー
 */
export const ImagePreviewPopover = ({ children, imageUrl, className }: ImagePreviewPopoverProps) => {
  const { visible, handlers } = useLongPress();

  return (
    <span className={`image-preview-wrapper ${className ?? ""}`} {...handlers}>
      {children}
      {visible && (
        <div className="image-preview-popover">
          {imageUrl ? (
            <img src={imageUrl} alt="プレビュー" loading="lazy" />
          ) : (
            <span className="image-preview-placeholder">
              <ImageOff size={20} />
            </span>
          )}
        </div>
      )}
    </span>
  );
};
