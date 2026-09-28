"""Plain-text rendering of a DOCX file.

Browsers cannot display DOCX natively, so the admin panel would otherwise have to make
the reviewer download a Word resume before reading it. This turns the document into text
the panel can show inline. Paragraphs and table cells are kept in document order.
"""
from __future__ import annotations

import io
import re
import zipfile

ENTITIES = (
    ("&amp;", "&"),
    ("&lt;", "<"),
    ("&gt;", ">"),
    ("&quot;", '"'),
    ("&apos;", "'"),
)

CELL_MARK = "\t</w:tc>"


def extract_text(data: bytes) -> str:
    """Return the document's readable text, or an empty string if it cannot be parsed."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            xml = zf.read("word/document.xml").decode("utf-8", "replace")
    except (zipfile.BadZipFile, KeyError):
        return ""

    # Make cell/row boundaries and explicit breaks visible before stripping tags.
    xml = xml.replace("</w:tc>", CELL_MARK).replace("</w:tr>", "\n</w:tr>")
    xml = re.sub(r"<w:br[^>]*/>", "\n", xml)
    xml = re.sub(r"<w:tab[^>]*/>", "\t", xml)

    lines: list[str] = []
    for para in re.split(r"</w:p>", xml):
        # Match the text element exactly: <w:t> or <w:t ...>, never <w:tbl>, <w:tc>, <w:tr>.
        line = "".join(re.findall(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", para, re.S))
        for entity, char in ENTITIES:
            line = line.replace(entity, char)
        if CELL_MARK in para:
            line += "\t"
        line = line.rstrip()
        if line.strip():
            lines.append(line)

    text = "\n".join(lines)
    # Collapse the blank-line runs that empty paragraphs leave behind.
    return re.sub(r"\n{3,}", "\n\n", text).strip()
