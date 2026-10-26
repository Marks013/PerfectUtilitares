"""Private bounded processor. No personal input is logged or written to disk."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from solver import solve

PROCESSING = threading.BoundedSemaphore(1)
MAX_BODY = 5 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        self.reply(200 if self.path == "/health" else 404,
                   {"ok": self.path == "/health"})

    def do_POST(self):
        if self.path != "/solve":
            return self.reply(404, {"error": "NOT_FOUND"})
        if not PROCESSING.acquire(blocking=False):
            return self.reply(429, {"error": "SOLVER_BUSY"})
        try:
            self.connection.settimeout(5)
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                return self.reply(413, {"error": "INVALID_LENGTH"})
            payload = json.loads(self.rfile.read(length))
            self.reply(200, solve(payload["input"], payload.get("force", {})))
        except (ValueError, KeyError, TypeError, OverflowError):
            self.reply(400, {"error": "INVALID_MODEL_INPUT"})
        except Exception:
            # Never return or log exception text containing the model's personal payload.
            self.reply(500, {"error": "SOLVER_FAILED"})
        finally:
            PROCESSING.release()


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
