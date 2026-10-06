from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys


def module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wan-source", required=True)
    args = parser.parse_args()

    wan_source = Path(args.wan_source).expanduser().resolve()
    checks: dict[str, object] = {
        "python": sys.version.split()[0],
        "wanSource": str(wan_source),
        "generatePy": (wan_source / "generate.py").is_file(),
        "torch": module_available("torch"),
        "wan": module_available("wan"),
        "fastapi": module_available("fastapi"),
        "uvicorn": module_available("uvicorn"),
        "huggingfaceHub": module_available("huggingface_hub"),
        "flashAttention": module_available("flash_attn"),
    }

    if checks["torch"]:
        import torch

        checks["torchVersion"] = torch.__version__
        checks["cudaAvailable"] = torch.cuda.is_available()
        checks["cudaVersion"] = torch.version.cuda

        if torch.cuda.is_available():
            checks["gpuName"] = torch.cuda.get_device_name(0)
            checks["gpuCount"] = torch.cuda.device_count()
        else:
            checks["cudaDiagnostic"] = (
                "PyTorch is installed but torch.cuda.is_available() returned false. "
                "Check NVIDIA driver compatibility and the installed CUDA-enabled torch wheel."
            )
    else:
        checks["cudaAvailable"] = False
        checks["cudaDiagnostic"] = "PyTorch is not installed."

    # The managed environment is usable as long as the Python/backend/Wan stack
    # exists. CUDA readiness is reported separately so the desktop can start and
    # show diagnostics instead of treating the whole setup as failed.
    checks["environmentReady"] = all(
        [
            bool(checks["generatePy"]),
            bool(checks["torch"]),
            bool(checks["wan"]),
            bool(checks["fastapi"]),
            bool(checks["uvicorn"]),
            bool(checks["huggingfaceHub"]),
        ]
    )
    checks["ok"] = bool(checks["environmentReady"])

    print(json.dumps(checks))
    return 0 if checks["environmentReady"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
