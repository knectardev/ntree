"""
Refactor helper for chart.html

Goal:
- Split the monolithic inline <style> + <script> blocks in chart.html into
  external files under static/demo_static/{css,js}/ while preserving runtime behavior.

Constraints:
- No build step: plain browser scripts, executed in the same order as before.
- Preserve strict mode semantics: each generated JS file begins with 'use strict';
- Keep a backup of the original file under _archive/ for easy rollback.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC_HTML = ROOT / "chart.html"
ARCHIVE_DIR = ROOT / "_archive"
OUT_DIR = ROOT / "static" / "demo_static"
OUT_CSS = OUT_DIR / "css" / "demo_static.css"
OUT_JS_DIR = OUT_DIR / "js"


@dataclass(frozen=True)
class Chunk:
    filename: str
    start: int
    end: int


def _must_find(haystack: str, needle: str) -> int:
    idx = haystack.find(needle)
    if idx < 0:
        raise SystemExit(f"Marker not found: {needle!r}")
    return idx


def _normalize_line_endings(s: str) -> str:
    # Keep repo consistent (Windows checkouts might already have CRLF).
    return s.replace("\r\n", "\n").replace("\r", "\n")


def _extract_style_blocks(html: str) -> list[str]:
    # Note: chart.html uses plain <style> ... </style> blocks (no nested tags).
    blocks = re.findall(r"<style\b[^>]*>(.*?)</style>", html, flags=re.IGNORECASE | re.DOTALL)
    return [b.strip("\n") for b in blocks]


def _extract_script_block(html: str) -> str:
    m = re.search(r"<script\b[^>]*>(.*?)</script>", html, flags=re.IGNORECASE | re.DOTALL)
    if not m:
        raise SystemExit("No <script>...</script> block found in chart.html")
    return m.group(1)


def _strip_first_use_strict(js: str) -> str:
    # Remove a leading 'use strict'; line if present so we can prepend it per-file.
    js2 = js.lstrip()
    js2 = re.sub(r"^(['\"])use strict\1;\s*", "", js2, count=1)
    return js2


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def _backup_original(html_text: str) -> None:
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    backup = ARCHIVE_DIR / "chart.legacy.html"
    if not backup.exists():
        backup.write_text(html_text, encoding="utf-8", newline="\n")


def main() -> None:
    if not SRC_HTML.exists():
        raise SystemExit(f"Missing {SRC_HTML}")

    html_raw = SRC_HTML.read_text(encoding="utf-8")
    html = _normalize_line_endings(html_raw)

    _backup_original(html)

    styles = _extract_style_blocks(html)
    if not styles:
        raise SystemExit("No <style> blocks found; aborting")

    css_out = "/* Extracted from chart.html */\n\n" + "\n\n/* --- */\n\n".join(styles).rstrip() + "\n"
    _write(OUT_CSS, css_out)

    js_raw = _normalize_line_endings(_extract_script_block(html))
    js = _strip_first_use_strict(js_raw)

    # Split points: chosen to keep chunks logically grouped while preserving original order.
    m_mode = _must_find(js, "\n  // Mode selection:\n")
    m_persist = _must_find(js, "\n  // UI config persistence (static mode): localStorage instead of server.\n")
    m_chart_state = _must_find(js, "\n  // chart state\n")
    m_state_obj = _must_find(js, "\n  var state = {\n")
    m_load_api = _must_find(js, "\n  async function loadFromAPI(force){\n")
    m_draw = _must_find(js, "\n  function draw(){\n")
    m_replay = _must_find(js, "\n  async function replayStart(opts){\n")
    m_dials = _must_find(js, "\n  // Continuous detrend + oscillation scan (UI only): dial widgets\n")

    chunks: list[Chunk] = [
        Chunk("01_core_overlays_sessions.js", 0, m_mode),
        Chunk("02_mode_and_static_loader.js", m_mode, m_persist),
        Chunk("03_persistence_and_catalog.js", m_persist, m_chart_state),
        Chunk("04_dom_ui_and_span_presets.js", m_chart_state, m_state_obj),
        Chunk("05_state_and_chart_math.js", m_state_obj, m_load_api),
        Chunk("06_loaders_and_fetch.js", m_load_api, m_draw),
        Chunk("07_render_and_interactions.js", m_draw, m_replay),
        Chunk("08_replay_and_file_io.js", m_replay, m_dials),
        Chunk("09_dials_and_boot.js", m_dials, len(js)),
    ]

    js_files: list[str] = []
    for c in chunks:
        body = js[c.start : c.end].strip("\n")
        out = "'use strict';\n\n" + body.rstrip() + "\n"
        out_path = OUT_JS_DIR / c.filename
        _write(out_path, out)
        js_files.append(f"static/demo_static/js/{c.filename}")

    # Rewrite HTML: remove inline style/script, add external link + script tags.
    html2 = html
    html2 = re.sub(r"\s*<style\b[^>]*>.*?</style>\s*", "\n", html2, flags=re.IGNORECASE | re.DOTALL)
    script_tags = "\n".join([f'  <script src="{src}"></script>' for src in js_files])
    html2 = re.sub(
        r"<script\b[^>]*>.*?</script>",
        script_tags,
        html2,
        count=1,
        flags=re.IGNORECASE | re.DOTALL,
    )
    link_tag = '  <link rel="stylesheet" href="static/demo_static/css/demo_static.css" />\n'
    if "static/demo_static/css/demo_static.css" not in html2:
        html2 = html2.replace("</head>", link_tag + "</head>")

    # Clean up excessive blank lines introduced by removals.
    html2 = re.sub(r"\n{4,}", "\n\n\n", html2).strip() + "\n"
    _write(SRC_HTML, html2)

    print("Refactor complete:")
    print(f"- Updated: {SRC_HTML.relative_to(ROOT)}")
    print(f"- Wrote:   {OUT_CSS.relative_to(ROOT)}")
    print(f"- Wrote:   {len(js_files)} JS files under {OUT_JS_DIR.relative_to(ROOT)}/")
    print(f"- Backup:  {(ARCHIVE_DIR / 'chart.legacy.html').relative_to(ROOT)}")


if __name__ == "__main__":
    main()


