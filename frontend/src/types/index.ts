/**
 * @fileoverview アプリ全体で使用する型定義。
 *
 * DynamoDB のテーブル構造・API レスポンス・UI の状態管理に使用する
 * インターフェースをまとめて定義する。
 */

/**
 * 部屋・時間帯ごとの料金プラン（公式サイトからAIが抽出）。
 */
export interface PriceOption {
  /** プラン・部屋名（例: "Aスタジオ 20㎡"） */
  label: string;
  /** 1時間あたりの料金（円） */
  priceYen: number;
}

/**
 * スタジオの部屋マスタデータ（4ブランド専用）。
 * 部屋名・広さ・鏡または天井高・最安料金の基本情報を保持する。
 */
export interface StudioRoom {
  /** 部屋名（例: "101st"） */
  roomName: string;
  /** 部屋の広さ（㎡）。不明な場合はnull */
  areaSqm: number | null;
  /** 2つ目の寸法のラベル（"鏡" または "天井高"）。不明な場合はnull */
  secondDimensionLabel: string | null;
  /** 2つ目の寸法の値（m）。不明な場合はnull */
  secondDimensionM: number | null;
  /** 最安料金（円/時間目安）。不明な場合はnull */
  minPriceYen: number | null;
  /** この部屋の公式サイト予約ページへの直接リンク（省略可・ブランドにより取得可否が異なる） */
  reserveUrl?: string;
  /** 部屋写真のURL一覧（省略可・平面図は含まない） */
  photoUrls?: string[];
  /** 平面図画像のURL（省略可・BUZZのみ取得可能） */
  floorPlanUrl?: string;
  /** 設備・特記事項（省略可・ブランドにより取得できる項目が異なる。
   * 例: BUZZは"調光利用"等のタグ、NOAHは"ギターアンプ: Marshall JCM900"等の機材リスト） */
  equipment?: string[];
}

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
  /** 部屋・時間帯ごとの料金プラン（省略可・公式サイトからAIが抽出。無ければ問合せ扱い） */
  priceOptions?: PriceOption[];
  /** ブランド（4ブランドのいずれか・省略可） */
  brand?: "buzz" | "worcle" | "noah" | "mission";
  /** 住所（省略可） */
  address?: string;
  /** 部屋マスタデータ一覧（省略可） */
  rooms?: StudioRoom[];
  /** 公式サイトのスタジオ・店舗ページURL（省略可・4ブランドのスクレイピング元URL） */
  sourceUrl?: string;
}

/**
 * 空き状況取得時の30分単位の時間枠。
 */
export interface AvailabilitySlot {
  /** 時刻（例: "06:00"） */
  time: string;
  /** 空きがあるかどうか */
  available: boolean;
}

/**
 * 部屋ごとの空き状況（部屋マスタ情報 + 時間枠一覧）。
 */
export interface RoomAvailability extends StudioRoom {
  /** 30分単位の時間枠一覧 */
  slots: AvailabilitySlot[];
}

/**
 * スタジオの空き状況取得APIのレスポンス。
 * GET /studios/{studioId}/availability?date=YYYY-MM-DD に対応する。
 */
export interface StudioAvailability {
  /** スタジオの一意識別子 */
  studioId: string;
  /** 対象日（YYYY-MM-DD） */
  date: string;
  /** 部屋ごとの空き状況一覧（未対応ブランドは空配列） */
  rooms: RoomAvailability[];
  /** スクレイピング実行日時（ISO 8601 形式）。未取得の場合はnull */
  scrapedAt: string | null;
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

/**
 * 「目的（振り入れ/構成）」の選択肢。バックエンドの EVENT_PURPOSES と一致させる。
 */
export type EventPurpose = "振り入れ" | "構成";

/**
 * ユーザーが登録する「次のイベント」情報。
 * DynamoDB の studio-events テーブルのレコードに対応する。
 * ログイン中ユーザーが複数件登録・管理できる。
 */
export interface StudioEvent {
  /** ユーザーID（PK・Cognitoのsub） */
  userId: string;
  /** イベントの一意識別子（SK） */
  eventId: string;
  /** イベント名（例: "秋公演"） */
  title: string;
  /** ステージ横幅（メートル） */
  stageWidthM: number;
  /** ステージ奥行き（メートル） */
  stageDepthM: number;
  /** 出演人数 */
  performerCount: number;
  /** 登録日時（ISO 8601 形式） */
  createdAt: string;
  /** 最終更新日時（ISO 8601 形式） */
  updatedAt: string;
}

/**
 * GET /recommend-studios の1件分。条件（広さ・空き時間帯）を満たした
 * スタジオ・部屋の組み合わせ。
 */
export interface RecommendedRoom {
  /** 条件を満たした部屋が属するスタジオ */
  studio: Studio;
  /** 条件を満たした部屋そのもの */
  room: StudioRoom;
}
