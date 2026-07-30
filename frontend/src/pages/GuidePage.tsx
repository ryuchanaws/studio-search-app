/**
 * @fileoverview 使い方ガイド画面。
 *
 * アプリ内から直接、各画面の使い方・ホーム画面への追加方法・よくある質問を確認できる。
 * 友人に共有する際もこのページのURL（/guide）を案内すればよい。
 */

import { Compass } from "lucide-react";

/** 1画面ぶんの使い方セクションのデータ構造 */
interface GuideFeature {
  title: string;
  body: string;
}

interface GuideScreen {
  num: string;
  name: string;
  desc: string;
  features: GuideFeature[];
}

/** 画面ごとの使い方一覧（実装内容に合わせて記述） */
const SCREENS: GuideScreen[] = [
  {
    num: "01",
    name: "おすすめ",
    desc: "アプリを開いて最初に表示される画面。BUZZ・worcle・NOAH・スタジオミッションの4ブランドのスタジオが一覧表示されます。",
    features: [
      {
        title: "空き状況を見る",
        body: "各スタジオカードのボタンから、日付を指定して部屋ごとの広さ・30分刻みの空き状況を確認できます。まだデータを取得していないブランド・日付は「データがまだありません」と表示されます。",
      },
      {
        title: "ブランド・エリア・広さで絞り込み",
        body: "上部のチップからブランド、都道府県（住所ベース）、部屋の最大広さ（〜15㎡/15〜30㎡/30㎡〜）で絞り込めます。",
      },
      {
        title: "現在地から探す",
        body: "位置情報を許可すると、今いる場所の近く（半径15km）で対象4ブランドの新しい店舗をGoogle Places APIで探索します。見つかった店舗は「スタジオ」画面に反映されます。",
      },
      {
        title: "カードをタップ",
        body: "住所、部屋一覧（広さ・写真・平面図・設備・この部屋を公式サイトで見るリンク）、公式サイトへの予約ボタン、ナビ起動、お気に入り登録を開けます。",
      },
    ],
  },
  {
    num: "02",
    name: "地図",
    desc: "登録されているスタジオをGoogleマップ上にピン留め表示します。",
    features: [
      { title: "ピンの色", body: "ブランドごとに色分けされています（凡例は画面内に表示）。" },
      { title: "ピンをタップ", body: "スタジオの詳細を確認し、そのままGoogleマップでナビを開始できます。" },
    ],
  },
  {
    num: "03",
    name: "スタジオ",
    desc: "4ブランドの全スタジオ・全部屋を、広さで比較できる一覧表です。",
    features: [
      { title: "部屋ごとの広さ比較", body: "スタジオ内の各部屋の広さ（㎡）・料金目安を横断的に比較できます。" },
      { title: "ブランド・広さで絞り込み", body: "チップから絞り込みができます。" },
    ],
  },
  {
    num: "04",
    name: "保存済み",
    desc: "ハートマークで保存したスタジオだけを集めた画面です。行きたい場所のメモ代わりに。",
    features: [],
  },
  {
    num: "05",
    name: "イベント",
    desc: "次のイベントのステージ実寸・出演人数を登録しておくと、目的・日付・大体の時間を指定するだけで条件に合うスタジオを探せます（ログイン必須）。",
    features: [
      {
        title: "イベントを登録（右上の＋）",
        body: "イベント名、ステージの横幅・奥行き（メートル）、出演人数を入力して登録します。複数件登録・管理できます。",
      },
      {
        title: "目的・日付・時間を指定",
        body: "「振り入れ」（新しい振付を覚える段階、広さの余裕を重視）または「構成」（隊形確認、やや小さめの部屋でも可）を選び、日付・大体の開始時刻・利用時間を指定します。",
      },
      {
        title: "おすすめを探す",
        body: "出演人数に対して十分な広さがあり、かつ指定した時間帯すべてが空いている部屋だけを一覧表示します。カードをタップすると詳細・公式サイトへの予約リンクを確認できます。",
      },
    ],
  },
  {
    num: "06",
    name: "レビュー",
    desc: "利用したスタジオの感想を★評価つきでシェアする画面です。",
    features: [
      {
        title: "投稿する（右上の＋）",
        body: "スタジオを選び、★評価と本文を入力。写真はアルバムから選ぶか、その場で撮影して添付できます。",
      },
      { title: "編集・削除", body: "自分の投稿にのみ編集・削除ボタンが表示されます（削除は確認あり、元には戻せません）。" },
    ],
  },
  {
    num: "07",
    name: "AI相談",
    desc: "「初心者でも通える？」「このスタジオの雰囲気は？」など、スタジオ選びに関する質問をAIに直接聞けます。",
    features: [
      {
        title: "写真つきで質問",
        body: "入力欄の写真アイコンから、アルバム選択・その場で撮影のどちらかで画像を添付できます。",
      },
      {
        title: "送信済みメッセージの編集",
        body: "自分の発言に表示される鉛筆アイコンから本文を訂正して再送信でき、AIの回答も作り直されます。",
      },
      {
        title: "新しい会話 / 履歴",
        body: "「＋」で会話をリセットして質問し直せます。「履歴」から過去の会話を開いたり削除したりできます。",
      },
    ],
  },
];

