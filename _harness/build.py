"""Node-free equivalent of build.mjs used by the browser harness."""
from hashlib import sha256
from pathlib import Path
import re
import sys

FILES = [
    "data.js", "party_data.js", "engine.js", "party_engine.js", "ai_engine.js",
    "sync.js", "net.js", "audio_system.js", "ui_party.js", "app.js",
]


def strip_module_syntax(source: str) -> str:
    source = re.sub(r"^import[\s\S]*?from\s+'\./[^']+';\r?\n", "", source, flags=re.MULTILINE)
    source = re.sub(r"^import\s+'\./[^']+';\r?\n", "", source, flags=re.MULTILINE)
    return re.sub(r"^export\s+(?=(?:const|let|var|function|class)\b)", "", source, flags=re.MULTILINE)


def build(root: Path, output: Path) -> None:
    # newline="" keeps CRLF/LF bytes identical to Node's readFileSync output.
    pieces = [strip_module_syntax((root / name).open("r", encoding="utf-8", newline="").read()) for name in FILES]
    game = f"// Generated from {', '.join(FILES)}. Run node build.mjs (or build.ps1) after source edits.\n'use strict';\n" + "\n\n".join(pieces)
    output.open("w", encoding="utf-8", newline="").write(game)
    styles = (root / "styles.css").read_bytes()
    ext_styles = (root / "party-ext.css").read_bytes()
    version = sha256(game.encode() + styles + ext_styles).hexdigest()[:8]
    index_path = root / "index.html"
    index = index_path.open("r", encoding="utf-8", newline="").read()
    index = re.sub(r"(\b(?:game\.js|styles\.css|party-ext\.css)\?v=)[a-f\d]{8}", rf"\g<1>{version}", index, flags=re.I)
    index_path.open("w", encoding="utf-8", newline="").write(index)
    print(f"Built game.js from {len(FILES)} source files for direct opening of index.html.")


if __name__ == "__main__":
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    output = Path(sys.argv[2] if len(sys.argv) > 2 else "game.js")
    if not output.is_absolute():
        output = root / output
    build(root, output)
