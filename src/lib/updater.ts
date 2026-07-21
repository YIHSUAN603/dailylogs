/** 自動更新：檢查 GitHub Release 的新版本，詢問後下載安裝並重啟 */
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";
import { toast, toastError } from "./toast";

let checking = false;

/**
 * 檢查更新。silent 模式（啟動時背景檢查）：無更新或失敗都安靜返回；
 * 手動模式（設定頁按鈕）：無更新 toast 提示、失敗 toastError。
 */
export async function checkForUpdates({ silent }: { silent: boolean }): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const update = await check();
    if (!update) {
      if (!silent) toast("已是最新版本");
      return;
    }

    const yes = await ask(
      `發現新版本 v${update.version}（目前 v${update.currentVersion}），要立即下載安裝嗎？\n安裝完成後會自動重新啟動。`,
      { title: "軟體更新", kind: "info", okLabel: "立即更新", cancelLabel: "稍後再說" },
    );
    if (!yes) return;

    toast("開始下載更新…");
    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    if (silent) {
      console.warn("背景檢查更新失敗：", e);
    } else {
      toastError(`檢查更新失敗：${e}`);
    }
  } finally {
    checking = false;
  }
}
