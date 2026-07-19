import io
import json
import zipfile

import pytest

from realdoor.models import ConfirmRequest
from realdoor.service import ServiceError


def test_cross_session_access_and_path_traversal_are_blocked(service):
    first = service.create_session()
    second = service.create_session()
    assert first.id != second.id
    with pytest.raises(ServiceError) as error:
        service.get_session("../" + second.id)
    assert error.value.status_code == 404
    with pytest.raises(ServiceError) as error:
        service.page_png(first.id, "../" + second.id, 1)
    assert error.value.status_code == 404


def test_delete_removes_complete_session_directory(service):
    state = service.create_demo_session("HH-001")
    state = service.confirm(state.id, ConfirmRequest())
    session_dir = service.settings.session_dir / state.id
    assert session_dir.is_dir()
    receipt = service.delete_session(state.id)
    assert receipt["deleted"] is True
    assert not session_dir.exists()
    with pytest.raises(ServiceError):
        service.get_session(state.id)


def test_packet_zip_contains_only_explicitly_selected_sources(service):
    state = service.create_demo_session("HH-001")
    state = service.confirm(state.id, ConfirmRequest())
    selected = [state.documents[0].id]
    state = service.update_packet(state.id, selected, "Please review the cited documents.")
    archive_bytes = service.packet_zip(state.id)
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        names = archive.namelist()
        assert "packet.json" in names
        assert "packet.html" in names
        assert sum(name.endswith(".pdf") for name in names) == 1
        assert "lang=\"en\"" in archive.read("packet.html").decode("utf-8")
        assert f"documents/{state.documents[0].file_name}" in names
        assert all(document.file_name not in " ".join(names) for document in state.documents[1:])
        packet = json.loads(archive.read("packet.json"))
        assert "session_id" not in packet
        assert packet["analysis"]["annualized_income"] == 56316.0
        assert packet["analysis"]["readiness_status"] == "READY_TO_REVIEW"
        assert packet["packet_complete"] is False
        assert packet["excluded_active_document_ids"] == [document.id for document in state.documents[1:]]
        assert packet["warnings"]
        assert "submission.json" not in names
