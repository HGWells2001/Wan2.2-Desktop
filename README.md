# Wan2.2 Desktop

**Wan2.2 Desktop** is a community-driven desktop application for running **Wan 2.2** video generation locally, inspired by the architecture and desktop workflow of [LTX Desktop](https://github.com/Lightricks/LTX-Desktop).

> **Status:** early development / architecture bootstrap.

## Goals

- Native desktop experience based on Electron + React
- Python backend for local inference
- Wan 2.2 text-to-video workflows
- Wan 2.2 image-to-video workflows
- Local model management
- NVIDIA GPU support as the first target
- Generation queue, progress, preview and output management
- LoRA support where compatible with the Wan 2.2 stack
- Reusable editor-oriented workflow inspired by LTX Desktop

## Architecture direction

Wan2.2 Desktop is being designed around a split architecture:

```text
Electron desktop shell
        |
React / TypeScript UI
        |
Local HTTP / IPC bridge
        |
Python API backend
        |
Wan 2.2 inference adapter
        |
PyTorch / CUDA
```

The project will keep model-specific code isolated behind a provider/inference layer so that the desktop UI is not tightly coupled to a single Wan implementation.

## Initial roadmap

### Phase 1 - Bootstrap
- [x] Create project repository
- [x] Define project identity and attribution
- [ ] Import/adapt the desktop shell architecture
- [ ] Establish frontend/backend development workflow
- [ ] Add hardware capability detection

### Phase 2 - Wan 2.2 backend
- [ ] Define a Wan 2.2 inference provider interface
- [ ] Model discovery/download management
- [ ] Text-to-video inference
- [ ] Image-to-video inference
- [ ] CUDA/VRAM-aware loading and unloading
- [ ] Generation progress and cancellation

### Phase 3 - Desktop UX
- [ ] Generation workspace
- [ ] Prompt and generation settings
- [ ] Model selector
- [ ] Output gallery
- [ ] Video preview
- [ ] Persistent settings

### Phase 4 - Advanced workflows
- [ ] LoRA support
- [ ] Queue/batch generation
- [ ] Video editor integration
- [ ] Performance presets
- [ ] Installer and automatic updates

## Relationship to LTX Desktop

This is **not an official Lightricks project** and is **not affiliated with the Wan project**.

LTX Desktop is used as an architectural and UX reference. Portions adapted from LTX Desktop must retain their original Apache-2.0 notices and attribution.

Upstream project:

- LTX Desktop: https://github.com/Lightricks/LTX-Desktop

## License

Apache License 2.0. See [LICENSE](LICENSE).

Third-party components and adapted upstream code retain their respective copyright and license notices.
