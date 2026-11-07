use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{bail, Context};
use parking_lot::Mutex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Manager, State};
use tauri::ipc::Channel;

use crate::{app_state::AppState, db, models::ClipContentType};

mod protocol;
mod engine;
mod process;

static OCR_JOB: Mutex<()> = Mutex::new(());
const MAX_MODEL_BYTES: u64 = 16 * 1024 * 1024;
use protocol::{Request, PROTOCOL, MAX_IMAGE_BYTES, MODEL_NAMES};

#[derive(Clone, Serialize)]
pub struct Progress {
    phase: &'static str,
    name: String,
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Serialize)]
pub struct OcrStatus {
    engine_available: bool,
    engine_ready: bool,
    models_ready: bool,
    engine_bytes: Option<u64>,
    missing_models: usize,
    missing_model_bytes: u64,
    engine_version: Option<String>,
    engine_asset: Option<String>,
    engine_url: Option<String>,
}

struct Model {
    name: &'static str,
    size: u64,
    url: &'static str,
    sha256: &'static str,
}

// Official RapidOCR manifest, pinned to a model repository revision. Keep local
// names and hashes unchanged so previously downloaded models remain usable.
const MODELS: &[Model] = &[
    Model {
        name: MODEL_NAMES[0],
        size: 4_745_517,
        url: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv4/det/ch_PP-OCRv4_det_mobile.onnx?download=true",
        sha256: "d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9",
    },
    Model {
        name: MODEL_NAMES[1],
        size: 585_532,
        url: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_mobile.onnx?download=true",
        sha256: "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c",
    },
    Model {
        name: MODEL_NAMES[2],
        size: 10_857_958,
        url: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv4/rec/ch_PP-OCRv4_rec_mobile.onnx?download=true",
        sha256: "48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b",
    },
];

fn model_dir(state: &AppState) -> PathBuf {
    ocr_root(state).join("rapidocr-1.3.24")
}

fn ocr_root(state: &AppState) -> PathBuf {
    state.paths.images_dir.with_file_name("ocr")
}

fn select_image<'a>(
    kind: &str,
    image: Option<&'a str>,
    files: &'a [String],
    requested: Option<&str>,
) -> anyhow::Result<&'a str> {
    let candidate = match kind {
        "image" => image.filter(|image| requested.is_none_or(|path| path == *image)),
        "file_paths" => files.iter().find(|path| requested == Some(path.as_str())).map(String::as_str),
        _ => None,
    }.context("Image does not belong to this clipboard record")?;
    let extension = Path::new(candidate).extension().and_then(|ext| ext.to_str()).unwrap_or("");
    if !["png", "jpg", "jpeg", "bmp", "webp", "gif", "tif", "tiff"]
        .iter().any(|ext| extension.eq_ignore_ascii_case(ext)) {
        bail!("Unsupported OCR image format");
    }
    Ok(candidate)
}

fn models_ready(dir: &Path) -> bool {
    MODELS.iter().all(|model| engine::file_matches(&dir.join(model.name), model.size, model.sha256))
}

