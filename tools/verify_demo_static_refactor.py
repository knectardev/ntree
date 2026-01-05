from __future__ import annotations

from pathlib import Path
import re


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    html_path = root / "chart.html"
    css_path = root / "static" / "demo_static" / "css" / "demo_static.css"
    legacy_candidates = [
        root / "_archive" / "chart.legacy.html",
        root / "_archive" / "demo_static.legacy.html",  # back-compat from earlier refactor runs
    ]

    text = html_path.read_text(encoding="utf-8")

    assert 'href="static/demo_static/css/demo_static.css"' in text, "Missing CSS link tag"
    assert css_path.exists(), f"Missing CSS file: {css_path}"

    scripts = re.findall(r'<script\s+src="([^"]+)"', text)
    assert scripts, "No <script src=...> tags found"

    missing = [s for s in scripts if not (root / s).exists()]
    assert not missing, f"Missing referenced scripts: {missing}"

    assert any(p.exists() for p in legacy_candidates), f"Missing legacy backup: {legacy_candidates}"

    print(f"OK: {len(scripts)} scripts, css ok, legacy ok")


if __name__ == "__main__":
    main()


