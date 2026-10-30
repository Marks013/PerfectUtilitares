"""Private bounded processor. No personal input is logged or written to disk."""
import json
import signal
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from service_operations import OperationError, Operations, PROCESS_TIMEOUT_SECONDS, run_operation
from service_security import authorized, load_secret, operation_identity
from worker import run_worker

MAX_BODY = 5 * 1024 * 1024
MAX_THREADS = 16


class SolverHTTPServer(ThreadingHTTPServer):
    def __init__(self, address, secret, timeout=PROCESS_TIMEOUT_SECONDS, worker_target=run_worker):
        self.secret = secret
        self.operations = Operations()
        self.operation_timeout = timeout
        self.worker_target = worker_target
        self.handlers = threading.BoundedSemaphore(MAX_THREADS)
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        if not self.handlers.acquire(blocking=False):
            try:
                request.settimeout(0.1)
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.handlers.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.handlers.release()

    def server_close(self):
        self.operations.cancel_all()
        super().server_close()

    def handle_error(self, _request, _address):
        # No raw exception can be logged: it might contain private model material.
        pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "EscalaSolver"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_args):
        pass

    def reply(self, status, data):
        body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.close_connection = True
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass

    def do_GET(self):
        self.reply(200 if self.path == "/health" else 404, {"ok": self.path == "/health"})

    def _body(self, limit):
        lengths = self.headers.get_all("Content-Length", [])
        if (len(lengths) != 1 or not lengths[0].isdigit()
                or self.headers.get("Transfer-Encoding") is not None):
            raise OperationError(400, "INVALID_LENGTH")
        length = int(lengths[0])
        if length <= 0 or length > limit:
            raise OperationError(413, "INVALID_LENGTH")
        if self.headers.get_content_type() != "application/json":
            raise OperationError(415, "INVALID_CONTENT_TYPE")
        body = self.rfile.read(length)
        if len(body) != length:
            raise OperationError(400, "INVALID_MODEL_INPUT")
        def invalid_constant(_value):
            raise ValueError("INVALID_JSON")
        return json.loads(body, parse_constant=invalid_constant)

    def do_POST(self):
        # Authenticate before reading any body or allocating the computation slot.
        if not authorized(self.headers, self.server.secret):
            return self.reply(401, {"error": "SOLVER_UNAUTHORIZED"})
        try:
            if self.path == "/cancel":
                payload = self._body(1024)
                if not isinstance(payload, dict) or set(payload) != {"requestId", "cancelToken"}:
                    raise ValueError("INVALID_OPERATION")
                request_id, token_hash = operation_identity(payload["requestId"], payload["cancelToken"])
                state = self.server.operations.cancel(request_id, token_hash)
                return self.reply(200, {"state": state})
            if self.path != "/solve":
                return self.reply(404, {"error": "NOT_FOUND"})
            request_ids = self.headers.get_all("X-Request-ID", [])
            cancel_tokens = self.headers.get_all("X-Cancel-Token", [])
            if len(request_ids) != 1 or len(cancel_tokens) != 1:
                raise ValueError("INVALID_OPERATION")
            request_id, token_hash = operation_identity(request_ids[0], cancel_tokens[0])
            payload = self._body(MAX_BODY)
            if not isinstance(payload, dict) or set(payload) != {"input"} or not isinstance(payload["input"], dict):
                raise ValueError("INVALID_MODEL_INPUT")
            operation = self.server.operations.start(request_id, token_hash)
            try:
                outcome = run_operation(payload["input"], operation, self.server.operation_timeout, self.server.worker_target)
            except Exception:
                outcome = {"state": "FAILED", "error": "SOLVER_FAILED"}
            state = self.server.operations.finish(operation, outcome["state"])
            if state == "CANCELLED":
                return self.reply(409, {"error": "SOLVER_CANCELLED", "state": state})
            if state == "TIMED_OUT":
                return self.reply(504, {"error": "SOLVER_TIMED_OUT", "state": state})
            if state == "FAILED":
                code = outcome.get("error", "SOLVER_FAILED")
                return self.reply(400 if code == "INVALID_MODEL_INPUT" else 500, {"error": code, "state": state})
            self.reply(200, outcome["result"])
        except OperationError as error:
            body = {"error": error.code}
            if error.state:
                body["state"] = error.state
            self.reply(error.status, body)
        except (ValueError, KeyError, TypeError, OverflowError, socket.timeout):
            self.reply(400, {"error": "INVALID_MODEL_INPUT"})
        except Exception:
            # Never return or log exception text containing the model's personal payload.
            self.reply(500, {"error": "SOLVER_FAILED"})


def main():
    try:
        secret = load_secret()
    except (OSError, ValueError):
        raise SystemExit("SOLVER_CONFIG_INVALID") from None
    server = SolverHTTPServer(("0.0.0.0", 8080), secret)
    def stop(_signum, _frame):
        server.operations.cancel_all()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
