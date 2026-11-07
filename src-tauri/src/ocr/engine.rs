use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use anyhow::{bail, Context};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MAX_ARCHIVE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EngineFile {
    pub name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub version: String,
    pub target: String,
    pub executable: String,
    pub url: String,
    pub archive_size: u64,
    pub archive_sha256: String,
    pub files: Vec<EngineFile>,
}

fn safe_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 128 && name != "." && name != ".."
        && name.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

impl Manifest {
    pub fn validate(&self, target: &str) -> anyhow::Result<()> {
        if self.target != target || ![
            "x86_64-pc-windows-msvc", "aarch64-apple-darwin",
            "x86_64-apple-darwin", "x86_64-unknown-linux-gnu",
        ].contains(&target) { bail!("OCR engine platform mismatch"); }
        let executable = if target.ends_with("windows-msvc") { "trayclip-ocr.exe" } else { "trayclip-ocr" };
        if !safe_name(&self.version) || self.executable != executable
            || !self.url.starts_with(&format!("https://github.com/{}/releases/download/",
                env!("TRAYCLIP_GITHUB_REPOSITORY")))
            || self.archive_size == 0 || self.archive_size > MAX_ARCHIVE_BYTES
            || !valid_hash(&self.archive_sha256) || self.files.is_empty() || self.files.len() > 16 {
            bail!("Invalid OCR engine manifest");
        }
        let mut names = HashSet::new();
        let mut total = 0u64;
        for file in &self.files {
            if !safe_name(&file.name) || !names.insert(file.name.to_ascii_lowercase())
                || !valid_hash(&file.sha256) || file.size > MAX_EXPANDED_BYTES {
                bail!("Invalid OCR engine file manifest");
            }
            total = total.checked_add(file.size).context("OCR engine size overflow")?;
        }
        if total > MAX_EXPANDED_BYTES || !names.contains(executable) {
            bail!("Invalid OCR engine file manifest");
        }
        Ok(())
    }

    pub fn directory(&self, root: &Path) -> PathBuf {
        root.join("engines").join(&self.version).join(&self.target)
    }
}

pub fn manifest() -> anyhow::Result<Manifest> {
    let manifest: Option<Manifest> = serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/ocr-engine.json")))?;
    let manifest = manifest.context("This build has no OCR engine release manifest. Use an official release or build the OCR package first.")?;
    manifest.validate(env!("TRAYCLIP_TARGET"))?;
    Ok(manifest)
}

pub fn file_matches(path: &Path, size: u64, expected: &str) -> bool {
    let Ok(metadata) = std::fs::symlink_metadata(path) else { return false };
    if !metadata.is_file() || metadata.len() != size { return false; }
    let Ok(mut file) = std::fs::File::open(path) else { return false };
    let mut hash = Sha256::new();
    if std::io::copy(&mut file, &mut hash).is_err() { return false; }
    format!("{:x}", hash.finalize()) == expected
}

pub fn installed(dir: &Path, manifest: &Manifest) -> bool {
    if !std::fs::symlink_metadata(dir).is_ok_and(|m| m.is_dir()) { return false; }
    let Ok(entries) = std::fs::read_dir(dir) else { return false };
    let entries: Result<Vec<_>, _> = entries.collect();
    if !entries.is_ok_and(|entries| entries.len() == manifest.files.len()) { return false; }
    manifest.files.iter().all(|file| file_matches(&dir.join(&file.name), file.size, &file.sha256))
}

