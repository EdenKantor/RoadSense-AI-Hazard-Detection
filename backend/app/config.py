"""
App settings loaded from environment / .env file via pydantic-settings.
"""
from typing import List
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Typed application configuration loaded from environment variables and .env."""

    # MongoDB
    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "roadsenseai"

    # JWT
    # The default below is intentionally an obvious dev placeholder so it is
    # impossible to ship to production by mistake. Generate a real key with:
    #   python -c "import secrets; print(secrets.token_urlsafe(32))"
    # and set SECRET_KEY in backend/.env (see backend/.env.example).
    secret_key: str = "DEVELOPMENT-ONLY-CHANGE-IN-PRODUCTION-aaaa1111bbbb2222"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    # Redis
    redis_url: str = "redis://localhost:6379"

    # File storage
    upload_dir: str = "../uploads"

    # Emergency fallback: if True and Redis/RQ is unavailable, the backend
    # will run the pipeline in-process via a background thread.
    # Default False — uploads will fail safely if the queue is unreachable.
    enable_emergency_fallback: bool = False

    # CORS
    cors_origins: List[str] = ["http://localhost:5173"]

    # Dev-only observability dashboard. When True, mounts the dev_observability
    # router at /api/dev/observability/* and starts the Redis pub/sub subscriber
    # + 1s aggregator background tasks. Default False — never enable in prod.
    dev_mode: bool = False

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
