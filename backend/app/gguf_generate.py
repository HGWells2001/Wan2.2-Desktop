from __future__ import annotations

import argparse
import gc
import inspect
import json
from pathlib import Path
import sys

import torch


DEFAULT_NEGATIVE_PROMPT = (
    "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，"
    "最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，"
    "画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，"
    "杂乱的背景，三条腿，背景人很多，倒着走"
)


def _read_manifest(model_dir: Path) -> dict[str, object]:
    manifest_path = model_dir / "wan2-desktop-model.json"
    if not manifest_path.is_file():
        raise RuntimeError(
            f"A14B model manifest not found: {manifest_path}. "
            "Download the A14B profile from Wan2.2 Desktop."
        )
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def _patch_diffusers_meta_dispatch() -> None:
    """Work around the Wan GGUF non-persistent RoPE meta-buffer loader bug.

    QuantStack Wan2.2 T2V GGUF checkpoints do not store deterministic RoPE
    buffers. Diffusers creates the model under init_empty_weights(), so those
    buffers can remain on the meta device before Accelerate dispatches the
    model. This re-materializes only non-persistent buffers. Missing parameters
    are treated as an error rather than silently zero-filled.
    """

    import diffusers.loaders.single_file_model as single_file_model
    from accelerate.utils import set_module_tensor_to_device

    if getattr(single_file_model, "_wan22_desktop_meta_patch", False):
        return

    original_dispatch = single_file_model.dispatch_model

    def patched_dispatch(model, *args, **kwargs):
        device_map = kwargs.get("device_map")
        if device_map is None and args:
            device_map = args[0]

        target_device = "cpu"
        if isinstance(device_map, dict) and device_map:
            target_device = next(iter(device_map.values()))

        modules_to_reinit: set[str] = set()

        for name, buffer in list(model.named_buffers()):
            if buffer.device.type != "meta":
                continue

            parent_path, _, buffer_name = name.rpartition(".")
            submodule = model.get_submodule(parent_path) if parent_path else model
            is_persistent = buffer_name not in submodule._non_persistent_buffers_set

            if is_persistent:
                raise RuntimeError(
                    f"Persistent buffer {name!r} is missing from the GGUF checkpoint."
                )

            modules_to_reinit.add(parent_path)

        for module_path in sorted(modules_to_reinit):
            submodule = model.get_submodule(module_path) if module_path else model
            if not module_path:
                raise RuntimeError("Cannot safely re-create the root Wan transformer module.")

            parent_path, _, child_name = module_path.rpartition(".")
            parent = model.get_submodule(parent_path) if parent_path else model
            cls = type(submodule)
            signature = inspect.signature(cls.__init__)
            init_args: dict[str, object] = {}

            for param_name, param in signature.parameters.items():
                if param_name == "self":
                    continue
                if hasattr(submodule, param_name):
                    init_args[param_name] = getattr(submodule, param_name)
                elif param.default is inspect.Parameter.empty:
                    raise RuntimeError(
                        f"Cannot reconstruct GGUF helper module {module_path!r}; "
                        f"missing constructor attribute {param_name!r}."
                    )

            print(
                f"[Wan2.2 Desktop] Re-materializing {module_path} "
                f"({cls.__name__}) for GGUF loading..."
            )
            replacement = cls(**init_args)
            setattr(parent, child_name, replacement)

        remaining_meta_buffers = [
            name for name, value in model.named_buffers() if value.device.type == "meta"
        ]
        remaining_meta_params = [
            name for name, value in model.named_parameters() if value.device.type == "meta"
        ]

        if remaining_meta_buffers or remaining_meta_params:
            raise RuntimeError(
                "GGUF loading left unresolved meta tensors. "
                f"buffers={remaining_meta_buffers[:8]}, "
                f"parameters={remaining_meta_params[:8]}"
            )

        # New helper modules are CPU tensors; keep them aligned with the dispatch target.
        for name, buffer in list(model.named_buffers()):
            if buffer.device.type == "cpu" and str(target_device) != "cpu":
                try:
                    set_module_tensor_to_device(model, name, target_device, value=buffer)
                except Exception:
                    pass

        return original_dispatch(model, *args, **kwargs)

    single_file_model.dispatch_model = patched_dispatch
    single_file_model._wan22_desktop_meta_patch = True


