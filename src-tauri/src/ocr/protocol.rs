use std::path::PathBuf;
use anyhow::bail;
use serde::{Deserialize, Serialize};

pub const PROTOCOL: u32 = 1;
pub const MAX_IMAGE_BYTES: u64 = 32 * 1024 * 1024;
pub const MODEL_NAMES: [&str; 3] = [
    "ch_PP-OCRv4_det_infer.onnx",
    "ch_ppocr_mobile_v2.0_cls_infer.onnx",
    "ch_PP-OCRv4_rec_infer.onnx",
];

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub protocol: u32,
    pub image_path: PathBuf,
    pub model_dir: PathBuf,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Response {
    pub protocol: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn parse_response(bytes: &[u8]) -> anyhow::Result<String> {
    let response: Response = serde_json::from_slice(bytes)?;
    if response.protocol != PROTOCOL { bail!("Unsupported OCR protocol"); }
    match (response.text, response.error) {
        (Some(text), None) => Ok(text),
        (None, Some(error)) => bail!("OCR engine: {error}"),
        _ => bail!("Invalid OCR engine response"),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn response_requires_current_protocol_and_exactly_one_result() {
        assert_eq!(super::parse_response(br#"{"protocol":1,"text":""}"#).unwrap(), "");
        for invalid in [
            br#"{"protocol":2,"text":"hello"}"#.as_slice(),
            br#"{"protocol":1,"text":"hello","error":"failed"}"#,
            br#"{"protocol":1}"#,
            br#"{"protocol":1,"error":"failed"}"#,
            br#"not json"#,
        ] {
            assert!(super::parse_response(invalid).is_err());
        }
    }

    #[test]
    fn request_preserves_paths_with_spaces_and_unicode() {
        let json = r#"{"protocol":1,"image_path":"C:/test folder/\u56fe.png","model_dir":"/models"}"#;
        let request: super::Request = serde_json::from_str(json).unwrap();
        let encoded = serde_json::to_vec(&request).unwrap();
        let decoded: super::Request = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(decoded.image_path, request.image_path);
    }
}
