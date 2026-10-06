from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .providers.wan22 import Wan22Provider

app = FastAPI(title="Wan2.2 Desktop Backend", version="0.1.0")
provider = Wan22Provider()

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
