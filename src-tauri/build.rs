mod distribution_config;

fn main() {
    let distribution = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../config/distribution.json");
    println!("cargo:rerun-if-changed={}", distribution.display());
    let repository = distribution_config::parse_repository(
        &std::fs::read_to_string(distribution).expect("Cannot read config/distribution.json")
    ).expect("Invalid config/distribution.json");
    println!("cargo:rustc-env=TRAYCLIP_GITHUB_REPOSITORY={repository}");
    println!("cargo:rerun-if-env-changed=TRAYCLIP_OCR_MANIFEST");
    println!("cargo:rustc-env=TRAYCLIP_TARGET={}", std::env::var("TARGET").unwrap());
    let manifest = match std::env::var_os("TRAYCLIP_OCR_MANIFEST") {
        Some(path) => {
            println!("cargo:rerun-if-changed={}", std::path::Path::new(&path).display());
            std::fs::read(path).expect("Cannot read TRAYCLIP_OCR_MANIFEST")
        }
        None => b"null".to_vec(),
    };
    std::fs::write(std::path::Path::new(&std::env::var_os("OUT_DIR").unwrap()).join("ocr-engine.json"), manifest)
        .expect("Cannot embed OCR manifest");
    tauri_build::build()
}
