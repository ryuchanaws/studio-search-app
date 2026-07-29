/**
 * @fileoverview API Gateway へのHTTPリクエストを担当するAPIクライアント。
 * axios インスタンスを共有し、全エンドポイントへのアクセスを提供する。
 */

import axios from "axios";
import type {
  Recommendation,
  Studio,
  Post,
  Favorite,
  BatchStatus,
  UploadPresignResponse,
  Chat,
  ChatSummary,
  Profile,
} from "../types";

/**
 * API Gateway のベースURL。
 * 環境変数 VITE_API_BASE_URL が未設定の場合はプレースホルダーを使用する。
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://your-api-id.execute-api.ap-northeast-1.amazonaws.com/Prod";

/**
 * 共有 axios インスタンス。
 * タイムアウト・Content-Type ヘッダーをデフォルト設定済み。
 */
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: { "Content-Type": "application/json" },
});

/**
 * 現在ログイン中ユーザーのid_token。AuthTokenSync が認証状態の変化のたびに更新する。
 */
let authToken: string | null = null;

/**
 * ログイン中ユーザーのid_tokenを設定する（未ログイン時はnull）。
 *
 * @param {string | null} token - Cognitoが発行したid_token
 */
export const setAuthToken = (token: string | null): void => {
  authToken = token;
};

api.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

/**
 * おすすめスタジオ一覧を取得する。
 *
 * @returns {Promise<Recommendation[]>} スコア降順のおすすめスタジオリスト
 */
export const getRecommendations = async (): Promise<Recommendation[]> => {
  const { data } = await api.get("/recommendations");
  return data.items ?? data;
};

/**
 * 全レンタルスタジオ一覧を取得する。
 *
 * @returns {Promise<Studio[]>} 全スタジオリスト
 */
export const getStudios = async (): Promise<Studio[]> => {
  const { data } = await api.get("/studios");
  return data.items ?? data;
};

/**
 * レビュー投稿一覧を取得する。
 *
 * @returns {Promise<Post[]>} 新しい順にソートされた投稿リスト
 */
export const getPosts = async (): Promise<Post[]> => {
  const { data } = await api.get("/posts");
  return data.items ?? data;
};

/**
 * ログイン中ユーザーのお気に入りスタジオ一覧を取得する（Cognito認証必須）。
 *
 * @returns {Promise<Favorite[]>} お気に入りスタジオリスト
 */
export const getFavorites = async (): Promise<Favorite[]> => {
  const { data } = await api.get("/favorites");
  return data.items ?? data;
};

/**
 * お気に入りスタジオを追加する（Cognito認証必須）。
 *
 * @param {string} studioId - 追加するスタジオID
 * @param {string} [memo] - メモ（省略可）
 * @returns {Promise<void>}
 */
export const addFavorite = async (studioId: string, memo?: string): Promise<void> => {
  await api.post("/favorites", { studioId, memo });
};

/**
 * お気に入りスタジオを削除する（Cognito認証必須）。
 *
 * @param {string} studioId - 削除するスタジオID
 * @returns {Promise<void>}
 */
export const removeFavorite = async (studioId: string): Promise<void> => {
  await api.delete(`/favorites/${studioId}`);
};

/**
 * スタジオ詳細の表示・予約ボタンのクリックを記録する（認証不要・未ログインでも送信できる）。
 *
 * 計測が目的の副作用的な呼び出しのため、失敗してもUIをブロックしない
 * （呼び出し側は結果を待たずfire-and-forgetで呼ぶことを想定し、ここでエラーを握り潰す）。
 *
 * @param {"view_detail" | "click_reserve"} eventType - イベント種別
 * @param {string} studioId - 対象スタジオID
 * @returns {Promise<void>}
 */
export const recordAnalyticsEvent = async (
  eventType: "view_detail" | "click_reserve",
  studioId: string
): Promise<void> => {
  try {
    await api.post("/analytics/event", { eventType, studioId });
  } catch {
    // 計測失敗はユーザー体験に影響させない（ログも出さず静かに無視する）
  }
};

