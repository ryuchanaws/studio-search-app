# レンタルスタジオサーチアプリ — デプロイ手順

ダンス・ヨガ用のレンタルスタジオを、AIが口コミ評価・人気度・設備から算出したスコア順に
おすすめしてくれるアプリ。釣行AIアプリ（fishing-ai-app）と同じ思想・ほぼ同じアーキテクチャで、
同じAWSアカウント上に別のCloudFormationスタックとして構築している。

## 前提条件

- AWS CLI がインストール済みで認証済みであること
- GitHub リポジトリが作成済みであること（本リポジトリ）
- Python 3.12 / Node.js 22 がインストール済みであること

---

## 1. AWS SSM にシークレット登録

Claude API キー（Anthropic）を AWS Systems Manager パラメータストアに安全に保存する。
Lambda の環境変数に直接書かずに SSM から取得することでセキュリティを高める
（AIコメント生成・AI相談チャット・設備推定に使用）。

> 釣行AIアプリと同じ Anthropic クレジット残高を使い回してよいが、
> Lambdaごとの権限スコープを綺麗に保つため、キーの登録パス自体は
> `/fishing-ai/*` とは別の `/studio-search/*` に分けている。

```bash
aws ssm put-parameter \
  --name /studio-search/anthropic-api-key \
  --value "sk-ant-xxxxxxxx" \
  --type SecureString
```

> `sk-ant-xxxxxxxx` は実際の Claude API キーに置き換えること。
> Anthropic Console（https://console.anthropic.com/settings/keys）で取得できる。
>
> **注意:** `aws ssm put-parameter`/`get-parameter` の `--name` に渡す**実際のパラメータ名**は、
> `/`を含む階層型の場合は先頭にスラッシュが必須（AWSの仕様）。一方、`template.yaml` の
> `SSMParameterReadPolicy.ParameterName` は**逆に先頭スラッシュを付けない**のが正しい
> （SAM側が内部で `parameter/${ParameterName}` として自動でスラッシュを補ってARNを組み立てるため）。

「新スタジオを探す」機能（discoverStudiosBatch）が使う Google Places API キーも同様に登録する。
Google Cloud Console で Places API を有効化し、課金アカウントを紐付けたうえでキーを発行すること。

```bash
aws ssm put-parameter \
  --name /studio-search/google-places-api-key \
  --value "AIzaxxxxxxxx" \
  --type SecureString
```

> このパラメータが未登録の場合、discoverStudiosBatch は何もせず `{"status": "skipped"}` を
> 返して正常終了する（エラーにはならないが、新スタジオも増えない）。

---

## 2. GitHub Secrets 登録

GitHub Actions のワークフローから AWS や外部サービスに安全にアクセスするために
以下の Secrets をリポジトリに登録する。

**登録場所:** GitHub リポジトリ → Settings → Secrets and variables → Actions

| シークレット名 | 説明 | 取得場所 |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | AWS IAM ユーザーのアクセスキーID | AWS IAM コンソール（釣行AIアプリと同じ値を使い回してよいが、Secrets自体はこのリポジトリに別途登録する必要がある） |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM ユーザーのシークレットキー | AWS IAM コンソール |
| `S3_BUCKET` | フロントエンドをホストする S3 バケット名 | 手順3で作成 |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront ディストリビューション ID | AWS CloudFront コンソール |
| `VITE_API_BASE_URL` | API Gateway のエンドポイント URL | SAM デプロイ後の出力値（`ApiEndpoint`） |
| `VITE_GOOGLE_MAPS_KEY` | Google Maps API キー | Google Cloud Console |
| `VITE_COGNITO_USER_POOL_ID` | Cognito User Pool ID | `sam deploy` 後の Outputs（`UserPoolId`） |
| `VITE_COGNITO_CLIENT_ID` | Cognito User Pool Client ID | `sam deploy` 後の Outputs（`UserPoolClientId`） |
| `VITE_COGNITO_DOMAIN` | Cognito Hosted UI のドメイン | `sam deploy` 後の Outputs（`CognitoHostedUiDomain`）。詳細は下記「9. 認証（Cognito + Google）のセットアップ」参照 |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Workers へのデプロイ権限を持つ API トークン | Cloudflareダッシュボード → プロフィール → API Tokens →「Edit Cloudflare Workers」テンプレート |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウントID | Cloudflareダッシュボード（トークン発行時にも表示される） |

