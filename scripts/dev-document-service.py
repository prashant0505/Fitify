"""Start the loopback document engine and share its token with the web app."""

import os
import re
import runpy
import secrets
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / ".dev.vars"
TOKEN = "DOCUMENT_SERVICE_TOKEN"
URL = "DOCUMENT_SERVICE_URL"
HOST = "127.0.0.1"
PORT = "8091"
ENTRY = re.compile(r"^[ \t]*(?:export[ \t]+)?(" + TOKEN + "|" + URL + r")[ \t]*=[ \t]*(.*)$")


def configure():
    original = CONFIG.read_text(encoding="utf-8") if CONFIG.exists() else ""
    lines = []
    token = ""
    for line in original.splitlines():
        match = ENTRY.match(line)
        if not match:
            lines.append(line)
        elif match[1] == TOKEN:
            token = match[2].split("#", 1)[0].strip().strip("\"'")

    # Use a header-safe token that also needs no quoting in a dotenv file.
    if not re.fullmatch(r"[A-Za-z0-9._~-]{24,}", token):
        token = secrets.token_urlsafe(32)
    lines.extend((f"{TOKEN}={token}", f"{URL}=http://{HOST}:{PORT}"))
    content = "\n".join(lines) + "\n"
    if original != content:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", prefix=".dev.vars.", dir=ROOT, delete=False) as file:
            path = Path(file.name)
            file.write(content)
        try:
            path.replace(CONFIG)
        finally:
            path.unlink(missing_ok=True)
    if os.name != "nt":
        CONFIG.chmod(0o600)
    os.environ.update({TOKEN: token, "HOST": HOST, "PORT": PORT})


if __name__ == "__main__":
    configure()
    service = ROOT / "document-service"
    sys.path.insert(0, str(service))
    runpy.run_path(str(service / "server.py"), run_name="__main__")
