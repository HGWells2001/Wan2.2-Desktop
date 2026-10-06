# Architecture

## Design objective

Keep the desktop application independent from Wan-specific inference details.

## Proposed layers

### 1. Desktop shell
Electron owns application lifecycle, native dialogs, updates and process
management.

### 2. Frontend
React + TypeScript provides generation controls, model management, settings,
queue state and media previews.

### 3. Backend API
A local Python service exposes a stable API to the desktop application.

The frontend should communicate in terms of jobs and capabilities rather than
calling model internals directly.

### 4. Inference provider

A provider interface will translate application requests into Wan 2.2
inference operations.

Proposed shape:

```python
class VideoGenerationProvider:
    def capabilities(self): ...
    def load_model(self, model_id, options): ...
    def unload_model(self): ...
    def text_to_video(self, request): ...
    def image_to_video(self, request): ...
    def cancel(self, job_id): ...
```

### 5. Runtime
Initial runtime target:

- Python
- PyTorch
- CUDA
- NVIDIA GPUs

Alternative runtimes can be added later without redesigning the frontend.

## Compatibility strategy

The first implementation should not hard-code a single Wan repository layout.
Instead, model/runtime-specific code belongs under a dedicated adapter so we
can support upstream changes and alternative Wan 2.2 loaders without rewriting
the application.
