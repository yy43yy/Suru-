"""Local HTTP entry point. Run with python -m suru.server."""
import argparse
import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .domain import ValidationError, profile_input, run_input, session_input
from .storage import Store

STATIC = Path(__file__).parent / "static"
LOGGER = logging.getLogger(__name__)


def handler_for(store):
    class Handler(BaseHTTPRequestHandler):
        def send(self, status, body, content_type="application/json; charset=utf-8"):
            if not isinstance(body, bytes):
                body = json.dumps(body, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = urlsplit(self.path).path
            if path == "/api/history":
                self.send(200, store.history())
            elif path == "/api/profile":
                self.send(200, {"profile": store.get_profile()})
            elif path in ("/", "/profile","/history", "/app.js", "/profile.js", "/style.css", "/onboarding.css"):
                name, mime = {"/": ("index.html", "text/html"),"/history":("history.html","text/html"), "/profile": ("profile.html", "text/html"), "/app.js": ("app.js", "text/javascript"), "/profile.js": ("profile.js", "text/javascript"), "/style.css": ("style.css", "text/css"), "/onboarding.css": ("onboarding.css", "text/css")}[path]
                self.send(200, (STATIC / name).read_bytes(), mime + "; charset=utf-8")
            else:
                self.send(404, {"error": "Not found."})

        def do_POST(self):
            # Same-origin JSON only: browsers cannot submit cross-origin forms.
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                self.send(415, {"error": "Use application/json."})
                return
            origin = self.headers.get("Origin")
            if origin and origin != "http://" + self.headers.get("Host", ""):
                self.send(403, {"error": "Cross-origin requests are not permitted."})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16384:
                    raise ValidationError("Request must contain at most 16 KB of JSON.")
                data = json.loads(self.rfile.read(length))
                if self.path == "/api/profile":
                    self.send(200, {"profile": store.save_profile(profile_input(data))})
                    return
                elif self.path == "/api/sessions":
                    result = store.add_session(session_input(data))
                elif self.path == "/api/runs":
                    result = store.add_run(run_input(data))
                else:
                    self.send(404, {"error": "Not found."})
                    return
                self.send(201, result)
            except (ValidationError, ValueError, UnicodeDecodeError) as error:
                self.send(400, {"error": str(error)})
            except Exception:
                LOGGER.exception("Unable to save request")
                self.send(500, {"error": "Unable to save. Please try again."})

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Run Suru locally.")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--database", default="data/suru.sqlite3")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(Store(args.database)))
    print(f"Suru is ready at http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