/**
 * AI バッチ処理を非同期に起動する。
 *
 * POST /admin/run-ai-batch を呼び出し、generateStudioScoreBatch Lambda を
 * 非同期起動する。バッチの完了は待たず、起動を受け付けた時点で即座に返る
 * （API Gateway の29秒タイムアウトを回避するため）。
 * 完了確認は呼び出し側で GET /recommendations をポーリングして行う。
 *
 * @returns {Promise<BatchStatus>} 起動受付結果（status: "started", startedAt を含む）
 */
export const runAiBatch = async (): Promise<BatchStatus> => {
  const { data } = await api.post("/admin/run-ai-batch");
  return data;
};

/**
 * 現在地周辺の新規スタジオ候補の探索バッチを非同期に起動する。
 *
 * POST /admin/run-studio-discovery を呼び出し、Google Places API を使った
 * 新規スタジオ探索バッチを起動する。runAiBatch 同様、完了は待たずに
 * 起動を受け付けた時点で即座に返る。
 *
 * @param {object} position - ユーザーの現在地
 * @param {number} position.lat - 緯度
 * @param {number} position.lng - 経度
 * @returns {Promise<BatchStatus>} 起動受付結果（status: "started", startedAt を含む）
 */
export const runStudioDiscovery = async (position: { lat: number; lng: number }): Promise<BatchStatus> => {
  const { data } = await api.post("/admin/run-studio-discovery", position);
  return data;
};

/**
 * レビュー投稿を作成する。
 *
 * @param {object} input
 * @param {string} input.studioId - 投稿対象のスタジオID
 * @param {string} input.content - 投稿本文
 * @param {string} [input.imageUrl] - 添付画像のURL（uploadImageToS3完了後のpublicUrlを渡す）
 * @param {number} [input.rating] - ★評価（1〜5）
 * @returns {Promise<Post>} 作成された投稿
 */
export const createPost = async (input: {
  studioId: string;
  content: string;
  imageUrl?: string;
  rating?: number;
}): Promise<Post> => {
  const { data } = await api.post("/posts", input);
  return data.post;
};

/**
 * レビュー投稿を削除する。
 *
 * @param {string} postId - 削除対象の投稿ID
 * @returns {Promise<void>}
 */
export const deletePost = async (postId: string): Promise<void> => {
  await api.delete(`/posts/${postId}`);
};

/**
 * レビュー投稿を編集する。指定したフィールドのみ更新される。
 *
 * @param {string} postId - 編集対象の投稿ID
 * @param {object} input
 * @param {string} [input.content] - 投稿本文
 * @param {string} [input.imageUrl] - 添付画像のURL
 * @param {number} [input.rating] - ★評価
 * @returns {Promise<Post>} 更新後の投稿
 */
export const updatePost = async (
  postId: string,
  input: { content?: string; imageUrl?: string; rating?: number }
): Promise<Post> => {
  const { data } = await api.put(`/posts/${postId}`, input);
  return data.post;
};

/**
 * スタジオの写真URLを設定する。
 *
 * @param {string} studioId - 対象スタジオID
 * @param {string} imageUrl - 設定する画像URL（uploadImageToS3完了後のpublicUrl）
 * @returns {Promise<void>}
 */
export const updateStudioImage = async (studioId: string, imageUrl: string): Promise<void> => {
  await api.put(`/studios/${studioId}/image`, { imageUrl });
};

/**
 * S3への直接アップロード用の署名付きURLを発行する。
 *
 * @param {string} contentType - アップロードする画像のMIMEタイプ（例: "image/jpeg"）
 * @returns {Promise<UploadPresignResponse>} 署名付きアップロードURLと公開URL
 */
export const getPresignedUploadUrl = async (contentType: string): Promise<UploadPresignResponse> => {
  const { data } = await api.post("/uploads/presign", { contentType });
  return data;
};

/**
 * アップロード可能な画像の最大サイズ（バイト）。
 * バックエンド（handlers.py の MAX_UPLOAD_BYTES）と同じ値を保つこと。
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB

/**
 * 発行された署名付きフォームへ画像ファイルを直接アップロードする。
 *
 * API Gatewayのペイロードサイズ制限を避けるため、Lambdaを経由せず
 * S3へ直接POSTする（共有axiosインスタンスは使わない。別ホストのため）。
 *
 * @param {string} uploadUrl - getPresignedUploadUrl で取得した署名付きPOST先URL
 * @param {Record<string, string>} uploadFields - 同レスポンスの署名付きフォームフィールド
 * @param {File} file - アップロードする画像ファイル
 * @returns {Promise<void>}
 */
