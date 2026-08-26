"""Mock OpenAI-compatible server: returns tool_calls until it sees a tool result,
then returns text. Tests the backend tool loop end-to-end without a real API key.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def sse(obj: dict) -> bytes:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _write(self, data: bytes):
        self.wfile.write(data)
        self.wfile.flush()

    def do_POST(self):
        try:
            self._handle_post()
        except Exception:
            import traceback
            traceback.print_exc()
            try:
                self.send_response(500)
                self.end_headers()
                self._write(b"internal error")
            except Exception:
                pass

    def _handle_post(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/v1/chat/completions":
            stream = body.get("stream")
            has_tool_result = any(m.get("role") == "tool" for m in body.get("messages", []))
            tools_requested = bool(body.get("tools"))
            if stream:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Connection", "close")
                self.end_headers()
                if tools_requested and not has_tool_result:
                    # 第一轮：模拟流式 tool_calls（arguments 分片，每个 delta 必须带 index）
                    chunks = [
                        {"index": 0, "id": "call_1", "type": "function", "function": {"name": "web_search", "arguments": '{"query": "北京天气"'}},
                        {"index": 0, "type": "function", "function": {"arguments": ', "count": 2}'}},
                    ]
                    for c in chunks:
                        self._write(sse({"choices": [{"delta": {"tool_calls": [c]}}]}))
                    self._write(sse({"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}))
                else:
                    # 第二轮：已带 tool 结果，正常输出文本
                    self._write(sse({"choices": [{"delta": {"content": "根据搜索结果，"}}]}))
                    self._write(sse({"choices": [{"delta": {"content": "北京今天有雨。"}}]}))
                    self._write(sse({"choices": [{"delta": {}, "finish_reason": "stop"}]}))
                self._write(sse({"usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}))
                self._write(b"data: [DONE]\n\n")
            else:
                # non-stream: 检查第二轮请求里是否带了 tool 消息
                msgs = body.get("messages", [])
                has_tool = any(m.get("role") == "tool" for m in msgs)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self._write(json.dumps({
                    "id": "x", "object": "chat.completion", "created": 0, "model": "mock",
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                }, ensure_ascii=False).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == "/v1/models":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self._write(json.dumps({"data": [{"id": "mock-model", "owned_by": "mock"}]}).encode())
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 9999), Handler).serve_forever()
