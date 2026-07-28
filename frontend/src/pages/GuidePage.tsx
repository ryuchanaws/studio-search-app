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
    desc: "アプリを開いて最初に表示される画面。AIが計算したスコア順にスタジオが並びます。",
    features: [
      {
        title: "AI分析を実行",
        body: "口コミ評価・人気度など最新の条件でスコアを計算し直します。あわせて新しいスタジオも探索するので、完了まで1分前後かかることがあります。",
      },
      {
        title: "現在地から新スタジオを探す",
        body: "位置情報を許可すると、今いる場所の近く（半径15km）で新しいスタジオを探します。見つかったスタジオは「スタジオ」画面にすぐ反映されます（おすすめへの反映は次回のAI分析後）。",
      },
      {
        title: "現在地アイコン（右上）",
        body: "今いる場所からの距離で、表示中のおすすめを並べ替えます。メインのランキングとは別枠の参考表示です。",
      },
      {
        title: "カードをタップ",
        body: "AIコメントの全文、評価・人気度スコア、ナビ起動、お気に入り登録、スタジオ写真の設定、レビュー一覧へのリンクを開けます。",
      },
      {
        title: "スタジオ名を長押し（PCはホバー）",
        body: "写真をその場でプレビューできます。",
      },
    ],
  },
  {
    num: "02",
    name: "地図",
    desc: "登録されているスタジオをGoogleマップ上にピン留め表示します。",
    features: [
      { title: "ピンの色", body: "スコアが高いほど緑、低いほど赤に近づきます。データが無いスタジオはグレーです。" },
      { title: "ピンをタップ", body: "スコアや設備を確認し、そのままGoogleマップでナビを開始できます。" },
    ],
  },
  {
    num: "03",
    name: "スタジオ",
    desc: "登録されている全てのスタジオを一覧で確認できます。",
    features: [
      { title: "一覧とスコア", body: "左端のバーの色でスコアの高さがひと目でわかります。ナビボタンからそのまま経路案内へ。" },
      { title: "キーワード・設備で絞り込み", body: "スタジオ名や住所での検索、設備タグでの絞り込みができます。" },
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
    num: "06",
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
  { q: "おすすめが1件も出てきません", a: "まだAI分析が一度も実行されていない可能性があります。「おすすめ」画面の「AI分析を実行」を押してみてください。" },
  { q: "「AI分析を実行」を押しても反応が遅い", a: "新しいスタジオの探索とスコア計算をまとめて行っているため、1分前後かかるのが通常です。しばらく待ってから「更新」ボタンを押してみてください。" },
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