> **補足:** スタジオ写真・投稿写真のアップロード先S3バケット（`studio-search-app-uploads-<アカウントID>`）は
> ここでは扱わない。こちらは `template.yaml` の `UploadsBucket` としてSAM/CloudFormationで自動作成されるため、
> 手動作成は不要（下記「3. S3 バケット作成」で扱うのはフロント静的ホスティング用の別バケット）。

---

## 3. S3 バケット作成（静的ウェブホスティング）

React ビルド成果物をホストする S3 バケットを作成し、静的ウェブサイトホスティングを有効化する。

```bash
# バケット作成（YOUR_BUCKET_NAME は一意の名前に変更すること）
aws s3 mb s3://YOUR_BUCKET_NAME --region ap-northeast-1

# 静的ウェブホスティング設定
# index.html をエントリーポイント、エラー時も index.html を返すことで
# React Router の SPA ルーティングを有効にする
aws s3 website s3://YOUR_BUCKET_NAME \
  --index-document index.html \
  --error-document index.html
```

> バケット名は全世界で一意である必要がある。
> 例: `studio-search-app-prod-202601` のように日付やプロジェクト名を含めると安全。
> CloudFront経由でCORS等を設定する場合は、その後CloudFrontディストリビューションを作成し
> `CLOUDFRONT_DISTRIBUTION_ID` をSecretsに登録すること。

---

## 4. 初期データについて

釣行AIアプリと異なり、本アプリには手動シード投入用のスクリプトは用意していない。
初回に「AI分析を実行」ボタンを押すと、`discover_studios.run_discovery()`（全国向け
Google Places Text Search）が自動的に実行されてから、スコア計算が行われる。
そのため、デプロイ直後は「おすすめ」が0件でも問題なく、ボタンを押せば数十秒〜1分程度で
データが揃う。

---

## 5. デプロイ

main ブランチに push することで GitHub Actions が自動的に以下を実行する。

1. SAM ビルド → Lambda + DynamoDB を CloudFormation でデプロイ（スタック名: `studio-search-app`）
2. React ビルド → S3 アップロード → CloudFront キャッシュ削除

```bash
git add .
git commit -m "feat: initial deploy"
git push origin main
```

> GitHub Actions の実行状況はリポジトリの Actions タブで確認できる。
> 初回デプロイは SAM スタック作成のため 5〜10 分程度かかる場合がある。
> 釣行AIアプリ（`fishing-ai-app`スタック）とは完全に別のスタックのため、
> 同一AWSアカウント内でもリソース名の衝突なく共存できる。

---

## 6. 動作確認

デプロイ完了後、以下の手順でアプリが正常に動作していることを確認する。

1. **CloudFront URL にアクセス**
   - AWS CloudFront コンソールでディストリビューションの URL を確認してブラウザで開く

2. **AI 分析を実行**
   - TOP ページの「AI 分析を実行」ボタンをクリックする
   - (a) Google Places APIによる新規スタジオ探索（全国向け、位置指定なし）→
     (b) 全スタジオの口コミ評価・人気度取得＋Claude呼び出しによるスコア計算・推薦理由生成、
     の順に実行するため、合計60〜90秒程度かかる
   - 90秒待っても完了を検知できない場合は「バックグラウンドで実行中の可能性があります」
     という中立的な表示になる（エラーではなく、裏側では継続している可能性がある状態）

3. **結果を確認**
   - 分析完了後、スタジオのスコアとAIコメント（推薦理由）が表示されることを確認する
   - TOP3 ランキングと地図ピンが正しく表示されれば成功
   - スコアは口コミ評価（rating）・レビュー数（user_ratings_total）・設備の充実度に基づいて算出される
   - TOP3カードはスタジオ写真が登録されている場合、カード上部にヒーロー写真として表示される
     （その他一覧・お気に入り一覧は従来通りホバー/長押しプレビューのみ）

4. **現在地からのおすすめ（サブ機能）**
   - TOPページ右上の現在地アイコンをクリックし、ブラウザの位置情報許可ダイアログを承認する
   - メインのTOP3（基準地点からのスコア）とは別に、現在地からの実距離で再ランキングした上位3件が表示される
   - この再ランキングはクライアント側だけで計算しておりDBは書き換わらない

