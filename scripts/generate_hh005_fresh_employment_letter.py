"""Generate the project-owned synthetic HH-005 replacement fixture."""

from __future__ import annotations

import argparse
from pathlib import Path

import fitz


def _document() -> tuple[fitz.Document, fitz.Page]:
    pdf = fitz.open()
    return pdf, pdf.new_page(width=612, height=792)


def _finish(pdf: fitz.Document) -> bytes:
    result = pdf.tobytes(no_new_id=True)
    pdf.close()
    return result


def build_application_pdf() -> bytes:
    pdf, page = _document()
    page.insert_text((40, 52), "Application Summary", fontsize=18)
    page.insert_text((40, 80), "SYNTHETIC - NOT A REAL DOCUMENT", fontsize=9)
    page.insert_text((40, 150), "APPLICANT", fontsize=9)
    page.insert_text((40, 168), "Tess Alder", fontsize=12)
    page.insert_text((360, 150), "HOUSEHOLD SIZE", fontsize=9)
    page.insert_text((360, 168), "5", fontsize=12)
    page.insert_text((40, 220), "MAILING ADDRESS", fontsize=9)
    page.insert_text((40, 238), "77 Meadow Signal Ave, Quincy, MA 02169", fontsize=12)
    page.insert_text((40, 290), "APPLICATION DATE", fontsize=9)
    page.insert_text((40, 308), "2026-07-10", fontsize=12)
    return _finish(pdf)


def build_pay_stub_pdf(
    *,
    person_name: str = "Tess Alder",
    source_name: str = "North Loop Books",
    pay_date: str = "2026-06-27",
    period_start: str = "2026-06-10",
    period_end: str = "2026-06-23",
) -> bytes:
    pdf, page = _document()
    page.insert_text((40, 52), source_name, fontsize=18)
    page.insert_text((40, 78), "Pay Stub", fontsize=13)
    page.insert_text((40, 105), "SYNTHETIC - NOT A REAL DOCUMENT", fontsize=9)
    page.insert_text((40, 150), "EMPLOYEE", fontsize=9)
    page.insert_text((40, 168), person_name, fontsize=12)
    page.insert_text((330, 150), "PAY DATE", fontsize=9)
    page.insert_text((330, 168), pay_date, fontsize=12)
    page.insert_text((40, 220), "PAY PERIOD", fontsize=9)
    page.insert_text((40, 238), period_start, fontsize=12)
    page.insert_text((200, 220), "THROUGH", fontsize=9)
    page.insert_text((200, 238), period_end, fontsize=12)
    page.insert_text((360, 220), "PAY FREQUENCY", fontsize=9)
    page.insert_text((360, 238), "biweekly", fontsize=12)
    page.insert_text((40, 300), "REGULAR HOURS", fontsize=9)
    page.insert_text((52, 318), "68", fontsize=12)
    page.insert_text((180, 300), "HOURLY RATE", fontsize=9)
    page.insert_text((190, 318), "$26.00", fontsize=12)
    page.insert_text((330, 300), "GROSS PAY", fontsize=9)
    page.insert_text((340, 318), "$1,768.00", fontsize=12)
    page.insert_text((460, 300), "NET PAY", fontsize=9)
    page.insert_text((460, 318), "$1,379.04", fontsize=12)
    return _finish(pdf)


def build_pdf(
    *,
    person_name: str = "Tess Alder",
    source_name: str = "North Loop Books",
    document_date: str = "2026-07-12",
    weekly_hours: int = 34,
    hourly_rate: float = 26.0,
    title: str = "Employment Letter HH-005 replacement",
) -> bytes:
    pdf, page = _document()
    text = (0, 0, 0)
    page.insert_text((40, 52), source_name, fontsize=18, fontname="helv", color=text)
    page.insert_text((40, 78), title, fontsize=13, fontname="helv", color=text)
    page.insert_text((40, 120), "SYNTHETIC - NOT A REAL DOCUMENT", fontsize=9, fontname="helv", color=text)
    page.insert_text((40, 160), "EMPLOYEE", fontsize=9, fontname="helv", color=text)
    page.insert_text((40, 178), person_name, fontsize=12, fontname="helv", color=text)
    page.insert_text((360, 160), "LETTER DATE", fontsize=9, fontname="helv", color=text)
    page.insert_text((360, 178), document_date, fontsize=12, fontname="helv", color=text)
    page.insert_text(
        (40, 240),
        f"For this synthetic training scenario, {person_name} works approximately {weekly_hours}.0 hours",
        fontsize=11,
        fontname="helv",
        color=text,
    )
    page.insert_text(
        (40, 258),
        f"per week at ${hourly_rate:.2f} per hour for {source_name}. Employment is ongoing.",
        fontsize=11,
        fontname="helv",
        color=text,
    )
    page.insert_text((40, 330), "HOURS PER WEEK", fontsize=9, fontname="helv", color=text)
    page.insert_text((40, 348), str(weekly_hours), fontsize=12, fontname="helv", color=text)
    page.insert_text((250, 330), "HOURLY RATE", fontsize=9, fontname="helv", color=text)
    page.insert_text((250, 348), f"${hourly_rate:.2f}", fontsize=12, fontname="helv", color=text)
    page.insert_text((40, 748), "Fixture HH-005 fresh replacement - synthetic training data only", fontsize=8, fontname="helv", color=text)
    return _finish(pdf)


def build_adversarial_employment_pdf() -> bytes:
    """Build a PDF whose invisible text passes extraction but not rendered OCR."""

    pdf, page = _document()
    page.insert_text((40, 52), "Benign rendered receipt", fontsize=18)
    page.insert_text((40, 90), "No employment evidence appears on this page.", fontsize=12)
    hidden = {"fontname": "helv", "color": (0, 0, 0), "render_mode": 3}
    page.insert_text((40, 52), "North Loop Books", fontsize=18, **hidden)
    page.insert_text((40, 78), "Employment Letter HH-005 replacement", fontsize=13, **hidden)
    page.insert_text((40, 160), "EMPLOYEE", fontsize=9, **hidden)
    page.insert_text((40, 178), "Tess Alder", fontsize=12, **hidden)
    page.insert_text((360, 160), "LETTER DATE", fontsize=9, **hidden)
    page.insert_text((360, 178), "2026-07-12", fontsize=12, **hidden)
    page.insert_text((40, 330), "HOURS PER WEEK", fontsize=9, **hidden)
    page.insert_text((40, 348), "34", fontsize=12, **hidden)
    page.insert_text((250, 330), "HOURLY RATE", fontsize=9, **hidden)
    page.insert_text((250, 348), "$26.00", fontsize=12, **hidden)
    return _finish(pdf)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "output",
        nargs="?",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "backend" / "tests" / "fixtures" / "hh-005_fresh_employment_letter.pdf",
    )
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(build_pdf())


if __name__ == "__main__":
    main()