def _resolve_gguf_paths(model_dir: Path, manifest: dict[str, object]) -> tuple[Path, Path, Path]:
    quant_dir = model_dir / "quantized"
    base_dir = model_dir / "base"
    high_rel = str(manifest.get("high_noise_file") or "")
    low_rel = str(manifest.get("low_noise_file") or "")

    high = quant_dir / high_rel
    low = quant_dir / low_rel

    for label, path in (("HighNoise", high), ("LowNoise", low)):
        if not path.is_file():
            raise RuntimeError(f"{label} GGUF file not found: {path}")

    if not (base_dir / "model_index.json").is_file():
        raise RuntimeError(f"A14B Diffusers base components are incomplete: {base_dir}")

    return high, low, base_dir


def generate(
    *,
    model_dir: Path,
    prompt: str,
    output_file: Path,
    width: int,
    height: int,
    num_frames: int,
    num_inference_steps: int,
    guidance_scale: float,
    seed: int,
) -> None:
    if not torch.cuda.is_available():
        raise RuntimeError("A14B GGUF generation requires an NVIDIA CUDA GPU.")

    from diffusers import (
        AutoencoderKLWan,
        GGUFQuantizationConfig,
        WanPipeline,
        WanTransformer3DModel,
    )
    from diffusers.utils import export_to_video

    manifest = _read_manifest(model_dir)
    if manifest.get("engine") != "diffusers-gguf":
        raise RuntimeError("Selected model directory is not an A14B GGUF profile.")

    high_path, low_path, base_dir = _resolve_gguf_paths(model_dir, manifest)
    _patch_diffusers_meta_dispatch()

    dtype = torch.bfloat16
    quant_config = GGUFQuantizationConfig(compute_dtype=dtype)

    print(f"[Wan2.2 Desktop] Loading A14B HighNoise GGUF: {high_path}")
    high_noise = WanTransformer3DModel.from_single_file(
        str(high_path),
        config=str(base_dir),
        subfolder="transformer",
        quantization_config=quant_config,
        dtype=dtype,
        local_files_only=True,
    )

    print(f"[Wan2.2 Desktop] Loading A14B LowNoise GGUF: {low_path}")
    low_noise = WanTransformer3DModel.from_single_file(
        str(low_path),
        config=str(base_dir),
        subfolder="transformer_2",
        quantization_config=GGUFQuantizationConfig(compute_dtype=dtype),
        dtype=dtype,
        local_files_only=True,
    )

    print("[Wan2.2 Desktop] Loading A14B VAE and text pipeline...")
    vae = AutoencoderKLWan.from_pretrained(
        str(base_dir),
        subfolder="vae",
        dtype=torch.float32,
        local_files_only=True,
    )

    pipe = WanPipeline.from_pretrained(
        str(base_dir),
        transformer=high_noise,
        transformer_2=low_noise,
        vae=vae,
        dtype=dtype,
        local_files_only=True,
    )

    # Component-level CPU offload keeps only the active denoiser on the GPU.
    pipe.enable_model_cpu_offload(gpu_id=0)

    if hasattr(torch.backends.cuda.matmul, "allow_tf32"):
        torch.backends.cuda.matmul.allow_tf32 = True

    resolved_seed = seed if seed >= 0 else torch.seed()
    generator = torch.Generator(device="cpu").manual_seed(resolved_seed)

    print(
        "[Wan2.2 Desktop] Generating video "
        f"{width}x{height}, {num_frames} frames, {num_inference_steps} steps..."
    )

    with torch.inference_mode():
        result = pipe(
            prompt=prompt,
            negative_prompt=DEFAULT_NEGATIVE_PROMPT,
            height=height,
            width=width,
            num_frames=num_frames,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            guidance_scale_2=guidance_scale,
            generator=generator,
        )

    output_file.parent.mkdir(parents=True, exist_ok=True)
    print(f"[Wan2.2 Desktop] Saving generated video to {output_file}")
    export_to_video(result.frames[0], str(output_file), fps=16)
    print("[Wan2.2 Desktop] Finished.")

    del result, pipe, vae, high_noise, low_noise
    gc.collect()
    torch.cuda.empty_cache()


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate video with Wan2.2 A14B GGUF")
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--save-file", required=True)
    parser.add_argument("--size", default="832*480")
    parser.add_argument("--frame-num", type=int, default=81)
    parser.add_argument("--sample-steps", type=int, default=40)
    parser.add_argument("--guide-scale", type=float, default=5.0)
    parser.add_argument("--seed", type=int, default=-1)
    args = parser.parse_args()

    width_text, height_text = args.size.split("*", 1)
    generate(
        model_dir=Path(args.model_dir).expanduser().resolve(),
        prompt=args.prompt,
        output_file=Path(args.save_file).expanduser().resolve(),
        width=int(width_text),
        height=int(height_text),
        num_frames=args.frame_num,
        num_inference_steps=args.sample_steps,
        guidance_scale=args.guide_scale,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
