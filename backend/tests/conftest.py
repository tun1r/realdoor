from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
PROJECT_ROOT = BACKEND_ROOT.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

PACK_PATH = Path(__file__).resolve().parents[3] / "RealDoor_Hackathon_Starter_Pack_v1" / "realdoor-hackathon-starter-pack"


@pytest.fixture
def settings(tmp_path):
    from realdoor.config import Settings

    if not PACK_PATH.is_dir():
        pytest.skip("starter pack is not available")
    return Settings(
        pack_path=PACK_PATH,
        session_dir=tmp_path / "sessions",
        allowed_origins=("http://testserver",),
        openai_api_key=None,
        openai_vision_model="gpt-4.1-mini",
    )


@pytest.fixture
def service(settings):
    from realdoor.service import RealDoorService

    return RealDoorService(settings)


@pytest.fixture
def local_settings(tmp_path):
    from realdoor.config import Settings

    return Settings(
        pack_path=tmp_path / "packless",
        session_dir=tmp_path / "local-sessions",
        allowed_origins=("http://testserver",),
        openai_api_key=None,
        openai_vision_model="gpt-4.1-mini",
    )


@pytest.fixture
def local_service(local_settings):
    from realdoor.service import RealDoorService

    return RealDoorService(local_settings)
