"""Build a pinned OCR archive and manifest, without publishing anything."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from distribution import DISTRIBUTION_CONFIG, load_repository

TARGETS = {
    "x86_64-pc-windows-msvc", "aarch64-apple-darwin",
    "x86_64-apple-darwin", "x86_64-unknown-linux-gnu",
}


def digest(content):
    return hashlib.sha256(content).hexdigest()


def package(executable, licenses, output, version, target, tag, libraries):
    repository = load_repository(DISTRIBUTION_CONFIG)
    if target not in TARGETS:
        raise ValueError("Unsupported target")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", version):
        raise ValueError("Invalid engine version")
    if not re.fullmatch(r"[\w.-]+", tag):
        raise ValueError("Invalid release identity")
    expected = "trayclip-ocr.exe" if target.endswith("windows-msvc") else "trayclip-ocr"
    if executable.name != expected:
        raise ValueError("Unexpected executable name")
    files = [executable, *libraries, *licenses]
    if len(files) > 16 or len({path.name.lower() for path in files}) != len(files):
        raise ValueError("Duplicate or excessive package files")
    for path in files:
        if (not re.fullmatch(r"[A-Za-z0-9._-]+", path.name) or not path.is_file()
                or (path.is_symlink() and path not in libraries)):
            raise ValueError(f"Unsafe package file: {path}")
    if sum(path.stat().st_size for path in files) > 256 * 1024 * 1024:
        raise ValueError("Engine exceeds expanded size limit")
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"trayclip-ocr-{version}-{target}.zip"
    entries = []
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as writer:
        for path in sorted(files, key=lambda path: path.name):
            content = path.read_bytes()
            entry = zipfile.ZipInfo(path.name, (2026, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (0o100755 if path == executable else 0o100644) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            writer.writestr(entry, content)
            entries.append({"name": path.name, "size": len(content), "sha256": digest(content)})
    content = archive.read_bytes()
    if len(content) > 128 * 1024 * 1024:
        raise ValueError("Engine archive exceeds size limit")
    manifest = {
        "version": version, "target": target, "executable": expected,
        "url": f"https://github.com/{repository}/releases/download/{tag}/{archive.name}",
        "archive_size": len(content), "archive_sha256": digest(content), "files": entries,
    }
    manifest_path = output / f"ocr-engine-{target}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest_path, archive


def native_libraries(executable, target):
    """Reject unexpected native dependencies rather than silently ship broken helpers."""
    if target.endswith("windows-msvc"):
        # dumpbin is available in the Visual Studio developer environment.
        system = {"kernel32.dll", "user32.dll", "advapi32.dll", "bcrypt.dll", "crypt32.dll",
            "ntdll.dll", "ole32.dll", "oleaut32.dll", "shell32.dll", "ws2_32.dll",
            "userenv.dll", "secur32.dll", "rpcrt4.dll", "gdi32.dll", "shlwapi.dll",
            "psapi.dll", "dbghelp.dll", "version.dll", "msvcrt.dll", "ucrtbase.dll",
            "bcryptprimitives.dll", "dxcore.dll", "dxgi.dll", "d3d12.dll", "setupapi.dll",
            "cfgmgr32.dll", "combase.dll", "imm32.dll", "winmm.dll", "powrprof.dll"}
        dumpbin = shutil.which("dumpbin")
        if not dumpbin:
            raise ValueError("Run packaging in a Visual Studio developer environment (dumpbin required)")
        redist = os.environ.get("VCToolsRedistDir")
        candidates = sorted(Path(redist).glob("x64/Microsoft.VC*.CRT")) if redist else []
        directories = [executable.parent, *candidates]
        pending = [executable]
        libraries = {}
        while pending:
            binary = pending.pop()
            result = subprocess.run([dumpbin, "/dependents", str(binary)],
                check=True, capture_output=True, text=True)
            names = re.findall(r"^\s+([\w.-]+\.dll)\s*$", result.stdout, re.MULTILINE | re.IGNORECASE)
            if not names:
                raise ValueError(f"No dependencies reported for {binary}")
            for name in names:
                lower = name.lower()
                if lower in system or lower.startswith(("api-ms-win-", "ext-ms-win-")):
                    continue
                if lower in libraries:
                    continue
                local = next((directory / name for directory in directories if (directory / name).is_file()), None)
                if not local:
                    raise ValueError(f"Missing non-system dependency: {name}")
                # ort-sys may expose its build cache through a symlink; ZIP entries
                # are always regular files containing the resolved bytes.
                libraries[lower] = local
                pending.append(local)
        return list(libraries.values())
    if target.endswith("apple-darwin"):
        output = subprocess.check_output(["otool", "-L", str(executable)], text=True)
        libraries = []
        for line in output.splitlines()[1:]:
            name = line.strip().split(" (")[0]
            if name.startswith(("/usr/lib/", "/System/Library/")):
                continue
            if not name.startswith("@executable_path/"):
                raise ValueError(f"Unpackaged native dependency: {name}")
            libraries.append(executable.parent / name.removeprefix("@executable_path/"))
        return libraries
    output = subprocess.check_output(["ldd", str(executable)], text=True)
    if "not found" in output:
        raise ValueError(f"Missing native dependency:\n{output}")
    system_prefixes = ("libc.so", "libm.so", "libdl.so", "libpthread.so", "librt.so",
        "libgcc_s.so", "libstdc++.so", "ld-linux", "linux-vdso")
    libraries = []
    for line in output.splitlines():
        fields = line.strip().split()
        if not fields or fields[0].startswith(system_prefixes) or fields[0].startswith("/lib"):
            continue
        if len(fields) < 3 or fields[1] != "=>":
            raise ValueError(f"Unknown dependency: {line}")
        library = executable.parent / fields[0]
        if not library.is_file():
            raise ValueError(f"Missing packaged library: {fields[0]}")
        libraries.append(library)
    return libraries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", type=Path, required=True)
    parser.add_argument("--license", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", default="0.1.0")
    parser.add_argument("--target", choices=sorted(TARGETS), required=True)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()
    libraries = native_libraries(args.executable, args.target)
    manifest, archive = package(args.executable, args.license, args.output, args.version,
        args.target, args.tag, libraries)
    # Exercise the actual artifact away from the build tree and its native DLLs.
    description = json.loads(manifest.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(dir=args.output) as directory:
        directory = Path(directory).resolve()
        with zipfile.ZipFile(archive) as opened:
            for file in description["files"]:
                content = opened.read(file["name"])
                if len(content) != file["size"] or digest(content) != file["sha256"]:
                    raise ValueError("Packaged file failed verification")
                (directory / file["name"]).write_bytes(content)
        helper = directory / description["executable"]
        helper.chmod(0o755)
        environment = os.environ.copy()
        environment.pop("LD_LIBRARY_PATH", None)
        environment.pop("DYLD_LIBRARY_PATH", None)
        response = subprocess.run([str(helper), "--self-test"], cwd=directory,
            capture_output=True, text=True, check=True, timeout=30, env=environment)
        if json.loads(response.stdout) != {"protocol": 1, "text": "trayclip-ocr"}:
            raise ValueError("Packaged engine self-test failed")
    print(manifest.resolve())
    print(archive.resolve())


if __name__ == "__main__":
    main()
