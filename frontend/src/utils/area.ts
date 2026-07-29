/**
 * @fileoverview 住所文字列から都道府県を抽出するユーティリティ。
 *
 * バックエンドの Studio レコードには都道府県を専用フィールドとして持たせておらず、
 * Google Places の formatted_address（例: "〒107-6243 東京都港区赤坂..."）を
 * description として保存している。既存スタジオも含めて追加のバックフィルなしで
 * エリア絞り込みを使えるようにするため、フロント側で住所文字列から都道府県名を
 * 抜き出す方式にしている。
 */

/** 日本の47都道府県（住所文字列内での出現判定に使う） */
export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

/**
 * 住所文字列（郵便番号を含んでいてもよい）から都道府県名を抽出する。
 *
 * @param {string | undefined} address - 住所・説明文（Studio.description相当）
 * @returns {string | null} 都道府県名。見つからない場合はnull
 */
export const extractPrefecture = (address: string | undefined): string | null => {
  if (!address) return null;
  return PREFECTURES.find((pref) => address.includes(pref)) ?? null;
};
