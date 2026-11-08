"""Download and verify the immutable engine selected for an application release."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tomllib
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from distribution import load_repository

ROOT = Path(__file__).resolve().parents[2]


def verify(output, pin, target, repository):
    manifest_path = output / f"ocr-engine-{target}.json"
    raw = manifest_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != pin["manifests"][target]:
        raise ValueError("Published OCR manifest changed; never rebuild an existing engine version")
    manifest = json.loads(raw)
    asset = f"trayclip-ocr-{pin['version']}-{target}.zip"
    expected = f"https://github.com/{repository}/releases/download/{pin['release_tag']}/{asset}"
    if (manifest["version"] != pin["version"] or manifest["target"] != target
            or manifest["url"] != expected):
        raise ValueError("OCR release identity mismatch")
    archive = output / asset
    if (not 0 < manifest["archive_size"] <= 128 * 1024 * 1024
            or archive.stat().st_size != manifest["archive_size"]
            or hashlib.sha256(archive.read_bytes()).hexdigest() != manifest["archive_sha256"]):
        raise ValueError("OCR archive failed size or SHA-256 verification")
    files = manifest["files"]
    if not 0 < len(files) <= 16 or sum(file["size"] for file in files) > 256 * 1024 * 1024:
        raise ValueError("Invalid OCR file limits")
    with zipfile.ZipFile(archive) as opened:
        names = [file["name"] for file in files]
        if (len(set(name.lower() for name in names)) != len(names)
                or sorted(opened.namelist()) != sorted(names)):
            raise ValueError("Unexpected OCR archive entries")
        for file in files:
            if not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9._-]*", file["name"]):
                raise ValueError("Unsafe OCR filename")
            entry = opened.getinfo(file["name"])
            if entry.file_size != file["size"] or (entry.external_attr >> 16) & 0o170000 not in (0, 0o100000):
                raise ValueError("Invalid OCR archive entry")
            with opened.open(entry) as source:
                if hashlib.file_digest(source, "sha256").hexdigest() != file["sha256"]:
                    raise ValueError("OCR file failed SHA-256 verification")
    return manifest_path.resolve(strict=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    pin = json.loads((ROOT / "config/ocr-engine.json").read_text(encoding="utf-8"))
    version = tomllib.loads((ROOT / "src-tauri/ocr-engine/Cargo.toml").read_text(encoding="utf-8"))["package"]["version"]
    if version != pin["version"] or args.target not in pin["manifests"]:
        raise ValueError("Pin the published engine version and all target manifests before releasing the app")
    repository = load_repository()
    args.output.mkdir(parents=True, exist_ok=True)
    subprocess.run(["gh", "release", "download", pin["release_tag"], "--repo", repository,
        "--pattern", f"ocr-engine-{args.target}.json",
        "--pattern", f"trayclip-ocr-{version}-{args.target}.zip",
        "--dir", str(args.output)], check=True)
    path = verify(args.output, pin, args.target, repository)
    print(path)
    import os
    with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as environment:
        environment.write(f"TRAYCLIP_OCR_MANIFEST={path}\n")


if __name__ == "__main__":
    main()
