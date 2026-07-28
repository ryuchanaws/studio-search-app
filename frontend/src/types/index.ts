/**
 * @fileoverview アプリ全体で使用する型定義。
 *
 * DynamoDB のテーブル構造・API レスポンス・UI の状態管理に使用する
 * インターフェースをまとめて定義する。
 */

/**
 * レンタルスタジオのマスタデータ。
 * DynamoDB の studio-studios テーブルのレコードに対応する。
 */
export interface Studio {
  /** スタジオの一意識別子（PK） */
  studioId: string;
  /** スタジオ名 */
  name: string;
  /** 緯度（Google Maps マーカー表示に使用） */
  lat: number;
  /** 経度（Google Maps マーカー表示に使用） */
  lng: number;
  /** スタジオの説明文・住所（省略可） */
  description?: string;
  /** スタジオ写真のURL（省略可・S3にアップロードされた画像を指す） */
  imageUrl?: string;
  /** 設備タグ（省略可・例: ["鏡張り", "フローリング"]） */
  facilityTags?: string[];
  /** 収容人数の目安（省略可・Claudeによる推測、例: "小グループ向け（6〜10人）"） */
  capacityCategory?: string;
  /** 公式サイトURL（省略可・Google Places Detailsから取得。予約は外部サイトに委ねる） */
  website?: string;
  /** 電話番号（省略可・Google Places Detailsから取得） */
  phoneNumber?: string;
}

/**
 * AI バッチが生成したスタジオのおすすめ情報。
 * DynamoDB の studio-recommendations テーブルのレコードに対応する。
 * score はルールベースで計算し、reason のみ Claude API で生成する。
 */
export interface Recommendation {
  /** スタジオの一意識別子（PK・Studios テーブルと結合キー） */
  studioId: string;
  /** 総合スコア（0〜100）。ルールベースで計算 */
  score: number;
  /** 設備タグリスト（例: ["鏡張り", "フローリング"]） */
  facilityTags: string[];
  /** AI が生成した推薦理由（自然言語・日本語） */
  reason: string;
  /** 基準地点からの距離（km）。「現在地から探す」の再ランキング計算にのみ使用し、
   * スコア自体にはもう使われていない（スコアには stationDistanceKm を使用） */
  distance: number;
  /** 最寄り駅からの距離（km）。スコアの距離ペナルティに使用する実際の値 */
  stationDistanceKm?: number;
  /** 収容人数の目安（省略可・Claudeによる推測） */
  capacityCategory?: string;
  /** 利用料金（円。0 = 不明/情報なし。公式サイトからのAI抽出値なので目安として扱う） */
  cost: number;
  /** 口コミ評価スコア（0〜100） */
  ratingScore: number;
  /** 人気度スコア（0〜100） */
  popularityScore: number;
  /** バッチ処理の最終実行日時（ISO 8601 形式・省略可） */
  updatedAt?: string;
  /** 結合済みのスタジオ情報（API レスポンス時に付与・省略可） */
  studio?: Studio;
}

/**
 * ユーザーのお気に入りスタジオ。
 * DynamoDB の studio-favorites テーブルのレコードに対応する。
 * userId（PK）+ studioId（SK）の複合キーで一意性を担保する。
 */
export interface Favorite {
  /** ユーザーID（PK） */
  userId: string;
  /** スタジオID（SK・Studios テーブルと結合キー） */
  studioId: string;
  /** ユーザーが登録したメモ（省略可） */
  memo?: string;
  /** 結合済みのスタジオ情報（API レスポンス時に付与・省略可） */
  studio?: Studio;
}

/**
 * レビュー投稿。
 * DynamoDB の studio-posts テーブルのレコードに対応する。
 */
