/**
 * @fileoverview アプリケーションのエントリーポイント。
 *
 * React DOM を初期化し、index.html の #root 要素に
 * App コンポーネントをマウントする。
 * StrictMode を有効化して開発時の潜在的な問題を検出する。
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
