from __future__ import annotations

from pathlib import Path
import os
import sys

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .hardware import detect_hardware_dict
from .jobs import JobManager
from .model_profiles import get_model_profile, public_model_catalog
from .prompt_optimizer import optimize_prompt_ai, optimize_prompt_fast
from .providers.a14b_gguf import build_command as build_a14b_gguf_command
from .providers.wan22 import SUPPORTED_TASKS, Wan22Provider
from .schemas import GenerationRequest, ModelDownloadRequest, PromptOptimizationRequest

app = FastAPI(title="Wan2.2 Desktop Backend", version="0.2.8")
provider = Wan22Provider()
jobs = JobManager()
model_downloads = JobManager()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "null",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "backend": "Wan2.2 Desktop Backend",
        "provider": provider.name,
        "providerReady": provider.is_ready(),
        "capabilities": provider.capabilities().__dict__,
    }


@app.get("/api/hardware")
def hardware() -> dict[str, object]:
    return detect_hardware_dict()


@app.get("/api/provider")
def provider_info() -> dict[str, object]:
    return {
        "name": provider.name,
        "ready": provider.is_ready(),
        "sourceDir": str(provider.source_dir) if provider.source_dir else None,
        "tasks": SUPPORTED_TASKS,
    }


@app.get("/api/models")
def model_catalog() -> dict[str, object]:
    return {
        "defaultModelId": "ti2v-5b",
        "models": public_model_catalog(),
    }




@app.post("/api/prompts/optimize")
def optimize_prompt(request: PromptOptimizationRequest) -> dict[str, object]:
    original = request.prompt.strip()

    if request.optimizer == "fast":
        optimized = optimize_prompt_fast(original, request.video_mode)
        return {
            "original_prompt": original,
            "optimized_prompt": optimized,
            "optimizer": "fast",
            "model": None,
            "message": "Fast optimizer applied. No additional AI model was loaded.",
        }

    root = provider.source_dir
    if root is None or not root.is_dir():
        raise HTTPException(status_code=400, detail="Install the Wan runtime before using AI prompt optimization.")

    try:
        optimized, device = optimize_prompt_ai(
            original,
            request.video_mode,
            wan_source=root,
            seed=request.seed,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"AI prompt optimization failed: {exc}",
        ) from exc

    return {
        "original_prompt": original,
        "optimized_prompt": optimized,
        "optimizer": "ai",
        "model": "Qwen/Qwen2.5-3B-Instruct",
        "device": device,
        "message": (
            "AI optimizer applied with Qwen2.5-3B-Instruct. "
            "The first use may download the model from Hugging Face."
        ),
    }


@app.post("/api/generations")
def create_generation(request: GenerationRequest) -> dict[str, object]:
    checkpoint_dir = Path(request.checkpoint_dir).expanduser().resolve()
    if not checkpoint_dir.is_dir():
        raise HTTPException(status_code=400, detail="Checkpoint directory not found")

    try:
        profile = get_model_profile(request.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    image_path = None
    if request.image_path:
        image_path = Path(request.image_path).expanduser().resolve()
        if not image_path.is_file():
            raise HTTPException(status_code=400, detail="Input image not found")

    mode = "image" if image_path is not None else "text"
    if mode not in profile["modes"]:
        raise HTTPException(
            status_code=400,
            detail=f"{profile['name']} does not support {mode}-to-video in this build.",
        )

    if request.size not in profile["sizes"]:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported size {request.size!r} for {profile['name']}.",
        )

    output_root = Path(
        os.getenv("WAN22_OUTPUT_DIR", Path.home() / "Wan2.2-Desktop" / "outputs")
    ).expanduser()
    output_root.mkdir(parents=True, exist_ok=True)

    import uuid

    generation_id = uuid.uuid4().hex
    output_path = output_root / f"{generation_id}.mp4"

    try:
        if profile["engine"] == "wan-upstream":
            command = provider.build_command(
                task=str(profile["task"]),
                checkpoint_dir=checkpoint_dir,
                prompt=request.prompt,
                size=request.size,
                output_path=output_path,
                image_path=image_path,
                seed=request.seed,
                sample_steps=request.sample_steps,
                offload_model=request.offload_model,
                convert_model_dtype=request.convert_model_dtype,
                t5_cpu=request.t5_cpu,
            )
        elif profile["engine"] == "diffusers-gguf":
            command = build_a14b_gguf_command(
                model_id=request.model_id,
                model_dir=checkpoint_dir,
                prompt=request.prompt,
                size=request.size,
                output_path=output_path,
                seed=request.seed,
                sample_steps=request.sample_steps,
            )
        else:
            raise ValueError(f"Unsupported model engine: {profile['engine']}")
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    job = jobs.create(command=command, output_path=output_path)
    return job.public_dict()


@app.get("/api/generations/{job_id}")
def get_generation(job_id: str) -> dict[str, object]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Generation job not found")
    return job.public_dict()


@app.post("/api/generations/{job_id}/cancel")
def cancel_generation(job_id: str) -> dict[str, object]:
    if not jobs.cancel(job_id):
        raise HTTPException(status_code=409, detail="Job cannot be cancelled")
    job = jobs.get(job_id)
    assert job is not None
    return job.public_dict()


@app.post("/api/models/download")
def download_model(request: ModelDownloadRequest) -> dict[str, object]:
    destination = Path(request.destination).expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)

    try:
        profile = get_model_profile(request.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    model_dir = destination / str(profile["folder_name"])
    command = [
        sys.executable,
        "-m",
        "app.model_download",
        "--model-id",
        request.model_id,
        "--local-dir",
        str(model_dir),
    ]

    job = model_downloads.create(command=command, output_path=model_dir)
    return job.public_dict()


@app.get("/api/models/download/{job_id}")
def get_model_download(job_id: str) -> dict[str, object]:
    job = model_downloads.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Model download job not found")
    return job.public_dict()


@app.post("/api/models/download/{job_id}/cancel")
def cancel_model_download(job_id: str) -> dict[str, object]:
    if not model_downloads.cancel(job_id):
        raise HTTPException(status_code=409, detail="Download cannot be cancelled")
    job = model_downloads.get(job_id)
    assert job is not None
    return job.public_dict()