/** ホーム画面への追加手順（プラットフォーム別） */
const INSTALL_STEPS = [
  { platform: "Android / Chrome", steps: ["アプリのURLをChromeで開く", "右上の「⋮」メニューをタップ", "「アプリをインストール」を選択"] },
  { platform: "iPhone / Safari", steps: ["アプリのURLをSafariで開く（Chromeでは追加できません）", "下部の共有アイコンをタップ", "「ホーム画面に追加」を選択"] },
  { platform: "PC / Chrome・Edge", steps: ["アプリのURLを開く", "アドレスバー右側のインストールアイコンをクリック", "「インストール」を選択"] },
];

/** よくある質問 */
const FAQS = [
  { q: "「空き状況を見る」で日付を変えても「データがまだありません」と出ます", a: "空き状況データはローカルのスクレイピングスクリプトで定期的に取得しています。まだ取得していない日付・ブランド（特にworcle/NOAH/スタジオミッションの一部店舗）では表示できません。しばらく経ってから再度確認してください。" },
  { q: "イベント機能が使えません", a: "イベント登録・おすすめ表示にはログインが必要です。「イベント」画面右上の案内からログインしてください。" },
  { q: "おすすめを探しても0件でした", a: "出演人数に対して十分な広さの部屋が無い、または指定した時間帯に空きがない可能性があります。目的（振り入れ/構成）や利用時間、時間帯を変えて再度お試しください。" },
  { q: "写真がアップロードできません", a: "1枚あたり8MBまでという上限があります。大きすぎる場合は撮り直すか、圧縮してから試してください。" },
  { q: "現在地の機能が使えません", a: "ブラウザの位置情報の許可が必要です。設定でこのサイトの位置情報アクセスを許可してから、もう一度お試しください。" },
];

/**
 * 使い方ガイド画面コンポーネント。
 *
 * @returns {JSX.Element} 使い方ガイド画面
 */
export const GuidePage = () => {
  return (
    <div className="page guide-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Compass size={22} style={{ verticalAlign: "-4px", marginRight: 6, color: "var(--accent)" }} />
            使い方ガイド
          </h1>
          <p className="page-sub">各画面でできることをまとめています</p>
        </div>
      </div>

      {SCREENS.map((screen) => (
        <section key={screen.num} className="guide-section">
          <div className="guide-section-head">
            <span className="guide-num">{screen.num}</span>
            <h2 className="guide-heading">{screen.name}</h2>
          </div>
          <p className="guide-desc">{screen.desc}</p>
          {screen.features.length > 0 && (
            <ul className="guide-feature-list">
              {screen.features.map((f) => (
                <li key={f.title} className="guide-feature">
                  <div className="guide-feature-mark" />
                  <div>
                    <b>{f.title}</b>
                    <span>{f.body}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className="guide-section">
        <div className="guide-section-head">
          <span className="guide-num">＋</span>
          <h2 className="guide-heading">ホーム画面に追加する</h2>
        </div>
        <p className="guide-desc">
          ブラウザのアプリとしてホーム画面に置けます。次回からアイコンをタップするだけで開けて便利です。
        </p>
        <div className="guide-install-grid">
          {INSTALL_STEPS.map((p) => (
            <div key={p.platform} className="guide-install-card">
              <h3>{p.platform}</h3>
              <ol>
                {p.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <section className="guide-section" style={{ borderBottom: "none" }}>
        <div className="guide-section-head">
          <span className="guide-num">？</span>
          <h2 className="guide-heading">よくある質問</h2>
        </div>
        {FAQS.map((item) => (
          <div key={item.q} className="guide-faq-item">
            <p className="guide-faq-q">{item.q}</p>
            <p className="guide-faq-a">{item.a}</p>
          </div>
        ))}
      </section>
    </div>
  );
};
