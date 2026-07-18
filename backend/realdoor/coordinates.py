"""Coordinate conversion and citation-box validation."""

from __future__ import annotations

from collections.abc import Sequence


BBOX_UNITS = "pdf_points_bottom_left_origin"


def _as_box(box: Sequence[float]) -> tuple[float, float, float, float]:
    if len(box) != 4:
        raise ValueError("A bounding box must contain four coordinates")
    try:
        return tuple(float(item) for item in box)  # type: ignore[return-value]
    except (TypeError, ValueError) as exc:
        raise ValueError("Bounding box coordinates must be numeric") from exc


def validate_bbox(box: Sequence[float], width: float = 612, height: float = 792) -> list[float]:
    x1, y1, x2, y2 = _as_box(box)
    if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height):
        raise ValueError(f"Bounding box is outside the {width:g}x{height:g} page")
    return [x1, y1, x2, y2]


def pdf_bottom_left_to_pymupdf(box: Sequence[float], page_height: float = 792) -> list[float]:
    """Convert PDF points (bottom-left) into PyMuPDF points (top-left)."""

    x1, y1, x2, y2 = _as_box(box)
    return [x1, page_height - y2, x2, page_height - y1]


def pymupdf_to_pdf_bottom_left(box: Sequence[float], page_height: float = 792) -> list[float]:
    """Convert PyMuPDF points (top-left) into PDF points (bottom-left)."""

    x1, y1, x2, y2 = _as_box(box)
    return [x1, page_height - y2, x2, page_height - y1]


# Descriptive aliases make the conversion explicit at call sites and in tests.
gold_to_pymupdf = pdf_bottom_left_to_pymupdf
pymupdf_to_gold = pymupdf_to_pdf_bottom_left
pdf_to_pymupdf = pdf_bottom_left_to_pymupdf
pymupdf_to_pdf = pymupdf_to_pdf_bottom_left
