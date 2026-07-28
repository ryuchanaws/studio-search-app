/**
 * @fileoverview アプリケーションのルートコンポーネント。
 *
 * ルーティング設定とレイアウト構造を定義する。
 * NavBar を固定ヘッダーとして表示し、
 * メインコンテンツエリアに各ページをルーティングする。
 */

import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "react-oidc-context";
import { oidcConfig } from "./auth/authConfig";
import { AuthTokenSync } from "./auth/AuthTokenSync";
import { NavBar } from "./components/NavBar";
import { TopPage } from "./pages/TopPage";
import { MapPage } from "./pages/MapPage";
import { StudiosPage } from "./pages/StudiosPage";
import { FavoritesPage } from "./pages/FavoritesPage";
import { PostsPage } from "./pages/PostsPage";
import { ChatPage } from "./pages/ChatPage";
import { GuidePage } from "./pages/GuidePage";
import "./styles.css";

/**
 * ルートコンポーネント。
 *
 * - AuthProvider（react-oidc-context）でCognito Hosted UI（Google認証）の
 *   ログイン状態をアプリ全体に提供する。閲覧系ページは未ログインでも表示できるが、
 *   お気に入り・投稿・AI相談・AI分析実行などの操作はログイン必須（各コンポーネント側でガードする）
 * - BrowserRouter で SPA ルーティングを有効化する
 * - NavBar を全ページ共通のナビゲーションバーとして表示する
 * - Routes で URL パスと各ページコンポーネントを対応づける
 *
 * @returns {JSX.Element} アプリケーション全体のレイアウト
 */
export default function App() {
  return (
    <AuthProvider {...oidcConfig}>
      {/* ログイン状態が変わるたびにAPIクライアントのAuthorizationヘッダーを同期する */}
      <AuthTokenSync />
      <BrowserRouter>
        <div className="app-layout">
          {/* 全ページ共通の固定ナビゲーションバー */}
          <NavBar />
          <main className="main-content">
            <Routes>
              {/* / : おすすめTOP3・AI実行ボタン */}
              <Route path="/" element={<TopPage />} />
              {/* /map : Google Maps スタジオ地図 */}
              <Route path="/map" element={<MapPage />} />
              {/* /studios : スタジオ一覧リスト */}
              <Route path="/studios" element={<StudiosPage />} />
              {/* /favorites : お気に入りスタジオ一覧 */}
              <Route path="/favorites" element={<FavoritesPage />} />
              {/* /posts : レビュー投稿一覧・投稿作成 */}
              <Route path="/posts" element={<PostsPage />} />
              {/* /chat : AIチャット（スタジオ選びの相談） */}
              <Route path="/chat" element={<ChatPage />} />
              {/* /guide : 使い方ガイド */}
              <Route path="/guide" element={<GuidePage />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
