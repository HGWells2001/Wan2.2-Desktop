from __future__ import annotations

from pathlib import Path
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .hardware import detect_hardware_dict
from .jobs import JobManager
from .providers.wan22 import SUPPORTED_TASKS, Wan22Provider
from .schemas import GenerationRequest

app = FastAPI(title="Wan2.2 Desktop Backend", version="0.2.0")
provider = Wan22Provider()
jobs = JobManager()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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


@app.post("/api/generations")
def create_generation(request: GenerationRequest) -> dict[str, object]:
    checkpoint_dir = Path(request.checkpoint_dir).expanduser().resolve()
    if not checkpoint_dir.is_dir():
        raise HTTPException(status_code=400, detail="Checkpoint directory not found")

    image_path = None
    if request.image_path:
        image_path = Path(request.image_path).expanduser().resolve()
        if not image_path.is_file():
            raise HTTPException(status_code=400, detail="Input image not found")

    output_root = Path(
        os.getenv("WAN22_OUTPUT_DIR", Path.home() / "Wan2.2-Desktop" / "outputs")
    ).expanduser()
    output_root.mkdir(parents=True, exist_ok=True)
    output_path = output_root / "pending.mp4"

    try:
        command = provider.build_command(
            task=request.task,
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
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Allocate the final filename before launching the process.
    import uuid

    generation_id = uuid.uuid4().hex
    output_path = output_root / f"{generation_id}.mp4"
    command[command.index("--save_file") + 1] = str(output_path)

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
