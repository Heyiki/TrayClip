pub fn parse_repository(content: &str) -> Result<String, String> {
    let config: serde_json::Value = serde_json::from_str(content).map_err(|e| e.to_string())?;
    let repository = config["github_repository"].as_str()
        .ok_or("github_repository must be a GitHub owner/repository")?;
    let (owner, name) = repository.split_once('/')
        .ok_or("github_repository must be a GitHub owner/repository")?;
    if owner.is_empty() || owner.len() > 39 || owner.starts_with('-') || owner.ends_with('-')
        || !owner.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        || name.is_empty() || name.len() > 100 || name == "." || name == ".."
        || !name.bytes().all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c)) {
        return Err("github_repository must be a GitHub owner/repository".into());
    }
    Ok(repository.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_custom_distribution_repository() {
        assert_eq!(parse_repository(r#"{"github_repository":"ExampleOrg/ClipboardFork"}"#).unwrap(),
            "ExampleOrg/ClipboardFork");
    }

    #[test]
    fn rejects_invalid_distribution_repository() {
        for repository in ["", "owner", "owner/repo/extra", "https://github.com/owner/repo",
            "owner/..", "-owner/repo", "owner-/repo", "owner/repo?query=1", "owner/repo\ninjected"] {
            let content = serde_json::json!({"github_repository": repository}).to_string();
            assert!(parse_repository(&content).is_err(), "{repository}");
        }
        for content in ["{}", "null", "[]", r#"{"github_repository":123}"#, "invalid json"] {
            assert!(parse_repository(content).is_err(), "{content}");
        }
    }
}
