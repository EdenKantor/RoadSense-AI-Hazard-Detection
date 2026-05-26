"""
MongoDB connection bootstrap using Motor (async driver).
Exposes a `get_db()` dependency that returns the active database handle.
"""
from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings

_client: AsyncIOMotorClient | None = None


async def connect_db() -> None:
    """Initialise the global Motor client and verify connectivity with a ping."""
    global _client
    _client = AsyncIOMotorClient(settings.mongodb_url)
    # Ping to verify connection on startup
    await _client.admin.command("ping")


async def close_db() -> None:
    """Close the global Motor client if it has been initialised."""
    global _client
    if _client:
        _client.close()


def get_db():
    """Return the active Motor database. Used as a FastAPI dependency."""
    return _client[settings.mongodb_db_name]