5. **新スタジオ自動発見**
   - 全国向けの探索は「AI分析を実行」に統合済み。押すたびに `discover_studios.run_discovery()` が
     まず実行され、見つかった新規スタジオもその回のスコア計算対象に含まれる
   - 「現在地から新スタジオを探す」ボタンは現在地に絞った探索専用。押すと位置情報の許可を求め、
     取得できたら現在地周辺15km圏内で discoverStudiosBatch を非同期起動する（スコア計算は行わない）
   - Google Places API キー未登録の場合はどちらも何も追加されずに正常終了する（上記1参照）

6. **レビュー投稿**
   - ナビの「レビュー」タブから投稿一覧・投稿フォームを確認する
   - ★評価（1〜5）と本文を入力し、写真を選択して投稿すると、S3への直接アップロード
     （署名付きURL）→投稿作成の順に実行される
   - 自分の投稿には編集ボタン（鉛筆アイコン）が表示され、★評価・本文・写真を後から変更できる
     （投稿先スタジオは変更不可。編集すると投稿に「（編集済み）」と表示される）

7. **AI相談（チャット）**
   - ナビの「AI相談」タブから、初心者向けかどうか・雰囲気などをテキストで質問できる
   - 入力欄の画像アイコンから「アルバムから選択」、カメラアイコンから「その場で撮影」でき、
     どちらも同じ送信フローに統合されている
   - 会話はDynamoDB（`studio-chats`）に保存される。「+」ボタンで新しい会話を開始（保存は次の送信時）、
     「履歴」ボタンで過去の会話一覧から再開できる
   - 自分の発言は鉛筆アイコンから本文を訂正して再送信でき、AIの回答も作り直される
   - 応答は同期的に返るため他のAI機能と違いポーリングはしない。Claude呼び出しがLambdaの25秒
     タイムアウトを超えた場合はエラーメッセージが表示される

8. **PWA化（ホーム画面への追加）**
   - スマホのブラウザ（Chrome/Safari等）で本番URLを開き、「ホーム画面に追加」/「アプリをインストール」を実行する
   - アイコン・アプリ名（スタジオサーチ）が正しく表示され、起動時にブラウザのアドレスバー無しで開けば成功

9. **アップロードサイズ上限**
   - スタジオ写真・投稿写真・チャット添付画像、いずれも8MBを超えるファイルはアップロードできない
   - 上限はS3の署名付きPOSTフォームの `content-length-range` 条件で強制されており、
     フロント側のチェックをバイパスしても拒否される

10. **表示名（ユーザー名）の設定**
    - ログイン後、表示名が未設定の場合はモーダルが自動で開く（「閉じる」で後回しにもできる）
    - ナビ右上の人物アイコンからいつでも表示名を編集できる
    - 設定した表示名はレビュー投稿の投稿者名として表示される

11. **AI相談での実データ検索**
    - AI相談で「初心者でも通えるスタジオある？」等と聞くと、実際に登録されている
      Studios/Recommendationsデータに基づいて回答する（存在しないデータをAIが作り出さないよう、
      プロンプトに実データのみを渡している）
    - 入力欄の現在地アイコンをONにすると、実際の距離を計算して「近い順」の案内ができるようになる（任意）

12. **AI分析・新スタジオ探索のコスト保護**
    - Places/Claude APIの呼び出しを伴うこれらの操作には、AI相談と同じ仕組みで
      1ユーザー1日あたりの上限を設けている: AI分析3回・新スタジオ探索10回
      （`UsageTable`に記録、翌々日にTTLで自動削除）
    - 上限に達した状態でボタンを押すと、429エラーとともに「本日の利用回数（n件）に達しました。
      明日またお試しください。」という案内が表示される
    - 上限値は `template.yaml` の `RATE_LIMIT_DAILY` 環境変数で調整できる

---

## 7. デプロイ先

フロントエンドは釣行AIアプリと同じく2系統に並行デプロイする。バックエンド（API Gateway/Lambda/DynamoDB）はAWS側1本のみ。

