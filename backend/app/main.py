"""FastAPI application entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .routes import (
    assessments,
    auth,
    candidate,
    evaluations,
    question_papers,
    resumes,
    roles,
)
from .seed import run as seed_run

logger = logging.getLogger("assessment-app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Schema + seed data are created automatically on first start.
    seed_run()
    yield


app = FastAPI(
    title="Role-Based Recruitment Assessment API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    # Never leak internals / stack traces to the client.
    logger.exception("Unhandled error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "An unexpected server error occurred."})


app.include_router(auth.router)
app.include_router(roles.router)
app.include_router(question_papers.router)
app.include_router(assessments.router)
app.include_router(evaluations.router)
app.include_router(candidate.router)
app.include_router(resumes.candidate_router)
app.include_router(resumes.admin_router)
app.include_router(resumes.admin_upload_router)


@app.get("/api/health", tags=["health"])
def health() -> dict:
    return {
        "status": "ok",
        "database": "postgresql" if not settings.is_sqlite else "sqlite",
        "frontend_base_url": settings.FRONTEND_BASE_URL,
    }
