/**
 * @fileoverview AI バッチ処理を手動実行するボタンコンポーネント。
 *
 * クリックで generateStudioScoreBatch Lambda を起動し、
 * 実行状態に応じてボタンのラベル・スピナー・結果メッセージを切り替える。
 */

import { Zap, Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import type { BatchStatus } from "../types";

/**
 * AiBatchButton コンポーネントの Props。
 */
interface AiBatchButtonProps {
  /** バッチ処理の現在の実行状態 */
  status: BatchStatus;
  /** ボタンクリック時に呼び出すバッチ実行関数 */
  onRun: () => void;
}

/**
 * AI バッチ実行ボタンコンポーネント。
 *
 * - 実行中はスピナーを表示してボタンを無効化する
 * - 完了時は緑色の成功メッセージを表示する
 * - 失敗時は赤色のエラーメッセージを表示する
 * - タイムアウト時（ポーリング時間内に完了を確認できなかった場合）はオレンジ色の中立的なメッセージを表示する
 *
 * @param {AiBatchButtonProps} props
 * @returns {JSX.Element} AI実行ボタンと実行結果メッセージ
 */
export const AiBatchButton = ({ status, onRun }: AiBatchButtonProps) => {
  const isRunning = status.status === "running";

  return (
    <div className="ai-batch-wrapper">
      <button
        className={`ai-batch-btn ${isRunning ? "running" : ""}`}
        onClick={onRun}
        disabled={isRunning}
        aria-label="AI分析を実行"
      >
        {isRunning ? (
          <>
            <Loader2 size={18} className="spin" />
            <span>AI分析中...</span>
          </>
        ) : (
          <>
            <Zap size={18} />
            <span>AI分析を実行</span>
          </>
        )}
      </button>

      {status.status === "completed" && (
        <div className="batch-status success">
          <CheckCircle2 size={14} />
          <span>分析完了 — おすすめを更新しました</span>
        </div>
      )}

      {status.status === "failed" && (
        <div className="batch-status error">
          <AlertCircle size={14} />
          <span>{status.message ?? "エラーが発生しました"}</span>
        </div>
      )}

      {status.status === "timeout" && (
        <div className="batch-status pending">
          <Clock size={14} />
          <span>{status.message ?? "処理状況を確認できませんでした"}</span>
        </div>
      )}
    </div>
  );
};
