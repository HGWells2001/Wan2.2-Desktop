from __future__ import annotations

from typing import Any


MODEL_PROFILES: dict[str, dict[str, Any]] = {
    "ti2v-5b": {
        "id": "ti2v-5b",
        "name": "Wan 2.2 TI2V 5B",
        "short_name": "TI2V 5B",
        "description": "Official Wan 2.2 hybrid 5B model. Fastest option and supports both text and image input.",
        "engine": "wan-upstream",
        "task": "ti2v-5B",
        "repo_id": "Wan-AI/Wan2.2-TI2V-5B",
        "folder_name": "Wan2.2-TI2V-5B",
        "modes": ["text", "image"],
        "sizes": ["1280*704", "704*1280"],
        "default_size": "1280*704",
        "quantization": None,
        "recommended": False,
        "experimental": False,
        "download_label": "Download Wan2.2 TI2V-5B",
        "vram_note": "24 GB class GPU recommended for the official low-memory path.",
    },
    "t2v-a14b-q4-k-m": {
        "id": "t2v-a14b-q4-k-m",
        "name": "Wan 2.2 T2V A14B · Q4_K_M",
        "short_name": "A14B Q4_K_M",
        "description": "Quantized 14B-active MoE text-to-video model. Recommended A14B profile for 24 GB GPUs.",
        "engine": "diffusers-gguf",
        "task": "t2v-A14B-GGUF",
        "repo_id": "QuantStack/Wan2.2-T2V-A14B-GGUF",
        "base_repo_id": "Wan-AI/Wan2.2-T2V-A14B-Diffusers",
        "folder_name": "Wan2.2-T2V-A14B-Q4_K_M",
        "modes": ["text"],
        "sizes": ["832*480", "480*832", "1280*720", "720*1280"],
        "default_size": "832*480",
        "quantization": "Q4_K_M",
        "high_noise_file": "HighNoise/Wan2.2-T2V-A14B-HighNoise-Q4_K_M.gguf",
        "low_noise_file": "LowNoise/Wan2.2-T2V-A14B-LowNoise-Q4_K_M.gguf",
        "recommended": True,
        "experimental": True,
        "download_label": "Download A14B Q4_K_M",
        "vram_note": "Recommended A14B choice for RTX 3090 24 GB. Uses CPU offload and PyTorch SDPA.",
    },
    "t2v-a14b-q5-k-m": {
        "id": "t2v-a14b-q5-k-m",
        "name": "Wan 2.2 T2V A14B · Q5_K_M",
        "short_name": "A14B Q5_K_M",
        "description": "Higher-fidelity quantized 14B-active MoE text-to-video profile with a larger memory footprint.",
        "engine": "diffusers-gguf",
        "task": "t2v-A14B-GGUF",
        "repo_id": "QuantStack/Wan2.2-T2V-A14B-GGUF",
        "base_repo_id": "Wan-AI/Wan2.2-T2V-A14B-Diffusers",
        "folder_name": "Wan2.2-T2V-A14B-Q5_K_M",
        "modes": ["text"],
        "sizes": ["832*480", "480*832", "1280*720", "720*1280"],
        "default_size": "832*480",
        "quantization": "Q5_K_M",
        "high_noise_file": "HighNoise/Wan2.2-T2V-A14B-HighNoise-Q5_K_M.gguf",
        "low_noise_file": "LowNoise/Wan2.2-T2V-A14B-LowNoise-Q5_K_M.gguf",
        "recommended": False,
        "experimental": True,
        "download_label": "Download A14B Q5_K_M",
        "vram_note": "Higher quality than Q4_K_M but tighter on a 24 GB card. CPU offload is enabled.",
    },
}


def get_model_profile(model_id: str) -> dict[str, Any]:
    try:
        return MODEL_PROFILES[model_id]
    except KeyError as exc:
        raise ValueError(f"Unknown model profile: {model_id}") from exc


def public_model_catalog() -> list[dict[str, Any]]:
    keys = (
        "id",
        "name",
        "short_name",
        "description",
        "engine",
        "task",
        "modes",
        "sizes",
        "default_size",
        "quantization",
        "recommended",
        "experimental",
        "download_label",
        "vram_note",
    )
    return [{key: profile.get(key) for key in keys} for profile in MODEL_PROFILES.values()]
