"""Extract plain text (with table structure) from all DOCX files in the docs folder."""
import sys
from pathlib import Path
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.oxml.ns import qn


def iter_block_items(parent):
    body = parent.element.body
    for child in body.iterchildren():
        if child.tag == qn('w:p'):
            yield Paragraph(child, parent)
        elif child.tag == qn('w:tbl'):
            yield Table(child, parent)


def para_text(p: Paragraph) -> str:
    style = p.style.name if p.style is not None else ""
    text = p.text.strip()
    if not text:
        return ""
    if style.startswith("Heading") or style.startswith("标题"):
        level = "".join(ch for ch in style if ch.isdigit())
        n = int(level) if level else 1
        return "#" * min(n, 6) + " " + text
    if style.startswith("List") or "列表" in style:
        return "- " + text
    return text


def convert(path: Path, out: Path):
    doc = Document(str(path))
    lines = []
    lines.append(f"=== FILE: {path.name} ===")
    for block in iter_block_items(doc):
        if isinstance(block, Paragraph):
            t = para_text(block)
            if t:
                lines.append(t)
        else:
            lines.append("[TABLE]")
            for row in block.rows:
                cells = []
                seen = set()
                for c in row.cells:
                    if id(c._tc) in seen:
                        continue
                    seen.add(id(c._tc))
                    cells.append(c.text.replace("\n", " / ").strip())
                lines.append("| " + " | ".join(cells) + " |")
            lines.append("[/TABLE]")
    out.write_text("\n".join(lines), encoding="utf-8")
    return len("\n".join(lines))


def main():
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    for f in sorted(src.glob("*.docx")):
        if f.name.startswith("~$"):
            continue
        n = convert(f, dst / (f.stem + ".txt"))
        print(f"{f.name}\t{n} chars")


if __name__ == "__main__":
    main()
