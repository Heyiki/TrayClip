"""Collect dependency license texts and ONNX Runtime notices for the OCR artifact."""
import argparse
import json
from html.parser import HTMLParser
from pathlib import Path
import subprocess
import urllib.request

class LicenseText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        if tag == "pre":
            self.depth += 1

    def handle_endtag(self, tag):
        if tag == "pre":
            self.depth -= 1

    def handle_data(self, data):
        if self.depth:
            self.parts.append(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--target", required=True)
    args = parser.parse_args()
    metadata = json.loads(subprocess.check_output([
        "cargo", "metadata", "--locked", "--format-version", "1",
        "--manifest-path", "src-tauri/ocr-engine/Cargo.toml", "--filter-platform", args.target,
    ], text=True))
    sections = []
    for package in sorted(metadata["packages"], key=lambda item: item["name"]):
        directory = Path(package["manifest_path"]).parent
        sections.append(f"\n{'=' * 72}\n{package['name']} {package['version']}\n"
            f"License: {package.get('license') or 'see license text'}\n"
            f"Source: {package.get('repository') or package.get('source') or 'TrayClip repository'}\n")
        licenses = sorted(path for path in directory.iterdir() if path.is_file()
            and path.name.upper().startswith(("LICENSE", "COPYING", "NOTICE")))
        if package["name"] == "trayclip-ocr":
            licenses.append(Path(__file__).resolve().parents[2] / "LICENSE")
        if not licenses:
            raise ValueError(f"No license texts found for {package['name']}")
        for path in licenses:
            sections.append(path.read_text(encoding="utf-8", errors="replace"))
    for filename in ["LICENSE", "ThirdPartyNotices.txt"]:
        url = f"https://raw.githubusercontent.com/microsoft/onnxruntime/v1.22.0/{filename}"
        with urllib.request.urlopen(url, timeout=60) as response:
            sections.append(f"\nONNX Runtime 1.22.0 {filename}\n{url}\n"
                + response.read().decode("utf-8"))
    if args.target.endswith("windows-msvc"):
        url = "https://www.nuget.org/packages/Microsoft.AI.DirectML/1.15.4/License"
        with urllib.request.urlopen(url, timeout=60) as response:
            content = response.read(2 * 1024 * 1024 + 1)
        if len(content) > 2 * 1024 * 1024:
            raise ValueError("DirectML license exceeds limit")
        parser = LicenseText()
        parser.feed(content.decode("utf-8"))
        text = "\n".join(part.strip() for part in parser.parts if part.strip())
        if "MICROSOFT" not in text.upper() or "DIRECTML" not in text.upper():
            raise ValueError("Cannot find DirectML license text")
        sections.append(f"\nDirectML 1.15.4 license\n{url}\n{text}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(sections), encoding="utf-8")
    print(args.output.resolve())


if __name__ == "__main__":
    main()
