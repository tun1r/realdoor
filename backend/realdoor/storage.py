"""Session-scoped filesystem storage with opaque, isolated identifiers."""

from __future__ import annotations

import json
import re
import shutil
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import fcntl

from .models import DocumentRecord, SessionState, utc_now


class SessionNotFound(FileNotFoundError):
    pass


class InvalidIdentifier(ValueError):
    pass


_DOCUMENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def migrate_session_data(value: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Upgrade persisted v1 JSON before Pydantic validates the v2 contract."""

    version = value.get("schema_version", 1)
    if version == 2:
        return value, False
    if version != 1:
        raise ValueError(f"Unsupported session schema version: {version}")
    migrated = dict(value)
    migrated["schema_version"] = 2
    documents = []
    for raw_document in migrated.get("documents", []):
        document = dict(raw_document)
        document.setdefault("status", "active")
        document.setdefault("replaces_document_id", None)
        document.setdefault("superseded_by_document_id", None)
        document.setdefault("superseded_at", None)
        documents.append(document)
    migrated["documents"] = documents
    active_ids = [document["id"] for document in documents if document["status"] == "active"]
    packet = dict(migrated.get("packet") or {})
    included = list(dict.fromkeys(packet.get("included_document_ids", [])))
    packet["included_document_ids"] = included
    packet.setdefault("renter_note", None)
    packet["excluded_active_document_ids"] = [document_id for document_id in active_ids if document_id not in included]
    packet["packet_complete"] = not packet["excluded_active_document_ids"]
    migrated["packet"] = packet
    migrated["analysis"] = None
    migrated["replacement_events"] = []
    return migrated, True


def validate_session_id(session_id: str) -> str:
    try:
        parsed = uuid.UUID(session_id)
    except (ValueError, AttributeError, TypeError) as exc:
        raise InvalidIdentifier("Invalid session id") from exc
    canonical = str(parsed)
    if canonical != session_id:
        raise InvalidIdentifier("Invalid session id")
    return canonical


def validate_document_id(document_id: str) -> str:
    if not _DOCUMENT_ID_RE.fullmatch(document_id) or document_id in {".", ".."}:
        raise InvalidIdentifier("Invalid document id")
    return document_id


class SessionRepository:
    """Small JSON/PDF repository; audit records deliberately exclude values."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._transaction_local = threading.local()

    def _session_dir(self, session_id: str) -> Path:
        safe_id = validate_session_id(session_id)
        path = (self.root / safe_id).resolve()
        if path.parent != self.root:
            raise InvalidIdentifier("Invalid session path")
        return path

    def _state_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / "session.json"

    @contextmanager
    def transaction(self) -> Iterator[None]:
        depth = getattr(self._transaction_local, "depth", 0)
        if depth:
            self._transaction_local.depth = depth + 1
            try:
                yield
            finally:
                self._transaction_local.depth = depth
            return
        with self._lock:
            lock_path = self.root / ".realdoor.lock"
            with lock_path.open("a+") as lock_handle:
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
                self._transaction_local.depth = 1
                try:
                    yield
                finally:
                    self._transaction_local.depth = 0
                    fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)

    def _atomic_write_json(self, path: Path, value: Any) -> None:
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=True, indent=2), encoding="utf-8")
        temporary.replace(path)

    def create(self, state: SessionState) -> SessionState:
        with self._lock:
            session_dir = self._session_dir(state.id)
            session_dir.mkdir(parents=True, exist_ok=False)
            self._atomic_write_json(session_dir / "session.json", state.model_dump(mode="json"))
            self._append_audit(state.id, "session_created")
            return state

    def load(self, session_id: str) -> SessionState:
        state, _ = self.load_with_migration(session_id)
        return state

    def load_with_migration(self, session_id: str) -> tuple[SessionState, bool]:
        with self._lock:
            path = self._state_path(session_id)
            if not path.is_file():
                raise SessionNotFound(session_id)
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(raw, dict):
                    raise ValueError("Session state must be a JSON object")
                migrated, changed = migrate_session_data(raw)
                return SessionState.model_validate(migrated), changed
            except (OSError, ValueError) as exc:
                raise SessionNotFound(session_id) from exc

    def save(self, state: SessionState) -> SessionState:
        with self._lock:
            session_dir = self._session_dir(state.id)
            if not session_dir.is_dir():
                raise SessionNotFound(state.id)
            self._atomic_write_json(session_dir / "session.json", state.model_dump(mode="json"))
            return state

    def append_document(
        self,
        session_id: str,
        document: DocumentRecord,
        source_bytes: bytes,
        page_images: dict[int, bytes],
        *,
        audit: bool = True,
    ) -> None:
        with self._lock:
            session_dir = self._session_dir(session_id)
            if not session_dir.is_dir():
                raise SessionNotFound(session_id)
            document_dir = session_dir / "documents" / validate_document_id(document.id)
            temporary_dir = document_dir.with_name(f".{document.id}.tmp-{uuid.uuid4().hex}")
            try:
                temporary_dir.mkdir(parents=True, exist_ok=False)
                (temporary_dir / "source.pdf").write_bytes(source_bytes)
                pages_dir = temporary_dir / "pages"
                pages_dir.mkdir()
                for page_number, image in page_images.items():
                    if page_number < 1 or page_number > document.page_count:
                        raise InvalidIdentifier("Invalid page number")
                    (pages_dir / f"{page_number}.png").write_bytes(image)
                temporary_dir.replace(document_dir)
            except Exception:
                shutil.rmtree(temporary_dir, ignore_errors=True)
                raise
            if audit:
                try:
                    self._append_audit(session_id, "document_processed", [document.id])
                except OSError:
                    pass

    def remove_document_assets(self, session_id: str, document_id: str) -> None:
        with self._lock:
            document_dir = self._session_dir(session_id) / "documents" / validate_document_id(document_id)
            shutil.rmtree(document_dir, ignore_errors=True)

    def source_path(self, session_id: str, document_id: str) -> Path:
        document_dir = self._document_dir(session_id, document_id)
        path = document_dir / "source.pdf"
        if not path.is_file():
            raise SessionNotFound(document_id)
        return path

    def page_path(self, session_id: str, document_id: str, page_number: int) -> Path:
        if page_number < 1:
            raise InvalidIdentifier("Invalid page number")
        document_dir = self._document_dir(session_id, document_id)
        path = document_dir / "pages" / f"{page_number}.png"
        if not path.is_file():
            raise SessionNotFound(f"{document_id}/{page_number}")
        return path

    def _document_dir(self, session_id: str, document_id: str) -> Path:
        session_dir = self._session_dir(session_id)
        safe_document_id = validate_document_id(document_id)
        path = (session_dir / "documents" / safe_document_id).resolve()
        if path.parent != (session_dir / "documents").resolve() or not path.is_dir():
            raise SessionNotFound(document_id)
        return path

    def _append_audit(self, session_id: str, action: str, document_ids: list[str] | None = None) -> None:
        session_dir = self._session_dir(session_id)
        audit_path = session_dir / "audit.jsonl"
        event = {
            "timestamp": utc_now(),
            "action": action,
            "document_ids": document_ids or [],
            "rule_version": "frozen-2026-07-18",
        }
        with audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=True) + "\n")

    def audit(self, session_id: str, action: str, document_ids: list[str] | None = None) -> None:
        with self._lock:
            if not self._session_dir(session_id).is_dir():
                raise SessionNotFound(session_id)
            self._append_audit(session_id, action, document_ids)

    def delete(self, session_id: str) -> bool:
        with self.transaction():
            session_dir = self._session_dir(session_id)
            if not session_dir.is_dir():
                raise SessionNotFound(session_id)
            shutil.rmtree(session_dir)
            return True
