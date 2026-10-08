from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

# Determine env file locations
BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    DB_MODE: str = "local"                  # local | cloud
    DEVICE_KEY: str = "aegis-demo-key-change-me"   # MUST equal DEVICE_KEY in ESP32 / UNO Q
    GEMINI_API_KEY: Optional[str] = ""     # paid tier
    AIR_GAPPED: int = 0                    # 1 = no Gemini calls, template answers only
    ALLOW_BROWSER_APPROVAL: int = 0        # 1 = show "Simulate badge" on Hardware page
    GCP_PROJECT: Optional[str] = ""        # only for DB_MODE=cloud
    FIRESTORE_PREFIX: str = "aegis"
    SEED_CARDS: str = "04A1B2C3:Security Lead" # optional, comma-separated UID:Name pairs

    model_config = SettingsConfigDict(
        env_file=[str(BASE_DIR / ".env"), ".env"],
        env_file_encoding="utf-8",
        extra="ignore",
    )

settings = Settings()
