from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    openai_api_key: str = ""
    gsc_client_id: str = ""
    gsc_client_secret: str = ""
    gsc_redirect_uri: str = "http://localhost:8000/api/gsc/callback"
    max_crawl_pages: int = 500
    max_crawl_depth: int = 3
    crawl_delay: float = 0.5
    database_path: str = str(Path(__file__).parent / "data" / "app.db")

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
