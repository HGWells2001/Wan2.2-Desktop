from __future__ import annotations

from dataclasses import asdict, dataclass
import platform
import shutil
import subprocess


@dataclass(frozen=True)
class GpuInfo:
    name: str
    total_vram_mb: int | None
    driver_version: str | None


@dataclass(frozen=True)
class HardwareInfo:
    os: str
    machine: str
    cuda_available: bool
    gpus: list[GpuInfo]


def _query_nvidia_smi() -> list[GpuInfo]:
    if shutil.which("nvidia-smi") is None:
        return []

    command = [
        "nvidia-smi",
        "--query-gpu=name,memory.total,driver_version",
        "--format=csv,noheader,nounits",
    ]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return []

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
            )
        )

    return gpus


def detect_hardware() -> HardwareInfo:
    gpus = _query_nvidia_smi()
    return HardwareInfo(
        os=platform.platform(),
        machine=platform.machine(),
        cuda_available=bool(gpus),
        gpus=gpus,
    )


def detect_hardware_dict() -> dict[str, object]:
    return asdict(detect_hardware())
