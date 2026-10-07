from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class GenerationRequest(BaseModel):
    task: str = "ti2v-5B"
    prompt: str = Field(min_length=1, max_length=8000)
    checkpoint_dir: str
    size: str = "1280*704"
    image_path: str | None = None
    seed: int = -1
    sample_steps: int | None = Field(default=None, ge=1, le=200)
    offload_model: bool = True
    convert_model_dtype: bool = True
    t5_cpu: bool = True


class ModelDownloadRequest(BaseModel):
    repo_id: str = "Wan-AI/Wan2.2-TI2V-5B"
    destination: str


class PromptOptimizationRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    optimizer: Literal["fast", "ai"] = "fast"
    video_mode: Literal["text", "image"] = "text"
    seed: int = -1
