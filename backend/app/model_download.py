from __future__ import annotations

import argparse

from huggingface_hub import snapshot_download


def main() -> None:
    parser = argparse.ArgumentParser(description="Download a Wan model snapshot")
    parser.add_argument("--repo-id", required=True)
    parser.add_argument("--local-dir", required=True)
    args = parser.parse_args()

    snapshot_download(
        repo_id=args.repo_id,
        local_dir=args.local_dir,
        local_dir_use_symlinks=False,
        resume_download=True,
    )


if __name__ == "__main__":
    main()
