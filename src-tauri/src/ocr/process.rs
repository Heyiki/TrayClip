use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use anyhow::{bail, Context};
use super::protocol::{self, Request};

struct Reap(Child);

impl Drop for Reap {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub fn run_engine(path: &Path, request: &Request) -> anyhow::Result<String> {
    if !path.is_absolute() { bail!("OCR engine path must be absolute"); }
    let input = serde_json::to_vec(request)?;
    if input.len() > 64 * 1024 { bail!("OCR request exceeds size limit"); }
    let mut command = Command::new(path);
    command.current_dir(path.parent().context("Missing OCR engine directory")?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    exchange(command, &input, Duration::from_secs(120), 4 * 1024 * 1024, 64 * 1024)
}

fn read_pipe(mut pipe: impl Read, limit: u64) -> anyhow::Result<Vec<u8>> {
    let mut output = Vec::new();
    (&mut pipe).take(limit + 1).read_to_end(&mut output)?;
    if output.len() as u64 > limit { bail!("OCR engine output exceeds size limit"); }
    Ok(output)
}

fn exchange(mut command: Command, input: &[u8], timeout: Duration, stdout_limit: u64, stderr_limit: u64) -> anyhow::Result<String> {
    enum Message {
        Input(std::io::Result<()>),
        Output(anyhow::Result<Vec<u8>>),
        Error(anyhow::Result<Vec<u8>>),
    }
    std::thread::scope(|scope| {
        let mut child = Reap(command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().context("Cannot start OCR engine")?);
        let mut stdin = child.0.stdin.take().context("Cannot open OCR stdin")?;
        let stdout = child.0.stdout.take().context("Cannot open OCR stdout")?;
        let stderr = child.0.stderr.take().context("Cannot open OCR stderr")?;
        let (sender, receiver) = mpsc::channel();
        let writer = sender.clone();
        scope.spawn(move || { let _ = writer.send(Message::Input(stdin.write_all(input))); });
        let reader = sender.clone();
        scope.spawn(move || { let _ = reader.send(Message::Output(read_pipe(stdout, stdout_limit))); });
        scope.spawn(move || { let _ = sender.send(Message::Error(read_pipe(stderr, stderr_limit))); });
        let started = Instant::now();
        let mut output: Option<Vec<u8>> = None;
        let mut error: Option<Vec<u8>> = None;
        let mut input_done = false;
        loop {
            if started.elapsed() >= timeout { bail!("OCR engine timed out"); }
            let status = child.0.try_wait()?;
            if let Some(status) = status {
                if !status.success() { bail!("OCR engine exited with {status}"); }
                if input_done && output.is_some() && error.is_some() {
                    return protocol::parse_response(&output.unwrap());
                }
            }
            match receiver.recv_timeout(Duration::from_millis(10)) {
                Ok(Message::Input(result)) => { result.context("Cannot send OCR request")?; input_done = true; }
                Ok(Message::Output(result)) => output = Some(result?),
                Ok(Message::Error(result)) => error = Some(result?),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => std::thread::sleep(Duration::from_millis(10)),
            }
        }
        // Reap kills/waits before the scoped readers are joined on every return.
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::OnceLock;

    fn fixture() -> &'static std::path::Path {
        static FIXTURE: OnceLock<(tempfile::TempDir, std::path::PathBuf)> = OnceLock::new();
        &FIXTURE.get_or_init(|| {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join(if cfg!(windows) { "fixture.exe" } else { "fixture" });
            let status = std::process::Command::new("rustc")
                .arg(concat!(env!("CARGO_MANIFEST_DIR"), "/../scripts/ocr/process-fixture.rs"))
                .arg("-o").arg(&path).status().unwrap();
            assert!(status.success());
            (dir, path)
        }).1
    }

    fn run(mode: &str, timeout: std::time::Duration) -> anyhow::Result<String> {
        let mut command = std::process::Command::new(fixture());
        command.arg(mode);
        exchange(command, b"{}", timeout, 1024, 1024)
    }

    #[test]
    fn accepts_one_valid_response_and_rejects_exit_json_and_protocol_errors() {
        assert_eq!(run("ok", std::time::Duration::from_secs(10)).unwrap(), "hello");
        for mode in ["exit", "json", "protocol", "stdout", "stderr"] {
            assert!(run(mode, std::time::Duration::from_secs(10)).is_err(), "{mode}");
        }
    }

    #[test]
    fn terminates_and_reaps_timed_out_process() {
        let _ = fixture();
        let started = std::time::Instant::now();
        assert!(run("sleep", std::time::Duration::from_millis(200))
            .unwrap_err().to_string().contains("timed out"));
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
    }
}
