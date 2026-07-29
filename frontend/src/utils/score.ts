/**
 * @fileoverview スコア表示に関するユーティリティ関数群。
 *
 * スタジオの総合スコア（0〜100）を元に
 * 色・ラベル・アイコンへの変換を担当する。
 * StudioCard・DetailModal・StudiosPage などで共通利用する。
 */

/**
 * スコアに応じた色コードを返す。
 * 地図マーカー・スコアサークル・スコアバーの色分けに使用する。
 *
 * @param {number} score - 総合スコア（0〜100）
 * @returns {string} カラーコード（16進数）
 *
 * @example
 * getScoreColor(85); // "#a855f7"（紫）
 * getScoreColor(65); // "#f5a623"（オレンジ）
 * getScoreColor(30); // "#e05c5c"（赤）
 */
export const getScoreColor = (score: number): string => {
  if (score >= 80) return "#a855f7"; // 高スコア: 紫
  if (score >= 60) return "#f5a623"; // 中スコア: オレンジ
  return "#e05c5c";                  // 低スコア: 赤
};

/**
 * スコアに応じた日本語ラベルを返す。
 *
 * @param {number} score - 総合スコア（0〜100）
 * @returns {string} スコアラベル（日本語）
 *
 * @example
 * getScoreLabel(85); // "絶好調"
 * getScoreLabel(65); // "良好"
 * getScoreLabel(45); // "普通"
 * getScoreLabel(20); // "低め"
 */
export const getScoreLabel = (score: number): string => {
  if (score >= 80) return "絶好調";
  if (score >= 60) return "良好";
  if (score >= 40) return "普通";
  return "低め";
};

/**
 * スコアを整数に丸めた文字列を返す。
 *
 * @param {number} score - 総合スコア（0〜100）
 * @returns {string} 整数に丸めたスコアの文字列
 *
 * @example
 * formatScore(85.4); // "85"
 * formatScore(62.7); // "63"
 */
export const formatScore = (score: number): string => Math.round(score).toString();

/**
 * 口コミ評価スコアに応じたアイコンを返す。
 *
 * @param {number} score - 評価スコア（0〜100）
 * @returns {string} 評価を表す絵文字
 */
export const getRatingIcon = (score: number): string => {
  if (score >= 80) return "⭐";
  if (score >= 60) return "🌟";
  if (score >= 40) return "✨";
  return "☆";
};

/**
 * 人気度スコアに応じたアイコンを返す。
 *
 * @param {number} score - 人気度スコア（0〜100）
 * @returns {string} 人気度を表す絵文字
 */
export const getPopularityIcon = (score: number): string => {
  if (score >= 80) return "🔥";
  if (score >= 60) return "👍";
  if (score >= 40) return "🙂";
  return "🌱";
};

/**
 * 料金プラン一覧から表示用の価格帯文字列を組み立てる。
 * 複数プランがあれば最安〜最高、1件のみなら単一の金額、無ければ単一cost、
 * どちらも無ければ「問合せ」を返す。
 *
 * @param {{priceYen: number}[] | undefined} priceOptions - 料金プラン一覧
 * @param {number} cost - 単一の代表料金（priceOptionsが無い場合のフォールバック）
 * @returns {string} 表示用の価格帯文字列
 */
export const formatPriceRange = (priceOptions: { priceYen: number }[] | undefined, cost: number): string => {
  if (priceOptions && priceOptions.length > 0) {
    const prices = priceOptions.map((p) => p.priceYen);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? `約¥${min.toLocaleString()}/時間` : `約¥${min.toLocaleString()}〜¥${max.toLocaleString()}/時間`;
  }
  return !cost || cost === 0 ? "問合せ" : `約¥${cost.toLocaleString()}/時間`;
};

/**
 * 距離（km）をバックエンドの calc_score と同じ正規化係数(0〜100)に変換する。
 * distanceKm/100 を 0〜100 にクランプして返す（backend/lambda/batch/generate_studio_score.py
 * の calc_score() 内の dist_norm と同一の計算式）。
 *
 * @param {number} km - 距離（km）
 * @returns {number} 正規化された距離（0〜100）
 */
const normalizeDistance = (km: number): number => Math.min(km / 100, 1) * 100;

/**
 * 実際の現在地からの距離を使ってスコアを近似的に再計算する。
 *
 * バックエンドの calc_score() は score に「距離ペナルティ(-distNorm*0.1)」を
 * 織り込み済みで保存しているため、そのままでは距離だけを差し替えられない。
 * ここでは元の distanceKm 由来のペナルティを一度打ち消し、
 * 実際の現在地からの距離で計算し直したペナルティを掛け直すことで、
 * DBを書き換えずにクライアント側だけで「現在地基準の順位」を近似する。
 *
 * @param {object} rec - 元のおすすめデータ（score・distance を含む）
 * @param {number} newDistanceKm - 現在地からの実距離（km）
 * @returns {number} 現在地基準に再計算したスコア（0〜100）
 */
export const recalcScoreForDistance = (
  rec: { score: number; distance: number },
  newDistanceKm: number
): number => {
  const delta = (normalizeDistance(rec.distance) - normalizeDistance(newDistanceKm)) * 0.1;
  return Math.max(0, Math.min(100, rec.score + delta));
};