export const uploadImageToS3 = async (
  uploadUrl: string,
  uploadFields: Record<string, string>,
  file: File
): Promise<void> => {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`画像サイズが大きすぎます（上限${MAX_UPLOAD_BYTES / 1024 / 1024}MB）`);
  }

  const formData = new FormData();
  Object.entries(uploadFields).forEach(([key, value]) => formData.append(key, value));
  // "file" フィールドはS3の仕様上フォームの最後に追加する必要がある
  formData.append("file", file);

  const res = await fetch(uploadUrl, { method: "POST", body: formData });
  if (!res.ok) {
    throw new Error(`Image upload failed: ${res.status}`);
  }
};

/**
 * AIチャットにメッセージを送信する（新規 or 既存チャットへの追記、または編集）。
 *
 * バッチ処理と違い応答を同期的に待つ必要があるため、共有axiosインスタンスの
 * デフォルトタイムアウト(10秒)より長い28秒を明示的に指定する
 * （バックエンドのLambda Timeoutが25秒のため、それより少し長く設定）。
 *
 * @param {object} input
 * @param {string} [input.chatId] - 既存チャットへの追記の場合に指定（省略時は新規チャット作成）
 * @param {string} input.message - 送信するメッセージ本文
 * @param {string} [input.imageUrl] - 添付画像のURL（uploadImageToS3完了後のpublicUrlを渡す）
 * @param {number} [input.lat] - 現在地の緯度（省略可。「近くのスタジオ」の案内精度を上げる）
 * @param {number} [input.lng] - 現在地の経度（省略可）
 * @param {number} [input.editIndex] - 送信済みメッセージを訂正して再送信する場合、対象のインデックス
 * @returns {Promise<{chatId: string; reply: string; updatedAt: string}>} AIの応答
 */
export const sendChatMessage = async (input: {
  chatId?: string;
  message: string;
  imageUrl?: string;
  lat?: number;
  lng?: number;
  editIndex?: number;
}): Promise<{ chatId: string; reply: string; updatedAt: string }> => {
  const { data } = await api.post("/chat", input, { timeout: 28000 });
  return data;
};

/**
 * チャット履歴一覧を新しい順で取得する（messagesを含まない軽量版）。
 *
 * @returns {Promise<ChatSummary[]>} チャット履歴一覧
 */
export const getChatHistory = async (): Promise<ChatSummary[]> => {
  const { data } = await api.get("/chats");
  return data.items ?? data;
};

/**
 * 特定チャットの全メッセージを取得する。
 *
 * @param {string} chatId - 対象チャットID
 * @returns {Promise<Chat>} チャットの全メッセージを含むデータ
 */
export const getChat = async (chatId: string): Promise<Chat> => {
  const { data } = await api.get(`/chats/${chatId}`);
  return data;
};

/**
 * チャットを削除する。
 *
 * @param {string} chatId - 削除対象のチャットID
 * @returns {Promise<void>}
 */
export const deleteChat = async (chatId: string): Promise<void> => {
  await api.delete(`/chats/${chatId}`);
};

/**
 * ログイン中ユーザー自身のプロフィール（表示名）を取得する（Cognito認証必須）。
 *
 * @returns {Promise<Profile>} プロフィール（displayName未設定時はnull）
 */
export const getMyProfile = async (): Promise<Profile> => {
  const { data } = await api.get("/me");
  return data;
};

/**
 * 表示名を設定・更新する（Cognito認証必須）。
 *
 * @param {string} displayName - 新しい表示名（1〜30文字）
 * @returns {Promise<{userId: string; displayName: string}>}
 */
export const updateMyProfile = async (
  displayName: string
): Promise<{ userId: string; displayName: string }> => {
  const { data } = await api.put("/me", { displayName });
  return data;
};
