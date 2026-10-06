from __future__ import annotations

from pathlib import Path
import os
import sys

from .base import ProviderCapabilities, VideoGenerationProvider


SUPPORTED_TASKS = {
    "t2v-A14B": {"sizes": ["1280*720", "720*1280", "832*480", "480*832"]},
    "i2v-A14B": {"sizes": ["1280*720", "720*1280", "832*480", "480*832"]},
    "ti2v-5B": {"sizes": ["1280*704", "704*1280"]},
}


class Wan22Provider(VideoGenerationProvider):
    """Adapter for the official Wan-Video/Wan2.2 inference repository.

    Wan2.2 Desktop deliberately invokes the upstream generate.py entry point
    instead of copying the full model implementation into the desktop app.
    """

    @property
    def name(self) -> str:
        return "Wan 2.2"

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            text_to_video=True,
            image_to_video=True,
            cancellation=True,
        )

    @property
    def source_dir(self) -> Path | None:
        value = os.getenv("WAN22_SOURCE_DIR")
        return Path(value).expanduser().resolve() if value else None

    def is_ready(self) -> bool:
        root = self.source_dir
        return bool(root and (root / "generate.py").is_file())

    def build_command(
        self,
        *,
        task: str,
        checkpoint_dir: Path,
        prompt: str,
        size: str,
        output_path: Path,
        image_path: Path | None = None,
        seed: int = -1,
        sample_steps: int | None = None,
        offload_model: bool = True,
        convert_model_dtype: bool = True,
        t5_cpu: bool = True,
    ) -> list[str]:
        root = self.source_dir
        if root is None or not (root / "generate.py").is_file():
            raise RuntimeError(
                "WAN22_SOURCE_DIR is not configured or does not contain generate.py"
            )

        if task not in SUPPORTED_TASKS:
            raise ValueError(f"Unsupported Wan 2.2 task: {task}")

        if size not in SUPPORTED_TASKS[task]["sizes"]:
            raise ValueError(f"Unsupported size {size!r} for task {task}")

        if task == "i2v-A14B" and image_path is None:
            raise ValueError("i2v-A14B requires an input image")

        command = [
            sys.executable,
            str(root / "generate.py"),
            "--task",
            task,
            "--size",
            size,
            "--ckpt_dir",
            str(checkpoint_dir),
            "--prompt",
            prompt,
            "--base_seed",
            str(seed),
            "--save_file",
            str(output_path),
            "--offload_model",
            str(offload_model),
        ]

        if convert_model_dtype:
            command.append("--convert_model_dtype")

        if t5_cpu:
            command.append("--t5_cpu")

        if sample_steps is not None:
            command.extend(["--sample_steps", str(sample_steps)])

        if image_path is not None:
            command.extend(["--image", str(image_path)])

        return command