fn http_client() -> anyhow::Result<reqwest::blocking::Client> {
    Ok(reqwest::blocking::Client::builder()
        .user_agent(concat!("TrayClip/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .build()?)
}

fn install_models(dir: &Path, progress: &dyn Fn(Progress)) -> anyhow::Result<()> {
    std::fs::create_dir_all(dir).context("Cannot create OCR model directory")?;
    let client = http_client()?;
    for model in MODELS {
        let destination = dir.join(model.name);
        if engine::file_matches(&destination, model.size, model.sha256) { continue; }
        download_file(&client, model.url, &destination, model.sha256, MAX_MODEL_BYTES, "models", progress)
            .with_context(|| format!("Failed to download OCR model {}", model.name))?;
    }
    Ok(())
}

fn download_file(
    client: &reqwest::blocking::Client,
    url: &str,
    destination: &Path,
    sha256: &str,
    limit: u64,
    phase: &'static str,
    progress: &dyn Fn(Progress),
) -> anyhow::Result<()> {
    let mut response = client.get(url).send()?.error_for_status()?;
    if response.content_length().is_some_and(|length| length > limit) {
        bail!("OCR download exceeds size limit");
    }
    let mut staged = tempfile::NamedTempFile::new_in(destination.parent().context("Missing model directory")?)?;
    let total = response.content_length();
    let name = destination.file_name().context("Missing download filename")?.to_string_lossy().into_owned();
    let mut report = Progress { phase, name, downloaded: 0, total };
    progress(report.clone());
    let mut buffer = [0u8; 64 * 1024];
    let mut hash = Sha256::new();
    let mut last_report = std::time::Instant::now();
    loop {
        let count = response.read(&mut buffer)?;
        if count == 0 { break; }
        report.downloaded += count as u64;
        if report.downloaded > limit { bail!("OCR download exceeds size limit"); }
        staged.write_all(&buffer[..count])?;
        hash.update(&buffer[..count]);
        if last_report.elapsed() >= Duration::from_millis(100) {
            progress(report.clone());
            last_report = std::time::Instant::now();
        }
    }
    staged.flush()?;
    if format!("{:x}", hash.finalize()) != sha256 { bail!("OCR download failed SHA-256 verification"); }
    staged.persist(destination).map_err(|error| error.error)?;
    progress(report);
    Ok(())
}

fn status(root: &Path) -> OcrStatus {
    let dir = root.join("rapidocr-1.3.24");
    let missing_models: Vec<_> = MODELS.iter().filter(|model| !engine::file_matches(&dir.join(model.name), model.size, model.sha256)).collect();
    let missing = missing_models.len();
    let missing_bytes = missing_models.iter().map(|model| model.size).sum();
    match engine::manifest() {
        Ok(manifest) => OcrStatus {
            engine_available: true, engine_ready: engine::installed(&manifest.directory(root), &manifest),
            models_ready: missing == 0, engine_bytes: Some(manifest.archive_size),
            missing_models: missing, missing_model_bytes: missing_bytes, engine_version: Some(manifest.version.clone()),
            engine_asset: manifest.url.rsplit('/').next().map(str::to_owned),
            engine_url: Some(manifest.url),
        },
        Err(_) => OcrStatus {
            engine_available: false, engine_ready: false, models_ready: missing == 0,
            engine_bytes: None, missing_models: missing, missing_model_bytes: missing_bytes, engine_version: None, engine_asset: None,
            engine_url: None,
        },
    }
}

#[tauri::command]
pub async fn get_ocr_status(state: State<'_, AppState>) -> Result<OcrStatus, String> {
    let root = ocr_root(&state);
    tauri::async_runtime::spawn_blocking(move || status(&root))
        .await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn install_ocr(
    state: State<'_, AppState>,
    archive_path: Option<String>,
    on_progress: Channel<Progress>,
) -> Result<(), String> {
    let root = ocr_root(&state);
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<()> {
        let _job = OCR_JOB.try_lock().context("Another OCR request is running")?;
        let manifest = engine::manifest()?;
        std::fs::create_dir_all(&root)?;
        let report = |progress| { let _ = on_progress.send(progress); };
        if let Some(path) = archive_path {
            report(Progress { phase: "verifying", name: String::new(), downloaded: 0, total: None });
            engine::install_archive(&root, &manifest, Path::new(&path), env!("TRAYCLIP_TARGET"))?;
        } else if !engine::installed(&manifest.directory(&root), &manifest) {
            let temporary = tempfile::tempdir_in(&root)?;
            let archive = temporary.path().join("engine.zip");
            download_file(&http_client()?, &manifest.url, &archive, &manifest.archive_sha256,
                engine::MAX_ARCHIVE_BYTES, "engine", &report)?;
            report(Progress { phase: "verifying", name: String::new(), downloaded: 0, total: None });
            engine::install_archive(&root, &manifest, &archive, env!("TRAYCLIP_TARGET"))?;
        }
        install_models(&root.join("rapidocr-1.3.24"), &report)?;
        Ok(())
    }).await.map_err(|error| error.to_string())?.map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub async fn recognize_clip_image(
    app: tauri::AppHandle,
    clip_id: i64,
    image_path: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<String> {
        let _job = OCR_JOB.try_lock().context("Another OCR request is running")?;
        let state = app.state::<AppState>();
        let record = {
            let conn = state.pool.get()?;
            db::get_clip_by_id(&conn, clip_id)?
        };
        let kind = match record.content_type {
            ClipContentType::Image => "image",
            ClipContentType::FilePaths => "file_paths",
            _ => "",
        };
        let selected = select_image(kind, record.image_path.as_deref(), &record.file_paths, image_path.as_deref())?;
        let canonical = std::fs::canonicalize(selected).context("OCR image is unavailable")?;
        if kind == "image" && !canonical.starts_with(std::fs::canonicalize(&state.paths.images_dir)?) {
            bail!("Image is outside the managed image directory");
        }
        if std::fs::metadata(&canonical)?.len() > MAX_IMAGE_BYTES { bail!("OCR image exceeds 32 MiB"); }
        let manifest = engine::manifest()?;
        let directory = manifest.directory(&ocr_root(&state));
        if !engine::installed(&directory, &manifest) { bail!("OCR engine needs installation or repair"); }
        let models = model_dir(&state);
        if !models_ready(&models) { bail!("OCR models need installation or repair"); }
        process::run_engine(&std::fs::canonicalize(directory.join(&manifest.executable))?,
            &Request { protocol: PROTOCOL, image_path: canonical, model_dir: std::fs::canonicalize(models)? })
    }).await.map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model_server(body: &'static [u8]) -> (String, std::thread::JoinHandle<()>) {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/model", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            stream.read(&mut request).unwrap();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
            stream.write_all(body).unwrap();
        });
        (url, server)
    }

    #[test]
    fn downloads_and_atomically_replaces_a_corrupt_model() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.onnx");
        std::fs::write(&path, b"broken").unwrap();
        let (url, server) = model_server(b"abc");
        let client = reqwest::blocking::Client::builder().no_proxy().build().unwrap();
        download_file(&client, &url, &path, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", 3, "models", &|_| {}).unwrap();
        server.join().unwrap();
        assert_eq!(std::fs::read(path).unwrap(), b"abc");
    }

    #[test]
    fn invalid_download_never_overwrites_an_existing_model() {
        for (body, limit) in [(&b"abd"[..], 3), (&b"abcd"[..], 3)] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("model.onnx");
            std::fs::write(&path, b"previous").unwrap();
            let (url, server) = model_server(body);
            let client = reqwest::blocking::Client::builder().no_proxy().build().unwrap();
            assert!(download_file(&client, &url, &path, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", limit, "models", &|_| {}).is_err());
            server.join().unwrap();
            assert_eq!(std::fs::read(&path).unwrap(), b"previous");
            assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        }
    }

    #[test]
    fn file_integrity_rejects_same_size_modified_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model");
        std::fs::write(&path, b"abc").unwrap();
        assert!(engine::file_matches(&path, 3, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
        std::fs::write(&path, b"abd").unwrap();
        assert!(!engine::file_matches(&path, 3, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
    }

    #[test]
    #[ignore = "requires packaged engine manifest and downloads pinned official models"]
    fn real_packaged_engine_recognition_runs_offline() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let temporary = tempfile::tempdir().unwrap();
        let manifest = engine::manifest().unwrap();
        let zip = std::env::var_os("TRAYCLIP_TEST_ENGINE_ZIP").unwrap();
        let engine_dir = engine::install_archive(temporary.path(), &manifest, Path::new(&zip), env!("TRAYCLIP_TARGET")).unwrap();
        let models = std::env::var_os("TRAYCLIP_TEST_MODEL_DIR").map(PathBuf::from)
            .unwrap_or_else(|| temporary.path().join("models"));
        install_models(&models, &|progress| {
            if progress.total == Some(progress.downloaded) {
                println!("{}: {} bytes", progress.name, progress.downloaded);
            }
        }).unwrap();
        assert!(models_ready(&models));
        let reports = std::cell::Cell::new(0);
        install_models(&models, &|_| reports.set(reports.get() + 1)).unwrap();
        assert_eq!(reports.get(), 0, "Valid cached models must not be downloaded again");
        let screenshot = root.join("../docs/ui-qa/list-400-light.png");
        let request = Request { protocol: PROTOCOL, image_path: std::fs::canonicalize(screenshot).unwrap(),
            model_dir: std::fs::canonicalize(models).unwrap() };
        let executable = std::fs::canonicalize(engine_dir.join(&manifest.executable)).unwrap();
        let result = process::run_engine(&executable, &request).unwrap();
        println!("Recognized text:\n{result}");
        assert!(result.contains("TrayClip"), "Expected application name in actual screenshot: {result}");
    }

    #[test]
    fn image_selection_rejects_a_path_not_in_the_record() {
        assert!(select_image("image", Some("managed.png"), &[], Some("secret.png")).is_err());
        assert!(select_image("plain_text", None, &[], None).is_err());
    }

    #[test]
    fn image_selection_uses_only_images_belonging_to_the_record() {
        assert_eq!(select_image("image", Some("managed.png"), &[], None).unwrap(), "managed.png");
        let files = vec!["notes.txt".into(), "photo.JPG".into()];
        assert_eq!(select_image("file_paths", None, &files, Some("photo.JPG")).unwrap(), "photo.JPG");
        assert!(select_image("file_paths", None, &files, Some("notes.txt")).is_err());
    }

    #[test]
    fn corrupt_model_is_not_considered_ready() {
        let dir = tempfile::tempdir().unwrap();
        for model in MODELS {
            std::fs::write(dir.path().join(model.name), b"not an onnx model").unwrap();
        }
        assert!(!models_ready(dir.path()));
    }

}
