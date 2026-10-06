from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess


@dataclass(frozen=True)
class GpuInfo:
    name: str
    total_vram_mb: int | None
    driver_version: str | None
    source: str


@dataclass(frozen=True)
class HardwareInfo:
    os: str
    machine: str
    nvidia_gpu_detected: bool
    nvidia_driver_detected: bool
    cuda_available: bool
    cuda_version: str | None
    torch_available: bool
    torch_version: str | None
    detection_sources: list[str]
    diagnostics: list[str]
    gpus: list[GpuInfo]


def _nvidia_smi_candidates() -> list[str]:
    candidates: list[str] = []

    found = shutil.which("nvidia-smi")
    if found:
        candidates.append(found)

    system_root = os.environ.get("SystemRoot", r"C:\Windows")
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")

    common = [
        Path(system_root) / "System32" / "nvidia-smi.exe",
        Path(program_files) / "NVIDIA Corporation" / "NVSMI" / "nvidia-smi.exe",
    ]

    for candidate in common:
        if candidate.is_file():
            value = str(candidate)
            if value not in candidates:
                candidates.append(value)

    return candidates


def _query_nvidia_smi() -> tuple[list[GpuInfo], list[str]]:
    diagnostics: list[str] = []

    for executable in _nvidia_smi_candidates():
        command = [
            executable,
            "--query-gpu=name,memory.total,driver_version",
            "--format=csv,noheader,nounits",
        ]

        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                check=True,
                timeout=8,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (OSError, subprocess.SubprocessError) as exc:
            diagnostics.append(f"nvidia-smi failed at {executable}: {exc}")
            continue

        gpus: list[GpuInfo] = []
        for line in result.stdout.splitlines():
            parts = [part.strip() for part in line.split(",")]
            if len(parts) != 3:
                continue

            name, memory, driver = parts
            try:
                memory_mb = int(memory)
            except ValueError:
                memory_mb = None

            gpus.append(
                GpuInfo(
                    name=name,
                    total_vram_mb=memory_mb,
                    driver_version=driver or None,
                    source="nvidia-smi",
                )
            )

        if gpus:
            diagnostics.append(f"nvidia-smi detected {len(gpus)} NVIDIA GPU(s)")
            return gpus, diagnostics

    if not _nvidia_smi_candidates():
        diagnostics.append("nvidia-smi.exe was not found in PATH or common NVIDIA locations")

    return [], diagnostics


def _query_torch() -> tuple[list[GpuInfo], bool, str | None, str | None, list[str]]:
    diagnostics: list[str] = []

    try:
        import torch
    except Exception as exc:
        diagnostics.append(f"PyTorch import unavailable: {exc}")
        return [], False, None, None, diagnostics

    torch_version = getattr(torch, "__version__", None)
    cuda_version = getattr(torch.version, "cuda", None)

    try:
        cuda_available = bool(torch.cuda.is_available())
    except Exception as exc:
        diagnostics.append(f"torch.cuda.is_available() failed: {exc}")
        return [], False, torch_version, cuda_version, diagnostics

    if not cuda_available:
        diagnostics.append(
            f"PyTorch {torch_version or 'unknown'} loaded, but CUDA is not available"
        )
        return [], False, torch_version, cuda_version, diagnostics

    gpus: list[GpuInfo] = []
    try:
        count = torch.cuda.device_count()
        for index in range(count):
            props = torch.cuda.get_device_properties(index)
            total_memory = getattr(props, "total_memory", None)
            total_vram_mb = (
                int(total_memory // (1024 * 1024))
                if isinstance(total_memory, int)
                else None
            )
            gpus.append(
                GpuInfo(
                    name=torch.cuda.get_device_name(index),
                    total_vram_mb=total_vram_mb,
                    driver_version=None,
                    source="pytorch",
                )
            )

        diagnostics.append(
            f"PyTorch CUDA detected {len(gpus)} GPU(s), CUDA runtime {cuda_version or 'unknown'}"
        )
    except Exception as exc:
        diagnostics.append(f"PyTorch GPU enumeration failed: {exc}")

    return gpus, True, torch_version, cuda_version, diagnostics


def _query_windows_cim() -> tuple[list[GpuInfo], list[str]]:
    if platform.system() != "Windows":
        return [], []

    script = (
        "Get-CimInstance Win32_VideoController | "
        "Where-Object { $_.Name -match 'NVIDIA' } | "
        "Select-Object Name,DriverVersion | ConvertTo-Json -Compress"
    )

    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            check=True,
            timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return [], [f"Windows CIM GPU query failed: {exc}"]

    raw = result.stdout.strip()
    if not raw:
        return [], ["Windows CIM found no NVIDIA display adapter"]

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return [], [f"Windows CIM returned invalid JSON: {exc}"]

    if isinstance(data, dict):
        items = [data]
    elif isinstance(data, list):
        items = data
    else:
        items = []

    gpus = [
        GpuInfo(
            name=str(item.get("Name") or "NVIDIA GPU"),
            total_vram_mb=None,
            driver_version=(
                str(item["DriverVersion"]) if item.get("DriverVersion") else None
            ),
            source="windows-cim",
        )
        for item in items
    ]

    diagnostics = (
        [f"Windows CIM detected {len(gpus)} NVIDIA GPU(s)"]
        if gpus
        else ["Windows CIM found no NVIDIA display adapter"]
    )
    return gpus, diagnostics


def _merge_gpus(*groups: list[GpuInfo]) -> list[GpuInfo]:
    merged: dict[str, GpuInfo] = {}

    for group in groups:
        for gpu in group:
            key = gpu.name.strip().lower()
            existing = merged.get(key)
            if existing is None:
                merged[key] = gpu
                continue

            merged[key] = GpuInfo(
                name=existing.name,
                total_vram_mb=existing.total_vram_mb or gpu.total_vram_mb,
                driver_version=existing.driver_version or gpu.driver_version,
                source=f"{existing.source}+{gpu.source}",
            )

    return list(merged.values())


def detect_hardware() -> HardwareInfo:
    smi_gpus, smi_diag = _query_nvidia_smi()
    torch_gpus, torch_cuda, torch_version, cuda_version, torch_diag = _query_torch()
    cim_gpus, cim_diag = _query_windows_cim()

    gpus = _merge_gpus(torch_gpus, smi_gpus, cim_gpus)
    sources = sorted(
        {
            part
            for gpu in gpus
            for part in gpu.source.split("+")
        }
    )

    nvidia_driver_detected = any(
        gpu.driver_version for gpu in gpus
    ) or bool(smi_gpus)

    return HardwareInfo(
        os=platform.platform(),
        machine=platform.machine(),
        nvidia_gpu_detected=bool(gpus),
        nvidia_driver_detected=nvidia_driver_detected,
        cuda_available=torch_cuda,
        cuda_version=cuda_version,
        torch_available=torch_version is not None,
        torch_version=torch_version,
        detection_sources=sources,
        diagnostics=[*torch_diag, *smi_diag, *cim_diag],
        gpus=gpus,
    )


def detect_hardware_dict() -> dict[str, object]:
    return asdict(detect_hardware())
