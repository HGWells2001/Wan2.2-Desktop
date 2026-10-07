from __future__ import annotations

import argparse
import json
from pathlib import Path

from huggingface_hub import snapshot_download

from .model_profiles import get_model_profile


def _write_manifest(model_dir: Path, profile: dict[str, object]) -> None:
    manifest = {
        "model_id": profile["id"],
        "name": profile["name"],
        "engine": profile["engine"],
        "task": profile["task"],
        "quantization": profile.get("quantization"),
        "repo_id": profile["repo_id"],
        "base_repo_id": profile.get("base_repo_id"),
        "high_noise_file": profile.get("high_noise_file"),
        "low_noise_file": profile.get("low_noise_file"),
    }
    (model_dir / "wan2-desktop-model.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )


def download_profile(model_id: str, model_dir: Path) -> None:
    profile = get_model_profile(model_id)
    model_dir.mkdir(parents=True, exist_ok=True)

    if profile["engine"] == "wan-upstream":
        print(f"[Wan2.2 Desktop] Downloading {profile['name']}...")
        snapshot_download(
            repo_id=str(profile["repo_id"]),
            local_dir=model_dir,
        )
        _write_manifest(model_dir, profile)
        print("[Wan2.2 Desktop] Model download complete.")
        return

    if profile["engine"] != "diffusers-gguf":
        raise RuntimeError(f"Unsupported model download engine: {profile['engine']}")

    quant_dir = model_dir / "quantized"
    base_dir = model_dir / "base"
    quant_dir.mkdir(parents=True, exist_ok=True)
    base_dir.mkdir(parents=True, exist_ok=True)

    high_noise = str(profile["high_noise_file"])
    low_noise = str(profile["low_noise_file"])

    print(
        f"[Wan2.2 Desktop] Downloading {profile['name']} GGUF experts "
        f"({profile['quantization']})..."
    )
    snapshot_download(
        repo_id=str(profile["repo_id"]),
        local_dir=quant_dir,
        allow_patterns=[high_noise, low_noise],
    )

    print("[Wan2.2 Desktop] Downloading shared Wan A14B pipeline components...")
    snapshot_download(
        repo_id=str(profile["base_repo_id"]),
        local_dir=base_dir,
        allow_patterns=[
            "model_index.json",
            "scheduler/**",
            "text_encoder/**",
            "tokenizer/**",
            "vae/**",
            "transformer/config.json",
            "transformer_2/config.json",
        ],
    )

    _write_manifest(model_dir, profile)
    print("[Wan2.2 Desktop] Model download complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download a Wan2.2 Desktop model profile")
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--local-dir", required=True)
    args = parser.parse_args()

    download_profile(args.model_id, Path(args.local_dir).expanduser().resolve())


if __name__ == "__main__":
    main()
