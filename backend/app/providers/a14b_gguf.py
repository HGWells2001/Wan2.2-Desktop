from __future__ import annotations

import json
from pathlib import Path
import sys

from ..model_profiles import get_model_profile


def validate_model_dir(model_id: str, model_dir: Path) -> dict[str, object]:
    profile = get_model_profile(model_id)
    if profile["engine"] != "diffusers-gguf":
        raise ValueError(f"Model {model_id!r} is not a GGUF A14B profile.")

    manifest_path = model_dir / "wan2-desktop-model.json"
    if not manifest_path.is_file():
        raise ValueError(
            "A14B model manifest not found. Download the selected A14B profile "
            "with Wan2.2 Desktop or choose its complete model folder."
        )

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("model_id") != model_id:
        raise ValueError(
            f"The selected folder contains {manifest.get('model_id')!r}, "
            f"not {model_id!r}."
        )

    return profile


def build_command(
    *,
    model_id: str,
    model_dir: Path,
    prompt: str,
    size: str,
    output_path: Path,
    seed: int,
    sample_steps: int | None,
) -> list[str]:
    profile = validate_model_dir(model_id, model_dir)

    if size not in profile["sizes"]:
        raise ValueError(f"Unsupported size {size!r} for {profile['name']}")

    return [
        sys.executable,
        "-m",
        "app.gguf_generate",
        "--model-dir",
        str(model_dir),
        "--prompt",
        prompt,
        "--size",
        size,
        "--save-file",
        str(output_path),
        "--seed",
        str(seed),
        "--sample-steps",
        str(sample_steps or 40),
    ]
