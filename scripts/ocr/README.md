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

Application releases download the original ZIP and manifest pinned in
`config/ocr-engine.json`. The manifest SHA-256 is pinned as well; a missing or
changed asset fails the build instead of silently rebuilding the same version.
The initial pin reuses the four existing `v0.3.2` engine packages.
No engine is rebuilt or uploaded during ordinary application releases.
Engine download URLs and the application's update check use the build-time
`github_repository` in `config/distribution.json` (default: `Heyiki/TrayClip`).
Packaging does not infer the repository from a local Git remote or the Actions
repository context. Release jobs only publish when their repository matches
that configuration.
No artifact is uploaded by local packaging. A locally generated GitHub URL does
not mean that artifact has been published.

Bump `ocr-engine/Cargo.toml`'s engine version when changing its implementation,
protocol, native dependencies, packaging or notices. Run the manual **Release OCR
Engine** workflow before changing the pin. It creates an `ocr-v<version>` draft
prerelease, signs macOS helpers before hashing and never overwrites assets.
Review all four ZIPs/manifests, publish that prerelease, then update the version,
release tag and manifest SHA-256 values in `config/ocr-engine.json` before releasing
the application. Keep engine releases as prereleases so they do not become the
application's latest stable update. A failed engine run leaves a draft for manual
inspection; remove only that incomplete unpublished draft before retrying.
Existing pinned releases must remain available, including for application downgrades.

## Development

Without `TRAYCLIP_OCR_MANIFEST`, the main application still builds and tests
offline without ONNX Runtime, but OCR installation is explicitly unavailable.
To use OCR locally, generate the package and embed its manifest, then import
that exact ZIP in the OCR dialog. There is no checksum bypass.

The engine ZIP import does not contain models. Missing models still download
from pinned official ModelScope URLs; existing valid models are never downloaded
again. Installed engines live in `ocr/engines/<version>/<target>/` and models
remain in `ocr/rapidocr-1.3.24/` under the existing application data root.
Closing the dialog leaves an active download running. **Cancel download** aborts
network waits, removes incomplete temporary files and waits for the installation
job to finish before offering import/retry. Verification and atomic installation
are not forcibly interrupted. Completed valid components are retained.

After all required components are ready, other engine version directories are
removed; models are not touched. The retained version is the current application's
compatible version, not the numerically highest version. An application downgrade
can therefore require installing its older compatible engine again. Failed or
cancelled installs do not prune previous engine versions.

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
