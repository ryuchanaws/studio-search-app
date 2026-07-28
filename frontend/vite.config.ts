// vite.config.ts
// Vite のビルド・開発サーバー設定。
// React プラグインを有効化し、本番ビルドの出力先を指定する。

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "レンタルスタジオサーチ",
        short_name: "スタジオサーチ",
        description: "AIがダンス・ヨガスタジオ選びをサポートするアプリ",
        lang: "ja",
        theme_color: "#a855f7",
        background_color: "#0f1117",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // SPAルーティング（/map, /studios等）のオフライン時フォールバック先
        navigateFallback: "index.html",
      },
    }),
  ],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
