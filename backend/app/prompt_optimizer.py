from __future__ import annotations

import gc
from pathlib import Path
import random
import re
import sys


QWEN_PROMPT_MODEL = "Qwen2.5_3B"


def _clean_prompt(prompt: str) -> str:
    return re.sub(r"\s+", " ", prompt).strip()


def optimize_prompt_fast(prompt: str, video_mode: str) -> str:
    base = _clean_prompt(prompt).rstrip(" .")

    if video_mode == "image":
        guidance = (
            "Preserve the reference image's subject identity, facial features, clothing, "
            "colors, composition, and environment. Animate the scene with coherent, "
            "physically believable motion and natural secondary movement. Use smooth "
            "temporal continuity, stable geometry, realistic lighting, consistent details, "
            "and purposeful cinematic camera motion. Keep the original scene recognizable "
            "throughout the shot."
        )
    else:
        guidance = (
            "Cinematic video with a clearly readable subject and action, coherent natural "
            "motion, physically believable movement, stable identity and geometry, detailed "
            "environment, realistic lighting and depth, smooth temporal continuity, subtle "
            "secondary motion, and purposeful camera movement. Keep the scene consistent "
            "throughout the shot."
        )

    return f"{base}. {guidance}"


def _ai_system_prompt(video_mode: str) -> str:
    common = (
        "You optimize prompts specifically for Wan2.2 TI2V-5B video generation. "
        "Rewrite the user's idea as one polished English video prompt. Preserve the user's "
        "intent and all explicit facts. Add only useful visual detail: subject action, "
        "environment, temporal motion, camera behavior, lighting, atmosphere, depth, and "
        "continuity. Prefer concrete visual language over abstract adjectives. Describe a "
        "single coherent shot unless the user explicitly asks for cuts. Do not add titles, "
        "subtitles, watermarks, explanations, bullet points, negative prompts, or quotation "
        "marks. Return only the final optimized prompt."
    )

    if video_mode == "image":
        return common + (
            " The generation uses a reference image. Do not reinvent the subject's identity, "
            "appearance, clothing, colors, composition, or scene. Focus on plausible motion, "
            "camera movement, lighting changes, environmental motion, and temporal continuity "
            "that preserve the reference image."
        )

    return common + (
        " The generation is text-to-video. You may add restrained visual specifics when they "
        "help make the requested scene unambiguous, but never change the core subject or event."
    )


def optimize_prompt_ai(
    prompt: str,
    video_mode: str,
    *,
    wan_source: Path,
    seed: int = -1,
) -> tuple[str, str]:
    if not wan_source.is_dir():
        raise RuntimeError("Wan runtime directory was not found.")

    source_text = str(wan_source)
    if source_text not in sys.path:
        sys.path.insert(0, source_text)

    import torch
    from wan.utils.prompt_extend import QwenPromptExpander

    resolved_seed = seed if seed >= 0 else random.randint(0, sys.maxsize)
    device = "cuda:0" if torch.cuda.is_available() else "cpu"

    expander = None
    try:
        expander = QwenPromptExpander(
            model_name=QWEN_PROMPT_MODEL,
            task="ti2v-5B",
            device=device,
            is_vl=False,
        )
        result = expander(
            _clean_prompt(prompt),
            system_prompt=_ai_system_prompt(video_mode),
            tar_lang="en",
            seed=resolved_seed,
        )

        if not result.status or not result.prompt.strip():
            raise RuntimeError(result.message or "Qwen prompt optimization failed.")

        return result.prompt.strip(), device
    finally:
        if expander is not None:
            del expander
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
