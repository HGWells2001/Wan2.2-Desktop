# Wan2.2 Desktop backend

Development launch:

```bash
cd backend
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

The backend intentionally exposes a provider boundary before importing any
specific Wan inference package. This keeps the desktop API stable while the
Wan 2.2 runtime integration evolves.
