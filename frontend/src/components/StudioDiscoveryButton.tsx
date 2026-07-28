/**
 * @fileoverview 現在地周辺の新規スタジオ探索バッチを手動実行するボタンコンポーネント。
 *
 * 全国向けの探索は「AI分析を実行」のたびに自動で行われるため、
 * このボタンはユーザーの現在地に絞った探索専用。
 * 現在地取得 → discoverStudiosBatch起動 の2段階になるため、
 * AiBatchButton と違い先に位置情報の許可が必要になる。
 * 発見結果はすぐには反映されないため、AiBatchButtonのような
 * 完了ポーリングは行わず、起動受付のみを案内する。
 */

import { useState } from "react";
import axios from "axios";
import { useAuth } from "react-oidc-context";
import { LocateFixed, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { runStudioDiscovery } from "../api/client";

/** ボタンの実行状態 */
type Status = "idle" | "locating" | "running" | "done" | "error" | "denied";

/**
 * 現在地から新規スタジオを探索するボタンコンポーネント。
 *
 * クリックで現在地を取得し、取得できたら
 * POST /admin/run-studio-discovery を { lat, lng } 付きで起動する。
 * 起動を受け付けた時点で完了扱いとする（バッチ自体の完了は待たない）。
 *
 * @returns {JSX.Element} 現在地から探すボタンと結果メッセージ
 */
export const StudioDiscoveryButton = () => {
  const auth = useAuth();
  const [status, setStatus] = useState<Status>("idle");
  /** エラー時の詳細メッセージ（レート制限時はサーバーからの案内文を表示する） */
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * 現在地を取得し、取得できたらバッチ起動をリクエストする。
   * /admin/run-studio-discovery はCognito認証必須のため、未ログイン時はログイン画面へ誘導する。
   */
  const handleRun = () => {
    if (!auth.isAuthenticated) {
      auth.signinRedirect();
      return;
    }

    setStatus("locating");
    setErrorMessage(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setStatus("running");
        try {
          await runStudioDiscovery({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setStatus("done");
        } catch (err) {
          if (axios.isAxiosError(err) && err.response?.status === 429) {
            // 1日あたりの探索回数上限（コスト保護）
            setErrorMessage(err.response.data?.message ?? "本日の利用上限に達しました");
          } else {
            setErrorMessage(null);
          }
          setStatus("error");
        }
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  };

  const isBusy = status === "locating" || status === "running";

  return (
    <div className="ai-batch-wrapper">
      <button
        className={`ai-batch-btn ${isBusy ? "running" : ""}`}
        onClick={handleRun}
        disabled={isBusy}
        aria-label="現在地から新しいスタジオを探す"
      >
        {isBusy ? (
          <>
            <Loader2 size={18} className="spin" />
            <span>{status === "locating" ? "現在地を取得中..." : "探索中..."}</span>
          </>
        ) : (
          <>
            <LocateFixed size={18} />
            <span>現在地から新スタジオを探す</span>
          </>
        )}
      </button>

      {status === "done" && (
        <div className="batch-status success">
          <CheckCircle2 size={14} />
          <span>探索を開始しました。数分後にスタジオ一覧を確認してください</span>
        </div>
      )}

      {status === "denied" && (
        <div className="batch-status error">
          <AlertCircle size={14} />
          <span>位置情報の利用が許可されていません</span>
        </div>
      )}

      {status === "error" && (
        <div className="batch-status error">
          <AlertCircle size={14} />
          <span>{errorMessage ?? "探索の起動に失敗しました"}</span>
        </div>
      )}
    </div>
  );
};