| デプロイ先 | URL | デプロイ方法 |
|---|---|---|
| AWS（CloudFront） | （デプロイ後にここへ記載） | `main` ブランチへの push で GitHub Actions が自動デプロイ |
| Cloudflare Workers | （デプロイ後にここへ記載） | `main` ブランチへの push で GitHub Actions（`deploy-frontend` ジョブ内の `Deploy to Cloudflare Workers` ステップ）が同じビルド成果物を `npx wrangler deploy` する |

> Cloudflare側のWorker名は `frontend/wrangler.jsonc` の `name: "studio-search-app"` で指定しており、
> 釣行AIアプリの Worker（`ryu-chan-fish`）とは別物。GitHub Secrets もリポジトリごとに別登録のため、
> 誤ってどちらかのアプリのビルドがもう片方のWorkerに上書きされることは無い。
> Cloudflare側の自動デプロイには GitHub Secrets `CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID` の登録が必要
> （釣行AIアプリと同じCloudflareアカウントを使い回してよいが、Secrets自体はこのリポジトリに別途登録する必要がある）。

---

## 8. テスト

`main` へのPull Request作成/更新のたびに `.github/workflows/test.yml` が自動実行される
（デプロイ用の `deploy.yml` とは別ワークフロー。テストのみ行いAWSへは一切デプロイしない）。

### バックエンド（pytest）

実AWSには接続せず、`moto` でDynamoDB/S3をモックする。

```bash
cd backend
pip install -r requirements-dev.txt -r lambda/api/requirements.txt -r lambda/batch/requirements.txt
pytest tests -v
```

> `backend/tests/` はSAMの各Lambda（CodeUri）ディレクトリの外に置いている
> （中に置くとテストコードがLambdaのデプロイパッケージに巻き込まれてしまうため）。
> `conftest.py` が `lambda/api`・`lambda/batch` を import パスに追加している。

### フロントエンド ユニットテスト（Vitest）

```bash
cd frontend
npm run test
```

> 釣行AIアプリで導入していた Playwright によるE2E/VRTはv1では見送っている
> （`package.json` に `@playwright/test` を含めていない）。

### コードレビューについて
GitHubのPR画面上でのレビュー（コメント・Approve/Request changes）は追加設定なしで利用できる。
マージをテスト成功まで強制ブロックしたい場合は、リポジトリの Branch protection rule 設定
（GitHub管理者権限が必要）を別途行うこと。

---

## 9. 認証（Cognito + Google）のセットアップ

**閲覧**（おすすめ・地図・スタジオ一覧・投稿一覧）はログイン不要のまま。**操作**
（お気に入り・投稿作成/削除・AI相談・AI分析実行・新スタジオ探索）はログイン必須。

`template.yaml` の `UserPoolDomain` に `!Sub "studio-search-app-${AWS::AccountId}"` を指定しているため、
Hosted UIのドメインは `https://studio-search-app-<AWSアカウントID>.auth.ap-northeast-1.amazoncognito.com`
という決まった形式になる。そのため、以下の手順は**デプロイ前でも**進められる。

> 釣行AIアプリと同じGoogleアカウント・同じGCPプロジェクトを使ってよいが、
> Cognito User Pool（Client ID・Hosted UIドメイン）はアプリごとに別物になるため共有できない。
> Google Cloud Console側でも**新しいOAuthクライアント**を発行すること。

### 9.1 Google Cloud Console で OAuth クライアントを作成

1. [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) を開く
   （Maps/Places APIキーと同じプロジェクトでよい）
2. 「認証情報を作成」→「OAuth クライアント ID」
   - アプリケーションの種類: **ウェブ アプリケーション**
   - 承認済みのリダイレクト URI に以下を追加:
     ```
     https://studio-search-app-<AWSアカウントID>.auth.ap-northeast-1.amazoncognito.com/oauth2/idpresponse
     ```
     （`<AWSアカウントID>` は `aws sts get-caller-identity --query Account --output text` で確認できる）
3. 発行された **クライアントID** と **クライアントシークレット** を控える

### 9.2 SSM にクライアントID/シークレットを登録

`template.yaml` の `UserPoolGoogleIdP` が `{{resolve:ssm:...}}` で参照するため、デプロイ前に
登録しておく必要がある（未登録のままデプロイすると `UserPoolGoogleIdP` の作成に失敗する）。

```bash
aws ssm put-parameter \
  --name /studio-search/google-oauth-client-id \
  --value "xxxxxxxx.apps.googleusercontent.com" \
  --type String

aws ssm put-parameter \
  --name /studio-search/google-oauth-client-secret \
  --value "GOCSPX-xxxxxxxx" \
  --type String
```

