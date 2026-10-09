"""Generate small, valid PDFs for 007 tests (no dependencies).

Objects are written with a correct cross-reference table, so real readers (pdf.js, browsers)
open them. Pages are US Letter (612 × 792 pt).
"""

from __future__ import annotations


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _build(objects: list[bytes], trailer_extra: bytes = b"") -> bytes:
    """objects[i] is the body of object i+1; object 1 must be the catalog."""
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R ".encode()
        + trailer_extra
        + f">>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return bytes(out)


def _pdf(page_contents: list[bytes | None], annots: list[list[bytes]] | None = None,
         trailer_extra: bytes = b"") -> bytes:  # fmt: skip
    n = len(page_contents)
    # 1 catalog, 2 pages, 3 font, then per page: page obj, content obj, then annotation objs
    objects: list[bytes] = [b"<< /Type /Catalog /Pages 2 0 R >>", b"", b""]
    objects[2] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    kids = []
    next_id = 4
    page_ids: list[int] = []
    for i, content in enumerate(page_contents):
        page_id, content_id = next_id, next_id + 1
        next_id += 2
        page_ids.append(page_id)
        kids.append(f"{page_id} 0 R")
        annot_ids = []
        for _ in annots[i] if annots else []:
            annot_ids.append(next_id)
            next_id += 1
        annot_ref = (
            (" /Annots [" + " ".join(f"{a} 0 R" for a in annot_ids) + "]") if annot_ids else ""
        )
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R{annot_ref} >>"
            ).encode()
        )
        stream = content or b""
        objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
        for body in annots[i] if annots else []:
            objects.append(body)
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {n} >>".encode()
    return _build(objects, trailer_extra)


def _text_stream(lines: list[str]) -> bytes:
    parts = [b"BT /F1 18 Tf 72 720 Td 24 TL"]
    for line in lines:
        parts.append(f"({_escape(line)}) Tj T*".encode())
    parts.append(b"ET")
    return b"\n".join(parts)


def text_pdf(pages: int = 3, text: str = "Lecture notes") -> bytes:
    """Every page has selectable text: '<text> — page N' and a second line."""
    return _pdf(
        [
            _text_stream([f"{text} - page {i + 1}", "A red-black tree is balanced."])
            for i in range(pages)
        ]
    )


def image_only_pdf(pages: int = 2) -> bytes:
    """No text at all: a filled rectangle per page (stands in for a scanned page)."""
    return _pdf([b"0.6 g 72 72 468 648 re f" for _ in range(pages)])


def encrypted_pdf() -> bytes:
    """Declares an /Encrypt dictionary in the trailer (readers will ask for a password)."""
    return _pdf(
        [_text_stream(["secret"])],
        trailer_extra=b"/Encrypt << /Filter /Standard /V 1 /R 2 /O (x) /U (y) /P -4 >> ",
    )


def annotated_pdf() -> bytes:
    """One page with a highlight and a sticky-note (/Text) annotation already in the file."""
    highlight = (
        b"<< /Type /Annot /Subtype /Highlight /Rect [70 710 300 740] "
        b"/QuadPoints [70 740 300 740 70 710 300 710] /C [1 1 0] /Contents (lecturer) >>"
    )
    note = b"<< /Type /Annot /Subtype /Text /Rect [400 700 420 720] /Contents (Check this) >>"
    return _pdf([_text_stream(["Annotated page"])], annots=[[highlight, note]])


def linked_pdf() -> bytes:
    """Page 1 links to page 3 (internal) and to a web address."""
    # object ids: page 1 = 4 (content 5, links 6-7), page 2 = 8 (content 9), page 3 = 10
    internal = (
        b"<< /Type /Annot /Subtype /Link /Rect [72 700 300 730] /Border [0 0 0] "
        b"/Dest [10 0 R /Fit] >>"
    )
    web = (
        b"<< /Type /Annot /Subtype /Link /Rect [72 650 300 680] /Border [0 0 0] "
        b"/A << /S /URI /URI (https://example.edu/) >> >>"
    )
    return _pdf(
        [
            _text_stream(["Go to page 3", "Course site"]),
            _text_stream(["Page 2"]),
            _text_stream(["Page 3"]),
        ],
        annots=[[internal, web], [], []],
    )


def truncated(data: bytes, keep: int = 200) -> bytes:
    return data[:keep]


def fake_pdf() -> bytes:
    """Starts like a PDF but has no trailer (`%%EOF`)."""
    return b"%PDF-1.7\n" + bytes(2048)
