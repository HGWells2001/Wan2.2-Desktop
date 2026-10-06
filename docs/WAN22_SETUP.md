# Wan 2.2 runtime setup

Wan2.2 Desktop integrates with the official upstream project rather than
vendoring its full inference implementation.

Upstream:

- https://github.com/Wan-Video/Wan2.2

## Recommended first target

The first desktop target is **Wan2.2-TI2V-5B** because upstream supports both
text-to-video and image-to-video with this model at 720p-class output and
documents single-GPU operation with 24 GB VRAM when model offloading, dtype
conversion and T5 CPU placement are enabled.

Supported upstream TI2V sizes:

- 1280×704
- 704×1280

The A14B T2V and I2V models are exposed by the backend as advanced options,
but upstream documents substantially higher VRAM requirements for the simple
single-GPU T2V-A14B path.

## Development installation

1. Clone the official Wan repository outside this project.

```powershell
git clone https://github.com/Wan-Video/Wan2.2.git C:\AI\Wan2.2
```

2. Create a Python environment compatible with the upstream requirements.

3. Install the upstream Wan requirements. Upstream currently requires
   PyTorch 2.4 or newer and lists Diffusers, Transformers, Accelerate,
   Flash Attention and its other inference dependencies.

4. Download the TI2V-5B checkpoint, for example using Hugging Face CLI.

```powershell
huggingface-cli download Wan-AI/Wan2.2-TI2V-5B --local-dir C:\AI\models\Wan2.2-TI2V-5B
```

5. Set the runtime path before launching the backend.

```powershell
$env:WAN22_SOURCE_DIR = "C:\AI\Wan2.2"
```

## API flow

The desktop backend now exposes:

- `GET /api/hardware`
- `GET /api/provider`
- `POST /api/generations`
- `GET /api/generations/{id}`
- `POST /api/generations/{id}/cancel`

Generation is executed through the upstream `generate.py` CLI. Keeping that
boundary means upstream Wan can evolve independently while the desktop API
remains stable.
