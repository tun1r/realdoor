"""Runtime configuration for the RealDoor backend."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PACK_PATH = PROJECT_ROOT.parent / "RealDoor_Hackathon_Starter_Pack_v1" / "realdoor-hackathon-starter-pack"
DEFAULT_SESSION_DIR = PROJECT_ROOT / "backend" / ".sessions"


def _resolve_path(raw: str | None, default: Path) -> Path:
    if not raw:
        return default.resolve()
    path = Path(raw).expanduser()
    return path.resolve() if path.is_absolute() else (PROJECT_ROOT / path).resolve()


@dataclass(frozen=True)
class Settings:
    pack_path: Path
    session_dir: Path
    allowed_origins: tuple[str, ...]
    openai_api_key: str | None
    openai_vision_model: str
    hosted_vision_enabled: bool = False
    ocr_dpi: int = 200
    event_date: date = date(2026, 7, 18)
    max_upload_bytes: int = 25 * 1024 * 1024
    max_upload_total_bytes: int = 50 * 1024 * 1024
    max_upload_files: int = 10
    max_document_pages: int = 25

    @classmethod
    def from_env(cls) -> "Settings":
        raw_origins = os.getenv("REALDOOR_ALLOWED_ORIGINS") or os.getenv("REALDOOR_ALLOWED_ORIGIN")
        allowed_origins = tuple(
            origin.strip()
            for origin in (raw_origins or "http://localhost:5173,http://127.0.0.1:5173").split(",")
            if origin.strip()
        )
        return cls(
            pack_path=_resolve_path(os.getenv("REALDOOR_PACK_PATH"), DEFAULT_PACK_PATH),
            session_dir=_resolve_path(os.getenv("REALDOOR_SESSION_DIR"), DEFAULT_SESSION_DIR),
            allowed_origins=allowed_origins,
            openai_api_key=os.getenv("OPENAI_API_KEY") or None,
            openai_vision_model=os.getenv("OPENAI_VISION_MODEL", "gpt-5.6-luna"),
            hosted_vision_enabled=os.getenv("REALDOOR_ENABLE_HOSTED_VISION", "false").lower() == "true",
            ocr_dpi=int(os.getenv("REALDOOR_OCR_DPI", "200")),
        )

    @property
    def pack_available(self) -> bool:
        return (
            self.pack_path.is_dir()
            and (self.pack_path / "synthetic_documents" / "gold" / "document_manifest.csv").is_file()
            and (self.pack_path / "synthetic_documents" / "gold" / "document_gold.jsonl").is_file()
        )

    @property
    def manifest_path(self) -> Path:
        return self.pack_path / "synthetic_documents" / "gold" / "document_manifest.csv"

    @property
    def gold_path(self) -> Path:
        return self.pack_path / "synthetic_documents" / "gold" / "document_gold.jsonl"

    @property
    def documents_path(self) -> Path:
        return self.pack_path / "synthetic_documents" / "documents"

    @property
    def rules_path(self) -> Path:
        return self.pack_path / "rules" / "rule_corpus.jsonl"

    @property
    def qa_path(self) -> Path:
        return self.pack_path / "evaluation" / "qa_gold.jsonl"
