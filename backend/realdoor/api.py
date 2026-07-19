"""FastAPI application exposing the fixed RealDoor backend contract."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from .config import PROJECT_ROOT
from .models import ConfirmRequest, CorrectionRequest, ErrorResponse, PacketRequest, QuestionRequest, SessionState
from .service import RealDoorService, ServiceError


service = RealDoorService()
app = FastAPI(title="RealDoor backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(service.settings.allowed_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)


@app.exception_handler(ServiceError)
async def service_error_handler(_: Request, exc: ServiceError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "realdoor"}


@app.get("/api/config")
def config() -> dict[str, object]:
    return {
        "pack_available": service.settings.pack_available,
        "demo_households": service.demo_households(),
        "extraction_mode": "local_plus_hosted_vision" if service.settings.hosted_vision_enabled and service.settings.openai_api_key else "local_only",
        "hosted_vision_provider": "OpenAI" if service.settings.hosted_vision_enabled and service.settings.openai_api_key else None,
        "rule_version": "frozen-2026-07-18",
        "effective_date": "2026-05-01",
        "fiscal_year": 2026,
        "challenge_window_days": 60,
        "challenge_convention": (
            "Under the challenge's frozen simulation convention, evidence dated no more than "
            "60 days before July 18, 2026 is treated as current. This is not a universal LIHTC rule."
        ),
        "rule_citations": service.rules.citations(["HUD-MTSP-001", "HUD-MTSP-002", "CH-READINESS-001"]),
    }


@app.post("/api/sessions")
def create_session() -> dict[str, object]:
    return service.create_session().model_dump(mode="json")


@app.post("/api/sessions/demo/{household_id}")
def create_demo_session(household_id: str) -> dict[str, object]:
    return service.create_demo_session(household_id).model_dump(mode="json")


@app.post("/api/sessions/{session_id}/documents")
async def upload_documents(session_id: str, files: list[UploadFile] = File(...)) -> dict[str, object]:
    if len(files) > service.settings.max_upload_files:
        raise ServiceError("Too many files in one upload", 413)
    uploads: list[tuple[str, bytes]] = []
    total_bytes = 0
    for upload in files:
        data = await upload.read(service.settings.max_upload_bytes + 1)
        if len(data) > service.settings.max_upload_bytes:
            raise ServiceError("Uploaded file is too large", 413)
        total_bytes += len(data)
        if total_bytes > service.settings.max_upload_total_bytes:
            raise ServiceError("Combined upload is too large", 413)
        uploads.append((upload.filename or "document.pdf", data))
    state = await run_in_threadpool(service.add_documents, session_id, uploads)
    return state.model_dump(mode="json")


@app.post(
    "/api/sessions/{session_id}/documents/{document_id}/replacement",
    response_model=SessionState,
    responses={
        404: {"model": ErrorResponse, "description": "Session or active replacement target not found"},
        409: {"model": ErrorResponse, "description": "Target is inactive or already has a pending replacement"},
        413: {"model": ErrorResponse, "description": "Replacement PDF exceeds the upload limit"},
        422: {"model": ErrorResponse, "description": "Replacement PDF failed extraction or validation"},
    },
)
async def stage_replacement(session_id: str, document_id: str, file: UploadFile = File(...)) -> dict[str, object]:
    data = await file.read(service.settings.max_upload_bytes + 1)
    if len(data) > service.settings.max_upload_bytes:
        raise ServiceError("Uploaded file is too large", 413)
    state = await run_in_threadpool(
        service.stage_replacement,
        session_id,
        document_id,
        file.filename or "replacement.pdf",
        data,
    )
    return state.model_dump(mode="json")


@app.post(
    "/api/sessions/{session_id}/documents/{pending_document_id}/confirm-replacement",
    response_model=SessionState,
    responses={
        404: {"model": ErrorResponse, "description": "Session or pending replacement not found"},
        409: {"model": ErrorResponse, "description": "Document is not pending or its target is no longer active"},
        422: {"model": ErrorResponse, "description": "Pending replacement no longer passes promotion validation"},
    },
)
def confirm_replacement(session_id: str, pending_document_id: str) -> dict[str, object]:
    return service.confirm_replacement(session_id, pending_document_id).model_dump(mode="json")


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str) -> dict[str, object]:
    return service.get_session(session_id).model_dump(mode="json")


@app.post("/api/sessions/{session_id}/confirm")
def confirm_fields(session_id: str, request: ConfirmRequest) -> dict[str, object]:
    return service.confirm(session_id, request).model_dump(mode="json")


@app.patch("/api/sessions/{session_id}/fields/{field_id}")
def correct_field(session_id: str, field_id: str, request: CorrectionRequest) -> dict[str, object]:
    return service.correct_field(session_id, field_id, request.value, request.confirmed).model_dump(mode="json")


@app.post("/api/sessions/{session_id}/question")
def ask_question(session_id: str, request: QuestionRequest) -> dict[str, object]:
    return service.answer_question(session_id, request.question)


@app.patch("/api/sessions/{session_id}/packet")
def update_packet(session_id: str, request: PacketRequest) -> dict[str, object]:
    return service.update_packet(session_id, request.included_document_ids, request.renter_note).model_dump(mode="json")


@app.get("/api/sessions/{session_id}/packet.zip")
def download_packet(session_id: str) -> Response:
    packet = service.packet_zip(session_id)
    return Response(
        content=packet,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="realdoor-{session_id}-packet.zip"'},
    )


@app.get("/api/sessions/{session_id}/documents/{document_id}/page/{page_number}.png")
def document_page(session_id: str, document_id: str, page_number: int) -> Response:
    return Response(content=service.page_png(session_id, document_id, page_number), media_type="image/png")


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str) -> dict[str, object]:
    return service.delete_session(session_id)


frontend_dist = Path(os.getenv("REALDOOR_FRONTEND_DIST", PROJECT_ROOT / "frontend" / "dist")).resolve()
if frontend_dist.is_dir():
    assets_dir = frontend_dist / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="frontend-assets")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str) -> Response:
        if path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        candidate = (frontend_dist / path).resolve()
        if candidate.is_file() and frontend_dist in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(frontend_dist / "index.html")
