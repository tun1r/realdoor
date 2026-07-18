import sys
from dataclasses import replace
from types import SimpleNamespace

import pytest

from realdoor.coordinates import BBOX_UNITS, pdf_bottom_left_to_pymupdf, validate_bbox
from realdoor.extraction import _normalize_vision_value, _vision_extract, extract_document


def test_coordinate_conversion_regresses_hh001_d03_gold_box():
    gold_box = [40, 658, 94.01, 672]
    assert pdf_bottom_left_to_pymupdf(gold_box, 792) == [40.0, 120.0, 94.01, 134.0]
    assert validate_bbox(gold_box) == [40.0, 658.0, 94.01, 672.0]


def test_text_layer_extraction_is_deterministic(settings):
    path = settings.documents_path / "hh-001_d03_pay_stub.pdf"
    first = extract_document(path.read_bytes(), path.name, settings, document_id="HH-001-D03")
    second = extract_document(path.read_bytes(), path.name, settings, document_id="HH-001-D03")
    first_fields = [(field.name, field.extracted_value, field.bbox, field.method) for field in first.document.fields]
    second_fields = [(field.name, field.extracted_value, field.bbox, field.method) for field in second.document.fields]
    assert first_fields == second_fields
    assert first.document.document_type == "pay_stub"
    assert first.document.contains_untrusted_instruction is False
    assert first.document.fields[0].extracted_value == "Mara North"
    assert first.document.fields[7].extracted_value == 2166.0
    assert first.document.fields[7].bbox_units == BBOX_UNITS
    assert all(field.method == "text_layer" for field in first.document.fields)


@pytest.mark.skipif(__import__("shutil").which("tesseract") is None, reason="tesseract is not installed")
def test_raster_ocr_extracts_allowlisted_fields(settings):
    path = settings.documents_path / "hh-001_d02_pay_stub.pdf"
    result = extract_document(path.read_bytes(), path.name, settings, document_id="HH-001-D02")
    values = {field.name: field.extracted_value for field in result.document.fields}
    assert result.document.rasterized is True
    assert values["person_name"] == "Mara North"
    assert values["pay_frequency"] == "biweekly"
    assert values["gross_pay"] == 2166.0
    assert all(field.method == "ocr" for field in result.document.fields)


def test_all_pack_documents_have_deterministic_allowlisted_extraction(settings):
    for path in sorted(settings.documents_path.glob("*.pdf")):
        result = extract_document(path.read_bytes(), path.name, settings)
        assert result.document.document_type != "unknown", path.name
        assert all(field.extracted_value is not None for field in result.document.fields), path.name


def test_hosted_vision_requires_explicit_enablement(settings, monkeypatch):
    disabled = replace(settings, openai_api_key="test-key", hosted_vision_enabled=False)
    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=lambda **_: (_ for _ in ()).throw(AssertionError())))

    assert _vision_extract(disabled, b"image", "pay_stub", ["gross_pay"]) == {}


def test_hosted_vision_is_deterministic_and_values_are_schema_checked(settings, monkeypatch):
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content='{"gross_pay": 960, "pay_date": "not-a-date"}'))]
    )
    completions = SimpleNamespace(create=lambda **_: response)
    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=lambda **_: fake_client))
    enabled = replace(settings, openai_api_key="test-key", hosted_vision_enabled=True)

    values = _vision_extract(enabled, b"image", "pay_stub", ["gross_pay", "pay_date"])

    assert _normalize_vision_value("gross_pay", values["gross_pay"]) == 960.0
    assert _normalize_vision_value("pay_date", values["pay_date"]) is None
    assert _normalize_vision_value("gross_pay", {"amount": 960}) is None
