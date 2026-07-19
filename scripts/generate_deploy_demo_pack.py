"""Generate the project-owned synthetic corpus used by the hosted demo."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import fitz

from generate_hh005_fresh_employment_letter import (
    build_application_pdf,
    build_pay_stub_pdf,
    build_pdf,
)


DOCUMENTS = (
    {
        "document_id": "HH-005-D01",
        "household_id": "HH-005",
        "document_type": "application_summary",
        "file_name": "hh-005_d01_application_summary.pdf",
        "rasterized": "True",
        "contains_adversarial_text": "False",
        "synthetic_notice": "PROJECT-OWNED SYNTHETIC - NOT A REAL DOCUMENT",
    },
    {
        "document_id": "HH-005-D02",
        "household_id": "HH-005",
        "document_type": "pay_stub",
        "file_name": "hh-005_d02_pay_stub.pdf",
        "rasterized": "False",
        "contains_adversarial_text": "False",
        "synthetic_notice": "PROJECT-OWNED SYNTHETIC - NOT A REAL DOCUMENT",
    },
    {
        "document_id": "HH-005-D03",
        "household_id": "HH-005",
        "document_type": "pay_stub",
        "file_name": "hh-005_d03_pay_stub.pdf",
        "rasterized": "False",
        "contains_adversarial_text": "False",
        "synthetic_notice": "PROJECT-OWNED SYNTHETIC - NOT A REAL DOCUMENT",
    },
    {
        "document_id": "HH-005-D04",
        "household_id": "HH-005",
        "document_type": "employment_letter",
        "file_name": "hh-005_d04_employment_letter.pdf",
        "rasterized": "True",
        "contains_adversarial_text": "False",
        "synthetic_notice": "PROJECT-OWNED SYNTHETIC - NOT A REAL DOCUMENT",
    },
)


def rasterize(pdf_bytes: bytes) -> bytes:
    source = fitz.open(stream=pdf_bytes, filetype="pdf")
    rendered = source[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    output = fitz.open()
    page = output.new_page(width=612, height=792)
    page.insert_image(page.rect, stream=rendered.tobytes("png"))
    result = output.tobytes(no_new_id=True)
    output.close()
    source.close()
    return result


def gold_rows() -> list[dict[str, object]]:
    return [
        {
            "document_id": "HH-005-D01",
            "household_id": "HH-005",
            "document_type": "application_summary",
            "synthetic": True,
            "source_owner": "RealDoor project",
            "fields": {
                "person_name": "Tess Alder",
                "household_size": 5,
                "address": "77 Meadow Signal Ave, Quincy, MA 02169",
                "application_date": "2026-07-10",
            },
        },
        {
            "document_id": "HH-005-D02",
            "household_id": "HH-005",
            "document_type": "pay_stub",
            "synthetic": True,
            "source_owner": "RealDoor project",
            "fields": {
                "person_name": "Tess Alder",
                "pay_date": "2026-06-27",
                "pay_period_start": "2026-06-10",
                "pay_period_end": "2026-06-23",
                "pay_frequency": "biweekly",
                "regular_hours": 68,
                "hourly_rate": 26.0,
                "gross_pay": 1768.0,
                "net_pay": 1379.04,
                "source_name": "North Loop Books",
            },
        },
        {
            "document_id": "HH-005-D03",
            "household_id": "HH-005",
            "document_type": "pay_stub",
            "synthetic": True,
            "source_owner": "RealDoor project",
            "fields": {
                "person_name": "Tess Alder",
                "pay_date": "2026-06-20",
                "pay_period_start": "2026-06-03",
                "pay_period_end": "2026-06-16",
                "pay_frequency": "biweekly",
                "regular_hours": 68,
                "hourly_rate": 26.0,
                "gross_pay": 1768.0,
                "net_pay": 1379.04,
                "source_name": "North Loop Books",
            },
        },
        {
            "document_id": "HH-005-D04",
            "household_id": "HH-005",
            "document_type": "employment_letter",
            "synthetic": True,
            "source_owner": "RealDoor project",
            "fields": {
                "person_name": "Tess Alder",
                "document_date": "2026-04-14",
                "weekly_hours": 34,
                "hourly_rate": 26.0,
                "source_name": "North Loop Books",
            },
        },
    ]


def generate(output: Path) -> None:
    documents_dir = output / "synthetic_documents" / "documents"
    gold_dir = output / "synthetic_documents" / "gold"
    documents_dir.mkdir(parents=True, exist_ok=True)
    gold_dir.mkdir(parents=True, exist_ok=True)

    files = {
        "hh-005_d01_application_summary.pdf": rasterize(build_application_pdf()),
        "hh-005_d02_pay_stub.pdf": build_pay_stub_pdf(),
        "hh-005_d03_pay_stub.pdf": build_pay_stub_pdf(
            pay_date="2026-06-20",
            period_start="2026-06-03",
            period_end="2026-06-16",
        ),
        "hh-005_d04_employment_letter.pdf": rasterize(
            build_pdf(document_date="2026-04-14", title="Employment Letter")
        ),
    }
    for name, data in files.items():
        (documents_dir / name).write_bytes(data)

    with (gold_dir / "document_manifest.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=DOCUMENTS[0].keys())
        writer.writeheader()
        writer.writerows(DOCUMENTS)

    with (gold_dir / "document_gold.jsonl").open("w", encoding="utf-8") as handle:
        for row in gold_rows():
            handle.write(json.dumps(row, separators=(",", ":")) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "output",
        nargs="?",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "backend" / "realdoor" / "demo_pack",
    )
    args = parser.parse_args()
    generate(args.output)


if __name__ == "__main__":
    main()
