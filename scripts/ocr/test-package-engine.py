import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location("package_engine", Path(__file__).with_name("package-engine.py"))


class PackageTests(unittest.TestCase):
    def test_distribution_config_changes_engine_url_without_using_git_remote(self):
        module = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            executable = root / "trayclip-ocr.exe"
            executable.write_bytes(b"engine")
            config = root / "distribution.json"
            config.write_text('{"github_repository": "ExampleOrg/ClipboardFork"}', encoding="utf-8")
            module.DISTRIBUTION_CONFIG = config
            manifest_path, _ = module.package(
                executable, [], root / "out", "0.1.0", "x86_64-pc-windows-msvc",
                "v1.2.3", []
            )
            self.assertEqual(json.loads(manifest_path.read_text())["url"],
                "https://github.com/ExampleOrg/ClipboardFork/releases/download/v1.2.3/trayclip-ocr-0.1.0-x86_64-pc-windows-msvc.zip")

    def test_invalid_distribution_config_never_creates_an_archive(self):
        module = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            executable = root / "trayclip-ocr.exe"
            executable.write_bytes(b"engine")
            config = root / "distribution.json"
            module.DISTRIBUTION_CONFIG = config
            for repository in ["", "owner", "owner/repo/extra", "https://github.com/owner/repo",
                    "owner/..", "-owner/repo", "owner/repo?query=1", "owner/repo\ninjected"]:
                with self.subTest(repository=repository):
                    config.write_text(json.dumps({"github_repository": repository}), encoding="utf-8")
                    with self.assertRaises(ValueError):
                        module.package(executable, [], root / "out", "0.1.0",
                            "x86_64-pc-windows-msvc", "v1", [])
                    self.assertFalse((root / "out").exists())

    def test_packages_exact_files_with_verified_manifest_and_fixed_release_url(self):
        module = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            executable = root / "trayclip-ocr.exe"
            executable.write_bytes(b"engine")
            license_file = root / "LICENSE.txt"
            license_file.write_bytes(b"license")
            config = root / "distribution.json"
            config.write_text('{"github_repository":"Heyiki/TrayClip"}', encoding="utf-8")
            module.DISTRIBUTION_CONFIG = config
            output = root / "out"
            manifest_path, archive = module.package(
                executable, [license_file], output, "0.1.0", "x86_64-pc-windows-msvc",
                "v0.3.1", []
            )
            manifest = json.loads(manifest_path.read_text())
            self.assertEqual(manifest["url"],
                "https://github.com/Heyiki/TrayClip/releases/download/v0.3.1/trayclip-ocr-0.1.0-x86_64-pc-windows-msvc.zip")
            self.assertEqual(manifest["archive_sha256"], hashlib.sha256(archive.read_bytes()).hexdigest())
            self.assertEqual(manifest["archive_size"], archive.stat().st_size)
            with zipfile.ZipFile(archive) as opened:
                self.assertEqual(set(opened.namelist()), {"trayclip-ocr.exe", "LICENSE.txt"})
                for entry in manifest["files"]:
                    content = opened.read(entry["name"])
                    self.assertEqual(len(content), entry["size"])
                    self.assertEqual(hashlib.sha256(content).hexdigest(), entry["sha256"])
            first = archive.read_bytes()
            module.package(executable, [license_file], output, "0.1.0", "x86_64-pc-windows-msvc",
                "v0.3.1", [])
            self.assertEqual(first, archive.read_bytes())

    def test_rejects_unknown_platform_and_duplicate_names(self):
        module = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            executable = Path(temporary) / "trayclip-ocr"
            executable.write_bytes(b"engine")
            with self.assertRaises(ValueError):
                module.package(executable, [], Path(temporary), "0.1.0", "unknown", "v1", [])
            with self.assertRaises(ValueError):
                module.package(executable, [executable], Path(temporary), "0.1.0",
                    "x86_64-unknown-linux-gnu", "v1", [])


if __name__ == "__main__":
    unittest.main()
