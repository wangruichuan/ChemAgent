"""Application configuration. Defaults can be overridden via environment variables or .env file."""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "ChemAgent Chat"

    # Default OpenAI-compatible endpoint. Can be overridden per-request from the frontend.
    openai_base_url: str = "https://api.openai.com/v1"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # Generation defaults
    temperature: float = 0.7
    max_tokens: int = 4096

    # Knowledge base embedding (server-side, not exposed to frontend)
    embed_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    embed_api_key: str = ""
    embed_model: str = "text-embedding-v3"

    # LLM cleaning model (server-side; reuses the default OpenAI-compatible config)
    clean_model: str = "qwen-turbo"
    # LLM semantic chunk-boundary model ("" disables LLM chunking)
    chunk_model: str = "qwen-turbo"

    # MinerU precise API token (scanned PDFs)
    mineru_api_key: str = ""

    # CORS: frontend dev server
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
