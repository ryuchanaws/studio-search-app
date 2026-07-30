/**
 * @fileoverview スタジオ地図画面。
 *
 * Google Maps 上に全スタジオをマーカーで表示する。
 * マーカーの色はブランド（BUZZ / worcle / NOAH / スタジオミッション）に応じて変化し、
 * タップするとスタジオ名・ブランド・住所・ナビボタンを含む InfoWindow を表示する。
 */

import { useState, useEffect } from "react";
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow } from "@vis.gl/react-google-maps";
import { getStudios } from "../api/client";
import type { Studio } from "../types";
import { BRAND_LABELS, BRAND_COLORS } from "../utils/brand";
import { Navigation2 } from "lucide-react";

/** Google Maps API キー（環境変数から取得。未設定の場合は空文字） */
const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY ?? "";

/** 地図の初期表示中心座標（東京駅付近） */
const DEFAULT_CENTER = { lat: 35.6812, lng: 139.7671 };

/**
 * スタジオ地図ページコンポーネント。
 *
 * - マウント時に studios を取得して地図に反映する
 * - ブランドに応じてマーカーの色を変える
 * - マーカークリックで InfoWindow を表示し、ナビボタンから Google Maps に遷移できる
 *
 * @returns {JSX.Element} スタジオ地図画面
 */
export const MapPage = () => {
  const [studios, setStudios] = useState<Studio[]>([]);
  const [selected, setSelected] = useState<Studio | null>(null);

  useEffect(() => {
    getStudios().then(setStudios);
  }, []);

  /**
   * 指定スタジオへの Google Maps ナビゲーションを新しいタブで開く。
   *
   * @param {Studio} studio - ナビ先のスタジオ
   */
  const openNav = (studio: Studio) => {
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${studio.lat},${studio.lng}`,
      "_blank"
    );
  };

  return (
    <div className="page map-page">
      <div className="page-header">
        <h1 className="page-title">スタジオ地図</h1>
        <p className="page-sub">マーカーをタップして詳細を確認</p>
      </div>

      <div className="map-container">
        <APIProvider apiKey={MAPS_KEY}>
          <Map
            defaultCenter={DEFAULT_CENTER}
            defaultZoom={10}
            mapId="studio-map"
            style={{ width: "100%", height: "100%" }}
          >
            {studios.map((studio) => {
              const color = studio.brand ? BRAND_COLORS[studio.brand] : "#6b7280";
              return (
                <AdvancedMarker
                  key={studio.studioId}
                  position={{ lat: studio.lat, lng: studio.lng }}
                  onClick={() => setSelected(studio)}
                >
                  <Pin background={color} borderColor="#fff" glyphColor="#fff" />
                </AdvancedMarker>
              );
            })}

            {selected && (
              <InfoWindow
                position={{ lat: selected.lat, lng: selected.lng }}
                onCloseClick={() => setSelected(null)}
              >
                <div className="map-info">
                  <strong>{selected.name}</strong>
                  {selected.brand && (
                    <p className="map-info-score">{BRAND_LABELS[selected.brand]}</p>
                  )}
                  {(selected.address ?? selected.description) && (
                    <p className="map-info-fish">{selected.address ?? selected.description}</p>
                  )}
                  <button className="map-nav-btn" onClick={() => openNav(selected)}>
                    <Navigation2 size={13} /> ナビ開始
                  </button>
                </div>
              </InfoWindow>
            )}
          </Map>
        </APIProvider>
      </div>
    </div>
  );
};