pub fn install_archive(root: &Path, manifest: &Manifest, path: &Path, target: &str) -> anyhow::Result<PathBuf> {
    manifest.validate(target)?;
    if !file_matches(path, manifest.archive_size, &manifest.archive_sha256) {
        bail!("OCR engine archive failed SHA-256 or size verification");
    }
    let destination = manifest.directory(root);
    let parent = destination.parent().context("Missing OCR engine directory")?;
    std::fs::create_dir_all(parent)?;
    let staging = tempfile::tempdir_in(parent)?;
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path)?)?;
    if archive.len() != manifest.files.len() { bail!("Unexpected OCR engine archive files"); }
    // ZipArchive indexes names and collapses duplicates. Inspect local entries
    // separately before trusting its indexed view; streaming drop skips raw bytes.
    let mut stream = std::fs::File::open(path)?;
    let mut local_names = HashSet::new();
    while let Some(entry) = zip::read::read_zipfile_from_stream(&mut stream)? {
        let file = manifest.files.iter().find(|file| file.name == entry.name())
            .context("Unexpected OCR engine local archive entry")?;
        if !local_names.insert(entry.name().to_owned()) || entry.size() != file.size {
            bail!("Duplicate or inconsistent OCR engine archive entry");
        }
    }
    if local_names.len() != manifest.files.len() { bail!("Missing OCR engine archive files"); }
    let mut seen = HashSet::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let name = entry.name().to_owned();
        let mode = entry.unix_mode().unwrap_or(0) & 0o170000;
        if !safe_name(&name) || !seen.insert(name.clone()) || entry.is_dir()
            || (mode != 0 && mode != 0o100000) {
            bail!("Unsafe OCR engine archive entry");
        }
        let file = manifest.files.iter().find(|file| file.name == name)
            .context("Unexpected OCR engine archive file")?;
        if entry.size() != file.size { bail!("OCR engine file exceeds declared size"); }
        let path = staging.path().join(&name);
        let mut output = std::fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
        let copied = std::io::copy(&mut (&mut entry).take(file.size + 1), &mut output)?;
        output.flush()?;
        if copied != file.size || !file_matches(&path, file.size, &file.sha256) {
            bail!("OCR engine file failed SHA-256 or size verification");
        }
        #[cfg(unix)]
        if name == manifest.executable {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))?;
        }
    }
    if !installed(staging.path(), manifest) { bail!("Incomplete OCR engine installation"); }
    // Move a broken installation aside only after the entire replacement is verified.
    let backup = tempfile::tempdir_in(parent)?;
    let previous = backup.path().join("previous");
    let had_previous = std::fs::symlink_metadata(&destination).is_ok();
    if had_previous { std::fs::rename(&destination, &previous)?; }
    if let Err(error) = std::fs::rename(staging.path(), &destination) {
        if had_previous { std::fs::rename(&previous, &destination).context("Cannot restore previous OCR engine")?; }
        return Err(error.into());
    }
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use sha2::{Digest, Sha256};

    fn fixture(entries: &[(&str, &[u8])]) -> (tempfile::TempDir, Manifest, std::path::PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let zip = root.path().join("engine.zip");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&zip).unwrap());
        for (name, bytes) in entries {
            writer.start_file(*name, zip::write::SimpleFileOptions::default().unix_permissions(0o755)).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
        let manifest = Manifest {
            version: "test-1".into(), target: "x86_64-pc-windows-msvc".into(),
            executable: "trayclip-ocr.exe".into(),
            url: format!("https://github.com/{}/releases/download/v1/engine.zip",
                env!("TRAYCLIP_GITHUB_REPOSITORY")),
            archive_size: std::fs::metadata(&zip).unwrap().len(),
            archive_sha256: format!("{:x}", Sha256::digest(std::fs::read(&zip).unwrap())),
            files: vec![EngineFile { name: "trayclip-ocr.exe".into(), size: 3,
                sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into() }],
        };
        (root, manifest, zip)
    }

    #[test]
    fn installs_only_verified_files_and_detects_modified_installations() {
        let (root, manifest, zip) = fixture(&[("trayclip-ocr.exe", b"abc")]);
        let destination = install_archive(root.path(), &manifest, &zip, &manifest.target).unwrap();
        assert!(installed(&destination, &manifest));
        std::fs::write(destination.join("trayclip-ocr.exe"), b"abd").unwrap();
        assert!(!installed(&destination, &manifest));
        install_archive(root.path(), &manifest, &zip, &manifest.target).unwrap();
        assert!(installed(&destination, &manifest));
        std::fs::write(destination.join("injected.dll"), b"extra").unwrap();
        assert!(!installed(&destination, &manifest));
    }

    #[test]
    fn rejects_unsafe_unexpected_missing_and_corrupt_archive_entries() {
        for entries in [
            vec![("../escape", b"abc".as_slice())],
            vec![("/absolute", b"abc".as_slice())],
            vec![("C:\\escape", b"abc".as_slice())],
            vec![("trayclip-ocr.exe", b"abd".as_slice())],
            vec![("trayclip-ocr.exe", b"abcd".as_slice())],
            vec![("trayclip-ocr.exe", b"abc".as_slice()), ("extra", b"x".as_slice())],
            vec![],
        ] {
            let (root, manifest, zip) = fixture(&entries);
            assert!(install_archive(root.path(), &manifest, &zip, &manifest.target).is_err(), "{entries:?}");
            assert!(!root.path().join("engines/test-1/x86_64-pc-windows-msvc").exists());
        }
    }

    #[test]
    fn rejects_wrong_platform_and_archive_hash_without_changing_old_install() {
        let (root, mut manifest, zip) = fixture(&[("trayclip-ocr.exe", b"abc")]);
        let dir = install_archive(root.path(), &manifest, &zip, &manifest.target).unwrap();
        assert!(install_archive(root.path(), &manifest, &zip, "aarch64-apple-darwin").is_err());
        manifest.archive_sha256 = "0".repeat(64);
        assert!(install_archive(root.path(), &manifest, &zip, &manifest.target).is_err());
        assert_eq!(std::fs::read(dir.join("trayclip-ocr.exe")).unwrap(), b"abc");
    }

    #[test]
    fn manifest_rejects_traversal_duplicate_files_and_unbounded_sizes() {
        let (_, manifest, _) = fixture(&[("trayclip-ocr.exe", b"abc")]);
        let mut bad = manifest.clone();
        bad.version = "..".into();
        assert!(bad.validate(&manifest.target).is_err());
        let mut bad = manifest.clone();
        bad.files.push(bad.files[0].clone());
        assert!(bad.validate(&manifest.target).is_err());
        let mut bad = manifest.clone();
        bad.archive_size = 128 * 1024 * 1024 + 1;
        assert!(bad.validate(&manifest.target).is_err());
        let mut bad = manifest.clone();
        bad.files[0].size = 256 * 1024 * 1024 + 1;
        assert!(bad.validate(&manifest.target).is_err());
    }

    #[test]
    fn manifest_accepts_repository_from_distribution_configuration() {
        let (_, mut manifest, _) = fixture(&[("trayclip-ocr.exe", b"abc")]);
        let config: serde_json::Value = serde_json::from_str(
            include_str!("../../../config/distribution.json")).unwrap();
        let repository = config["github_repository"].as_str().unwrap();
        manifest.url = format!("https://github.com/{repository}/releases/download/v1/engine.zip");
        manifest.validate(&manifest.target).unwrap();
    }

    #[test]
    fn manifest_rejects_engine_urls_outside_the_configured_repository() {
        let (_, manifest, _) = fixture(&[("trayclip-ocr.exe", b"abc")]);
        let repository = env!("TRAYCLIP_GITHUB_REPOSITORY");
        let (_, name) = repository.split_once('/').unwrap();
        for url in [
            format!("https://github.com/OtherOwner/{name}/releases/download/v1/engine.zip"),
            format!("https://github.com/{repository}.evil/releases/download/v1/engine.zip"),
            format!("https://github.com/{repository}/releases/latest/engine.zip"),
            format!("http://github.com/{repository}/releases/download/v1/engine.zip"),
        ] {
            let mut bad = manifest.clone();
            bad.url = url.clone();
            assert!(bad.validate(&manifest.target).is_err(), "{url}");
        }
    }

    #[test]
    fn rejects_symlink_entries_even_when_their_bytes_match() {
        let (root, mut manifest, zip) = fixture(&[]);
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&zip).unwrap());
        writer.add_symlink("trayclip-ocr.exe", "abc",
            zip::write::SimpleFileOptions::default()).unwrap();
        writer.finish().unwrap();
        manifest.archive_size = std::fs::metadata(&zip).unwrap().len();
        manifest.archive_sha256 = format!("{:x}", Sha256::digest(std::fs::read(&zip).unwrap()));
        assert!(install_archive(root.path(), &manifest, &zip, &manifest.target).is_err());
    }

    #[test]
    fn rejects_duplicate_zip_entries() {
        let (root, mut manifest, zip) = fixture(&[
            ("trayclip-ocr.exe", b"abc"), ("trayclip-xyz.exe", b"abc"),
        ]);
        let mut bytes = std::fs::read(&zip).unwrap();
        let needle = b"trayclip-xyz.exe";
        for index in 0..=bytes.len() - needle.len() {
            if &bytes[index..index + needle.len()] == needle {
                bytes[index..index + needle.len()].copy_from_slice(b"trayclip-ocr.exe");
            }
        }
        std::fs::write(&zip, &bytes).unwrap();
        manifest.archive_sha256 = format!("{:x}", Sha256::digest(bytes));
        assert!(install_archive(root.path(), &manifest, &zip, &manifest.target).is_err());
    }
}
