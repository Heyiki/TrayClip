use std::io::{Read, Write};
use std::path::Path;
use anyhow::{bail, Context};
use paddle_ocr_rs::ocr_lite::OcrLite;

#[path = "../../src/ocr/protocol.rs"]
#[allow(dead_code)]
mod protocol;
use protocol::{Request, Response, MODEL_NAMES, PROTOCOL, MAX_IMAGE_BYTES};

fn order_text(mut lines: Vec<(u32, u32, String)>) -> String {
    lines.sort_by_key(|(x, y, _)| (*y, *x));
    lines.into_iter().map(|(_, _, text)| text.trim().to_owned())
        .filter(|text| !text.is_empty()).collect::<Vec<_>>().join("\n")
}

fn recognize(dir: &Path, path: &Path) -> anyhow::Result<String> {
    if std::fs::metadata(path)?.len() > MAX_IMAGE_BYTES { bail!("OCR image exceeds 32 MiB"); }
    let mut reader = image::ImageReader::open(path)?.with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().context("Cannot decode OCR image")?.to_rgb8();
    let paths: Vec<_> = MODEL_NAMES.iter().map(|name| dir.join(name)).collect();
    let mut engine = OcrLite::new();
    engine.init_models(
        paths[0].to_str().context("Invalid model path")?,
        paths[1].to_str().context("Invalid model path")?,
        paths[2].to_str().context("Invalid model path")?,
        2,
    )?;
    let result = engine.detect(&image, 50, 1600, 0.5, 0.3, 1.6, false, false)?;
    Ok(order_text(result.text_blocks.into_iter().map(|block| {
        let x = block.box_points.iter().map(|point| point.x).min().unwrap_or(0);
        let y = block.box_points.iter().map(|point| point.y).min().unwrap_or(0);
        (x, y, block.text)
    }).collect()))
}

fn handle_request(input: &[u8]) -> anyhow::Result<String> {
    let request: Request = serde_json::from_slice(input)?;
    if request.protocol != PROTOCOL { bail!("Unsupported OCR protocol"); }
    if !request.image_path.is_absolute() || !request.model_dir.is_absolute() {
        bail!("OCR paths must be absolute");
    }
    recognize(&request.model_dir, &request.image_path)
}

fn main() {
    let result = if std::env::args().nth(1).as_deref() == Some("--self-test") {
        Ok("trayclip-ocr".to_owned())
    } else {
        let mut input = Vec::new();
        std::io::stdin().take(64 * 1024 + 1).read_to_end(&mut input)
            .context("Cannot read OCR request")
            .and_then(|_| {
                if input.len() > 64 * 1024 { bail!("OCR request exceeds size limit"); }
                handle_request(&input)
            })
    };
    let response = match result {
        Ok(text) => Response { protocol: PROTOCOL, text: Some(text), error: None },
        Err(error) => Response { protocol: PROTOCOL, text: None, error: Some(format!("{error:#}")) },
    };
    if let Err(error) = serde_json::to_writer(std::io::stdout().lock(), &response)
        .context("Cannot write OCR response")
        .and_then(|_| Ok(std::io::stdout().flush()?)) {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_lines_and_removes_empty_blocks() {
        assert_eq!(order_text(vec![
            (100, 50, " second ".into()), (40, 10, "right".into()),
            (10, 10, "left".into()), (0, 0, "  ".into()),
        ]), "left\nright\nsecond");
    }

    #[test]
    fn rejects_unknown_protocol_before_accessing_files() {
        assert!(handle_request(br#"{"protocol":2,"image_path":"/missing","model_dir":"/missing"}"#)
            .unwrap_err().to_string().contains("protocol"));
    }

    #[test]
    fn rejects_relative_paths_before_accessing_files() {
        assert!(handle_request(br#"{"protocol":1,"image_path":"relative","model_dir":"relative"}"#)
            .unwrap_err().to_string().contains("absolute"));
    }

    #[test]
    #[ignore = "requires TRAYCLIP_TEST_MODEL_DIR and TRAYCLIP_TEST_IMAGE"]
    fn recognizes_six_formats_and_blank_image_offline() {
        let models = std::env::var_os("TRAYCLIP_TEST_MODEL_DIR").unwrap();
        let screenshot = std::env::var_os("TRAYCLIP_TEST_IMAGE").unwrap();
        let image = image::ImageReader::open(&screenshot).unwrap()
            .with_guessed_format().unwrap().decode().unwrap().to_rgb8();
        let temporary = std::env::temp_dir().join(format!("trayclip-ocr-test-{}", std::process::id()));
        std::fs::create_dir_all(&temporary).unwrap();
        for extension in ["png", "jpg", "bmp", "webp", "gif", "tiff"] {
            let path = temporary.join(format!("screenshot.{extension}"));
            image.save(&path).unwrap();
            let result = recognize(Path::new(&models), &path).unwrap();
            assert!(result.contains("TrayClip"), "{extension}: {result}");
        }
        let blank = temporary.join("blank.png");
        image::RgbImage::from_pixel(400, 200, image::Rgb([255, 255, 255])).save(&blank).unwrap();
        assert_eq!(recognize(Path::new(&models), &blank).unwrap(), "");
        std::fs::remove_dir_all(temporary).unwrap();
    }
}
