# Optional OCR Engine

The main Cargo package does not depend on ONNX Runtime. The independent
`src-tauri/ocr-engine` package owns inference, image codecs, and native dependencies.
Engine and model versions are selected by the TrayClip build, never by a runtime
`latest` request. Existing pinned models remain reusable.

## Build and Package

From the repository root:

```powershell
cargo build --release --locked --manifest-path src-tauri/ocr-engine/Cargo.toml --target-dir src-tauri/target/ocr-engine
python scripts/ocr/collect-notices.py --target x86_64-pc-windows-msvc --output src-tauri/target/ocr-dist/THIRD-PARTY-NOTICES.txt
python scripts/ocr/package-engine.py --executable src-tauri/target/ocr-engine/release/trayclip-ocr.exe --target x86_64-pc-windows-msvc --version 0.1.0 --tag v0.3.1 --license src-tauri/target/ocr-dist/THIRD-PARTY-NOTICES.txt --output src-tauri/target/ocr-dist
$env:TRAYCLIP_OCR_MANIFEST = (Resolve-Path src-tauri/target/ocr-dist/ocr-engine-x86_64-pc-windows-msvc.json).Path
node node_modules/@tauri-apps/cli/tauri.js build --bundles nsis
```

Windows packaging requires a Visual Studio developer shell (`dumpbin` and
`VCToolsRedistDir`). It includes actual imported non-system libraries, including
VC++ redistributable CRT files, rather than assuming they are installed.
Packaging also extracts the generated artifact into a fresh directory and runs
its helper protocol self-test there, without build-tree library search paths.
The generated notices include dependency licenses and ONNX Runtime third-party
notices. Review binary redistribution terms before publication.

macOS packaging must sign the helper before generating hashes. Current CI uses
ad-hoc signing, matching the application; this is not notarization or a guarantee
of Gatekeeper acceptance. Linux packages accept ordinary system C/C++ runtimes
but reject missing non-system dependencies.

The release workflow packages the engine before the application, embeds the
manifest, and uploads both to the same draft GitHub Release. Do not publish a
draft unless every application's referenced engine ZIP is present.
Engine download URLs and the application's update check use the build-time
`github_repository` in `config/distribution.json` (default: `Heyiki/TrayClip`).
Packaging does not infer the repository from a local Git remote or the Actions
repository context. Release jobs only publish when their repository matches
that configuration.
No artifact is uploaded by local packaging. A locally generated GitHub URL does
not mean that artifact has been published.

Bump `ocr-engine/Cargo.toml`'s engine version when changing its implementation
or native dependencies. Unchanged versions with matching files are reused even
if the next application release points at a different GitHub asset URL.

## Development

Without `TRAYCLIP_OCR_MANIFEST`, the main application still builds and tests
offline without ONNX Runtime, but OCR installation is explicitly unavailable.
To use OCR locally, generate the package and embed its manifest, then import
that exact ZIP in the OCR dialog. There is no checksum bypass.

The engine ZIP import does not contain models. Missing models still download
from pinned official ModelScope URLs; existing valid models are never downloaded
again. Installed engines live in `ocr/engines/<version>/<target>/` and models
remain in `ocr/rapidocr-1.3.24/` under the existing application data root.

Run tests:

```powershell
cargo test --offline --manifest-path src-tauri/Cargo.toml
python scripts/ocr/test-package-engine.py
cargo test --locked --manifest-path src-tauri/ocr-engine/Cargo.toml --target-dir src-tauri/target/ocr-engine
node scripts/check-ocr-ui.cjs
```

The browser test uses the same `PLAYWRIGHT_MODULE`, `BROWSER_EXECUTABLE`, and
`TEST_URL` environment variables as the other UI checks. By default it loads
`playwright` and its Chromium browser and expects Vite at `127.0.0.1:1421`.
Its fixtures are under `scripts/ocr/ui.html` and use the real dialog with mocked
desktop IPC. The screenshot directory is created automatically.

The ignored main test `real_packaged_engine_recognition_runs_offline` requires
`TRAYCLIP_OCR_MANIFEST` and `TRAYCLIP_TEST_ENGINE_ZIP`. It tests the actual
verified ZIP, installed helper protocol and pinned models against the existing
UI screenshot fixture. The helper's ignored format test requires
`TRAYCLIP_TEST_MODEL_DIR` and `TRAYCLIP_TEST_IMAGE`.
