# Dependency Feature Patch

Source: paddle-ocr-rs 0.6.1 from crates.io.
Upstream: https://github.com/mg-chao/paddle-ocr-rs
License: Apache-2.0, retained in LICENSE.

All files under src/ are unmodified upstream source. Only Cargo configuration is
changed: disable image/default directly and via imageproc/default, retaining
imageproc/rayon. TrayClip selects its supported decoders explicitly. The ort API
is pinned to the prerelease targeted by upstream.

This local patch can be removed when upstream exposes the equivalent feature
control. Do not change OCR implementation here for application behavior.
