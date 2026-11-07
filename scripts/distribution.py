"""Read the build-time distribution repository; never infer it from Git."""
import json
from pathlib import Path
import re

DISTRIBUTION_CONFIG = Path(__file__).resolve().parents[1] / "config" / "distribution.json"


def load_repository(config_path=DISTRIBUTION_CONFIG):
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    repository = config.get("github_repository") if isinstance(config, dict) else None
    if not isinstance(repository, str) or not re.fullmatch(
            r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?/[A-Za-z0-9_.-]{1,100}", repository):
        raise ValueError("github_repository must be a GitHub owner/repository")
    if repository.split("/")[1] in {".", ".."}:
        raise ValueError("Invalid GitHub repository name")
    return repository


if __name__ == "__main__":
    print(load_repository())