> client_secretはCognitoのIdentityProvider向けにCloudFormationの動的参照（SecureString）が
> 使えないため、通常の String（非暗号化）パラメータとして登録する。読み取りは
> CloudFormationのスタック実行時のみでIAM権限も絞っているため、実運用上のリスクは限定的と判断している。

### 9.3 デプロイ

通常どおり `main` へ push すれば `sam deploy` が Cognito一式・API Gatewayの認証設定・
`UsageTable`・`CostBudget` をまとめて作成する。デプロイ完了後、CloudFormationスタックの
Outputsから `UserPoolId` / `UserPoolClientId` / `CognitoHostedUiDomain` を確認し、
GitHub Secretsの `VITE_COGNITO_USER_POOL_ID` / `VITE_COGNITO_CLIENT_ID` / `VITE_COGNITO_DOMAIN`
に設定してから、もう一度 push（またはフロントエンドジョブの re-run）してフロントエンドを
再ビルドすること（ビルド時に埋め込まれる値のため、Secrets設定後の再ビルドが必要）。

```bash
aws cloudformation describe-stacks \
  --stack-name studio-search-app \
  --query "Stacks[0].Outputs"
```

ローカル開発（`npm run dev`）の場合は `frontend/.env` に同じ3つの値を設定する
（`.env.example` 参照）。

### 9.4 Claudeコスト管理（1日あたりのAI相談回数上限）

AI相談（`POST /chat`）に1ユーザー1日あたり30件（`handlers.py` の `DAILY_CHAT_LIMIT`）の
上限を設けている。超過時はClaudeを呼ばずに429エラーを返す。カウンタは `UsageTable`
（DynamoDB）にTTL付きで記録され、翌々日には自動で消える。

---

## 10. 利用料アラート

### AWS（自動化済み）
`template.yaml` の `CostBudget` が月額$10のAWS Budgetsアラートを作成する
（80%/100%到達時に rfunao0955@gmail.com へメール通知）。追加の手動設定は不要。

### Google Cloud（Places/Maps、手動設定が必要）
Places・MapsのAPI課金はAWSの外（Google Cloud）で発生するため、AWS Budgetsでは検知できない。