export interface Post {
  /** 投稿の一意識別子（PK） */
  postId: string;
  /** 投稿対象のスタジオID（Studios テーブルと結合キー） */
  studioId: string;
  /** 投稿者のユーザーID */
  userId: string;
  /** 投稿本文 */
  content: string;
  /** 添付画像の URL（省略可） */
  imageUrl?: string;
  /** ★評価（1〜5、省略可） */
  rating?: number;
  /** 投稿日時（ISO 8601 形式） */
  createdAt: string;
  /** 最終編集日時（ISO 8601 形式・省略可。編集されたことがない投稿には無い） */
  updatedAt?: string;
  /** 結合済みのスタジオ情報（API レスポンス時に付与・省略可） */
  studio?: Studio;
  /** 投稿者の表示名（サーバー側でUsersTableと結合して付与・省略可。未設定ユーザーは"匿名"） */
  authorName?: string;
}

/**
 * ログイン中ユーザー自身のプロフィール（表示名）。
 * DynamoDB の studio-users テーブルのレコードに対応する。
 */
export interface Profile {
  /** ユーザーID（Cognitoのsub、PK） */
  userId: string;
  /** 表示名。未設定の場合はnull */
  displayName: string | null;
  /** ログインに使ったメールアドレス */
  email: string;
}

/**
 * AI バッチ処理の実行状態。
 * フロントエンドの「AI分析を実行」ボタンの UI 制御に使用する。
 */
export interface BatchStatus {
  /**
   * バッチの実行状態。
   * - `idle`      : 未実行（初期状態）
   * - `running`   : 実行中（ボタン無効化・スピナー表示）
   * - `completed` : 完了（成功メッセージ表示）
   * - `failed`    : 失敗（エラーメッセージ表示）
   * - `timeout`   : バッチは非同期起動されたがポーリング時間内に完了を確認できなかった
   */
  status: "running" | "completed" | "failed" | "timeout" | "idle";
  /** バッチ開始日時（ISO 8601 形式・省略可） */
  startedAt?: string;
  /** バッチ完了日時（ISO 8601 形式・省略可） */
  completedAt?: string;
  /** エラーメッセージまたは補足メッセージ（省略可） */
  message?: string;
  /** バッチで処理したスタジオ数（省略可） */
  processedCount?: number;
}

/**
 * S3への直接アップロード用に発行される署名付きURLのレスポンス。
 * uploadUrl に画像バイナリをPOSTし、完了後は publicUrl を
 * Post.imageUrl / Studio.imageUrl として保存する。
 */
export interface UploadPresignResponse {
  /** S3への署名付きPOSTアップロード先URL（有効期限5分） */
  uploadUrl: string;
  /** uploadUrlへのPOST時にFormDataへ含める追加フィールド */
  uploadFields: Record<string, string>;
  /** アップロード完了後に画像を参照するための公開URL */
  publicUrl: string;
}

/**
 * AIチャットの1メッセージ。
 * DynamoDB の studio-chats テーブルの messages 配列要素に対応する。
 */
export interface ChatMessage {
  /** 発言者。ユーザー発言かAI応答か */
  role: "user" | "assistant";
  /** メッセージ本文 */
  content: string;
  /** 添付画像のURL（省略可・userロールのみ有効） */
  imageUrl?: string;
  /** 発言日時（ISO 8601 形式） */
  createdAt: string;
}

/**
 * チャット履歴一覧の1件（軽量版・messagesを含まない）。
 */
export interface ChatSummary {
  /** チャットの一意識別子（PK・Chatsテーブルと結合キー） */
  chatId: string;
  /** チャットのタイトル（最初のユーザー発言から自動生成） */
  title: string;
  /** 最終更新日時（ISO 8601 形式・履歴一覧のソートに使用） */
  updatedAt: string;
}

/**
 * チャットの全メッセージを含む完全なデータ。
 */
export interface Chat extends ChatSummary {
  /** 会話の全メッセージ（古い順） */
  messages: ChatMessage[];
  /** チャット作成日時（ISO 8601 形式） */
  createdAt: string;
}
