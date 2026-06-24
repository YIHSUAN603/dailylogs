use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// 以子行程呼叫設定好的 AI CLI，prompt 經 stdin 傳入，回傳 stdout。
///
/// `command_template` 例：`claude -p`、`codex exec`、或含空白的完整路徑
/// `"/home/aries/my tools/claude" -p`。以 shell 語法解析（支援引號），不經 shell 執行，避免注入。
/// `timeout_secs` 為子行程逾時秒數，超過即強制終止並回傳逾時錯誤。
pub fn run_ai(command_template: &str, prompt: &str, timeout_secs: u64) -> Result<String, String> {
    let parts = shell_words::split(command_template)
        .map_err(|e| format!("AI 命令格式錯誤（引號未配對？）：{}", e))?;
    let (program, args) = parts
        .split_first()
        .ok_or_else(|| "尚未設定 AI 命令（請到設定頁填入，例如 claude -p）".to_string())?;

    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Windows：避免每次呼叫 CLI 都彈出 console 視窗（CREATE_NO_WINDOW）
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "無法執行 '{}'：{}（請確認已安裝，或在設定頁填入完整路徑）",
            program, e
        )
    })?;

    // 寫入 prompt 後關閉 stdin（drop），讓 CLI 收到 EOF 開始處理
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "無法寫入 AI 程序的輸入".to_string())?;
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|e| format!("寫入 AI 輸入失敗：{}", e))?;
    }

    // 另開執行緒讀 stdout/stderr 到 EOF，避免 pipe buffer 填滿導致死鎖
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "無法讀取 AI 輸出".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "無法讀取 AI 錯誤輸出".to_string())?;
    let out_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let err_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        buf
    });

    // 輪詢等待結束，超過逾時則強制終止
    let timeout = Duration::from_secs(timeout_secs);
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("AI 執行逾時（超過 {} 秒），已終止", timeout_secs));
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("等待 AI 程序失敗：{}", e)),
        }
    };

    let out = out_handle.join().unwrap_or_default();
    let err = err_handle.join().unwrap_or_default();

    if !status.success() {
        return Err(format!(
            "AI 執行失敗：{}",
            String::from_utf8_lossy(&err).trim()
        ));
    }

    Ok(String::from_utf8_lossy(&out).trim().to_string())
}
