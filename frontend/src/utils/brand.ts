/**
 * @fileoverview ブランド関連の共通定義。
 *
 * サポート対象の4ブランド（BUZZ / worcle / NOAH / スタジオミッション）の
 * 表示名・カラーコードをまとめて管理する。地図マーカー・カード・バッジなど
 * ブランドの色分けが必要な箇所で共通利用する。
 */

import type { Studio } from "../types";

/** サポート対象ブランドの一覧 */
export const BRANDS: NonNullable<Studio["brand"]>[] = ["buzz", "worcle", "noah", "mission"];

/** ブランドの日本語表示名 */
export const BRAND_LABELS: Record<NonNullable<Studio["brand"]>, string> = {
  buzz: "BUZZ",
  worcle: "worcle",
  noah: "NOAH",
  mission: "スタジオミッション",
};

/** ブランドごとのアクセントカラー（地図マーカー・バッジ・カードの色分けに使用） */
export const BRAND_COLORS: Record<NonNullable<Studio["brand"]>, string> = {
  buzz: "#a855f7",
  worcle: "#3b82f6",
  noah: "#22c55e",
  mission: "#f59e0b",
};