1. [Google Cloud Console → お支払い → 予算とアラート](https://console.cloud.google.com/billing/budgets) を開く
2. 「予算を作成」→ 対象プロジェクト（Places/Maps APIキーを発行したプロジェクト）を選択
3. 予算額を設定（例: 月$10〜20程度）
4. しきい値（50%/90%/100%など）でメール通知を設定

> 釣行AIアプリと同じGCPプロジェクトを使い回す場合、既存の予算アラートに本アプリの
> 利用分も合算されることになる点に注意（プロジェクトを分けない限り分離はできない）。

### Anthropic（Claude、手動設定が必要）
Claude APIの課金もAWS/Google Cloudいずれの外（Anthropic）で発生するため、同様に別途設定が必要。
釣行AIアプリと同じAnthropicクレジット残高・組織を共有する場合は、Anthropic Console上の
支出上限も両アプリ合算で管理されることになる。

1. [Anthropic Console → Settings → Billing](https://console.anthropic.com/settings/billing) を開く
2. 「Set spend limit」で月あたりの上限額を設定（例: 月$5〜10程度）
3. 上限に達すると自動的にAPIリクエストが拒否されるようになる
   （このアプリ側は「APIキー未設定時」と同じフォールバック文言を返すため、Lambda自体はエラーにならない）

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| AI ボタンを押しても何も起きない | `VITE_API_BASE_URL` が未設定、または古いAPIエンドポイントを指している | GitHub Secrets とフロントの `.env` を確認して再デプロイ |
| AIコメントが毎回同じ定型文になる | Claude API キーが読めていない、またはモデル名が廃止されている | SSMパラメータ名の先頭スラッシュ有無を確認（上記1参照）。CloudWatch Logs の `generateStudioScoreBatch` で `SSM get_parameter error` や `Claude API error` が出ていないか確認 |
| 地図が表示されない | `VITE_GOOGLE_MAPS_KEY` が無効、または未設定 | Google Cloud Console で Maps JavaScript API を有効化し、`frontend/.env`（ローカル開発時）にも設定する |
| スタジオが表示されない | まだ「AI分析を実行」が一度も実行されていない | 上記「4. 初期データについて」参照。ボタンを押して探索・スコア計算を実行する |
| Lambda がエラー | Claude API キーが未設定・無効 | 手順1の SSM パラメータを確認 |
| 「新スタジオを探す」を押しても増えない | Google Places API キー未登録、または請求先アカウント未紐付け | 手順1の `/studio-search/google-places-api-key` を確認。CloudWatch Logs の `discoverStudiosBatch` で `Places API` のエラーが出ていないか確認 |
| 写真アップロードが失敗する | S3バケットのCORS設定漏れ、または署名付きURLの有効期限切れ（5分） | `UploadsBucket` の CORS 設定を確認。アップロードは選択直後に行うため通常は期限切れにならない |
| 投稿が反映されない | `POST /posts` の失敗、または一覧の再取得漏れ | ブラウザの開発者ツールでAPIレスポンスを確認。ページ再読み込みで反映されるか確認 |
| AI相談が「回答の生成に失敗しました」を返す | Claude API呼び出しがエラー、または `PostChatFunction` の25秒Timeoutを超過 | CloudWatch Logs の `postChatHandler` で `Claude chat error` を確認。画像添付時は特に時間がかかりやすい |
| 「ホーム画面に追加」が出てこない | HTTPS配信でない、またはmanifest/Service Workerが読み込めていない | 本番URLでアクセスしているか確認。ブラウザの開発者ツール→Application タブで `manifest.webmanifest` と `sw.js` が正しく読めているか確認 |
| 画像アップロードで「画像サイズが大きすぎます」と出る | ファイルが8MB（`MAX_UPLOAD_BYTES`）を超えている | 写真を圧縮するか小さいサイズで撮り直す |
| `pytest` が実AWSにアクセスしようとする（`UnrecognizedClientException`等） | `moto`のモックが有効化される前に対象モジュール（handlers.py等）がimportされ、モジュール内のboto3クライアントがモック非対応のまま生成された | `test_handlers_moto.py` の `dynamodb_tables` フィクスチャのように、`mock_aws()` を開始した後に `importlib.reload()` でモジュールを再読み込みしてからテストすること |
| ログインボタンを押してもエラーになる／リダイレクトされない | `VITE_COGNITO_USER_POOL_ID`/`VITE_COGNITO_CLIENT_ID`/`VITE_COGNITO_DOMAIN` が未設定、またはビルド後にSecrets設定した場合の再ビルド忘れ | 上記「9.3 デプロイ」参照。3つとも設定してから再ビルド（再push）する |
| Googleログイン後に `redirect_mismatch` エラーになる | Google Cloud ConsoleのOAuthクライアントの承認済みリダイレクトURIが実際のCognitoドメインと不一致 | 上記「9.1」の手順でURIを再確認（`/oauth2/idpresponse` を忘れていないか、末尾スラッシュや大文字小文字の違いがないか） |
| お気に入り・投稿・AI相談を使おうとすると常にログイン画面に飛ばされる | 想定どおりの動作（これらはログイン必須の操作） | ナビ右上の「ログイン」からGoogleアカウントでログインする |
| AI相談が「本日の利用回数の上限に達しました」を返す | Claude APIコスト管理のための1日あたりレート制限（`DAILY_CHAT_LIMIT`）に達した | 想定どおりの動作。翌日には自動でリセットされる |
| 「AI分析を実行」「現在地から新スタジオを探す」が「本日の利用回数（n件）に達しました」を返す | Places/Claude APIコスト保護のための1日あたりレート制限に達した | 想定どおりの動作。翌日には自動でリセットされる。上限値は`template.yaml`の`RATE_LIMIT_DAILY`で調整できる |
| 投稿の編集ボタンが表示されない | 自分の投稿ではない（他人の投稿には表示されない仕様） | 想定どおりの動作。自分の投稿のみ編集・削除ボタンが表示される |
| 投稿を編集しようとすると失敗する | 他人の投稿を編集しようとした（backend側の所有者チェックで403） | 通常UI上は自分の投稿にしか編集ボタンが出ないため発生しないはずだが、発生する場合はログイン中のアカウントを確認 |
