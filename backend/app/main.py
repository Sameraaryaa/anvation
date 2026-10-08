import time
import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from app.config import settings
from app.api.device import router as device_router
from app.api.dashboard import router as dashboard_router

app = FastAPI(title="AEGIS-Graph", version="1.0")

# CORS setup
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"^https?://.*$",  # Allow LAN IPs and localhost
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Content-Type", "X-Device-Key", "X-Device-Id", "Authorization"],
)

# API routes
@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "ts": int(time.time()),
        "service": "aegis",
        "version": "1.0"
    }

app.include_router(device_router)
app.include_router(dashboard_router)

# Frontend static serving and SPA fallback
FRONTEND_DIST = (Path(__file__).resolve().parent.parent.parent / "frontend" / "dist").resolve()

# If assets dir exists, mount it
assets_dir = FRONTEND_DIST / "assets"
if assets_dir.is_dir():
    app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    # Never intercept /api
    if full_path.startswith("api/") or full_path == "api":
        return JSONResponse(status_code=404, content={"error": "not_found"})

    if FRONTEND_DIST.exists():
        target = FRONTEND_DIST / full_path
        if full_path and target.is_file():
            return FileResponse(str(target))
        index = FRONTEND_DIST / "index.html"
        if index.is_file():
            return FileResponse(str(index))

    return JSONResponse(
        status_code=404,
        content={"error": "frontend_not_built", "message": "Run 'npm run build' in frontend/ to build UI"}
    )
