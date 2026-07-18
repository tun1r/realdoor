import io
import zipfile

from fastapi.testclient import TestClient

from realdoor import api
from realdoor.service import RealDoorService


def test_fixed_api_contract_smoke(settings, monkeypatch):
    test_service = RealDoorService(settings)
    monkeypatch.setattr(api, "service", test_service)
    client = TestClient(api.app)

    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    config = client.get("/api/config")
    assert config.status_code == 200
    assert config.json()["pack_available"] is True
    assert config.json()["demo_households"] == [f"HH-00{i}" for i in range(1, 7)]
    assert config.json()["rule_version"] == "frozen-2026-07-18"
    assert config.json()["challenge_window_days"] == 60
    assert config.json()["rule_citations"]

    created = client.post("/api/sessions")
    assert created.status_code == 200
    empty = created.json()
    assert empty["documents"] == []
    assert empty["analysis"] is None
    assert empty["all_fields_confirmed"] is False

    demo = client.post("/api/sessions/demo/HH-001")
    assert demo.status_code == 200
    session = demo.json()
    assert len(session["documents"]) == 4
    assert len(session["packet"]["included_document_ids"]) == 4
    assert session["analysis"] is None
    session_id = session["id"]

    confirmed = client.post(f"/api/sessions/{session_id}/confirm", json={})
    assert confirmed.status_code == 200
    analysis = confirmed.json()["analysis"]
    assert analysis["annualized_income"] == 56316.0
    assert confirmed.json()["all_fields_confirmed"] is True

    document = confirmed.json()["documents"][0]
    page = client.get(f"/api/sessions/{session_id}/documents/{document['id']}/page/1.png")
    assert page.status_code == 200
    assert page.headers["content-type"] == "image/png"

    question = client.post(f"/api/sessions/{session_id}/question", json={"question": "May the system call this household eligible?"})
    assert question.status_code == 200
    assert question.json()["refusal"] is True
    assert question.json()["rule_citations"]

    packet = client.patch(
        f"/api/sessions/{session_id}/packet",
        json={"included_document_ids": [document["id"]], "renter_note": "Review this packet."},
    )
    assert packet.status_code == 200
    download = client.get(f"/api/sessions/{session_id}/packet.zip")
    assert download.status_code == 200
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        assert {"packet.json", "packet.html"}.issubset(set(archive.namelist()))

    deleted = client.delete(f"/api/sessions/{session_id}")
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True
    assert client.get(f"/api/sessions/{session_id}").status_code == 404
