"""Application configuration, loaded from environment variables / .env."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database. Leave DATABASE_URL empty to fall back to local SQLite.
    DATABASE_URL: str = ""
    SQLITE_PATH: str = str(BACKEND_DIR / "assessment.db")

    # Admin bootstrap account
    ADMIN_USER_ID: str = "admin"
    ADMIN_PASSWORD_HASH: str = ""
    ADMIN_PASSWORD: str = ""  # dev convenience: hashed on first boot if no hash given

    # Auth
    JWT_SECRET: str = "change-me-in-env"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480

    # URLs
    FRONTEND_BASE_URL: str = "http://localhost:5173"
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    DEFAULT_DURATION_MINUTES: int = 60
    DISPLAY_TIMEZONE: str = "Asia/Kolkata"

    # ---- Resume uploads ----
    # Storage provider is pluggable: "local" today, S3/Supabase later (see storage_service).
    RESUME_STORAGE_BACKEND: str = "local"
    # Deliberately outside the frontend so uploads are never publicly served.
    RESUME_STORAGE_DIR: str = str(BACKEND_DIR / "storage" / "resumes")
    MAX_RESUME_SIZE_MB: int = 10
    RESUME_REQUIRED_BEFORE_START: bool = True

    @property
    def resume_storage_path(self) -> str:
        path = Path(self.RESUME_STORAGE_DIR)
        return str(path if path.is_absolute() else (BACKEND_DIR / path))

    @property
    def max_resume_bytes(self) -> int:
        return self.MAX_RESUME_SIZE_MB * 1024 * 1024

    @property
    def sqlalchemy_url(self) -> str:
        url = (self.DATABASE_URL or "").strip()
        if not url:
            return f"sqlite:///{self.SQLITE_PATH}"
        # Normalise Render / Heroku style URLs onto the psycopg3 driver.
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        return url

    @property
    def is_sqlite(self) -> bool:
        return self.sqlalchemy_url.startswith("sqlite")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
