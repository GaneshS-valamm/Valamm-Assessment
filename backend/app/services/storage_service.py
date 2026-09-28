"""Pluggable file storage.

The provider is chosen by RESUME_STORAGE_BACKEND. Only `local` ships today; S3 and
Supabase Storage can be added by implementing ResumeStorage and registering it in
`get_storage()` - no candidate or admin workflow code changes.

Files are addressed by an opaque `storage_key` generated here. The original filename is
never used as a filesystem path.
"""
from __future__ import annotations

import re
import secrets
import unicodedata
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path

from ..config import settings


class StorageError(RuntimeError):
    """Raised when the backend cannot store or retrieve a file."""


def safe_display_name(filename: str, fallback: str = "resume") -> str:
    """Sanitise a client-supplied filename for *display and download* only.

    Never used to build a storage path.
    """
    name = unicodedata.normalize("NFKD", filename or "").strip()
    name = name.replace("\\", "/").split("/")[-1]  # strip any path component
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    name = re.sub(r'[<>:"|?*]', "_", name)
    name = name.strip(". ")
    if not name:
        return fallback
    return name[:200]


def build_storage_key(assessment_id: int, version: int, extension: str) -> str:
    """Server-generated, collision-proof key. Sharded by upload date."""
    stamp = datetime.now(timezone.utc)
    token = secrets.token_hex(16)
    ext = extension.lower().lstrip(".")
    return f"resumes/{stamp:%Y/%m}/a{assessment_id}-v{version}-{token}.{ext}"


class ResumeStorage(ABC):
    """Contract every storage provider must satisfy."""

    name: str = "abstract"

    @abstractmethod
    def save(self, storage_key: str, data: bytes) -> None: ...

    @abstractmethod
    def load(self, storage_key: str) -> bytes: ...

    @abstractmethod
    def exists(self, storage_key: str) -> bool: ...


class LocalDiskStorage(ResumeStorage):
    """Development/default backend.

    Writes under RESUME_STORAGE_DIR, which lives outside the frontend's served assets,
    so uploads are never reachable over a public URL. Not durable on ephemeral hosts -
    configure object storage for production (see README).
    """

    name = "local"

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, storage_key: str) -> Path:
        # Defend against traversal even though keys are server-generated.
        target = (self.root / storage_key).resolve()
        if not str(target).startswith(str(self.root.resolve())):
            raise StorageError("Invalid storage key.")
        return target

    def save(self, storage_key: str, data: bytes) -> None:
        path = self._resolve(storage_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Write to a temp file then move, so a partial write never becomes a live resume.
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(path)

    def load(self, storage_key: str) -> bytes:
        path = self._resolve(storage_key)
        if not path.is_file():
            raise StorageError("Stored file is missing from the storage backend.")
        return path.read_bytes()

    def exists(self, storage_key: str) -> bool:
        try:
            return self._resolve(storage_key).is_file()
        except StorageError:
            return False


_instance: ResumeStorage | None = None


def get_storage() -> ResumeStorage:
    """Return the configured storage backend (singleton)."""
    global _instance
    if _instance is not None:
        return _instance

    backend = (settings.RESUME_STORAGE_BACKEND or "local").strip().lower()
    if backend == "local":
        _instance = LocalDiskStorage(Path(settings.resume_storage_path))
    else:
        # Registration point for s3 / supabase / azure implementations.
        raise StorageError(
            f"Unsupported RESUME_STORAGE_BACKEND '{backend}'. Supported backends: local."
        )
    return _instance
