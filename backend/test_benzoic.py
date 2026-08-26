"""Parameterized end-to-end tool-calling test.

Usage:
  python test_benzoic.py "<query>" [model]

Prints tool calls, results, and final answer for verification.
"""
import json
import sys
import urllib.request

URL = "http://127.0.0.1:8000/api/chat"
QUERY = sys.argv[1] if len(sys.argv) > 1 else "苯甲酸的分子式、分子量是多少"
MODEL = sys.argv[2] if len(sys.argv) > 2 else "qwen-plus"

PAYLOAD = {
    "messages": [{"role": "user", "content": QUERY}],
    "model": MODEL,
    "tools": True,
    "thinking": False,
}

req = urllib.request.Request(
    URL,
    data=json.dumps(PAYLOAD).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)

print(f"=== QUERY: {QUERY!r} (model={MODEL}) ===\n")
tool_calls = 0
tool_names = []
saw_json_invalid = False
final_text = []
stats = None

with urllib.request.urlopen(req, timeout=180) as resp:
    for raw in resp:
        line = raw.decode("utf-8").strip()
        if not line.startswith("data:"):
            continue
        data = line[len("data:"):].strip()
        if not data:
            continue
        try:
            evt = json.loads(data)
        except json.JSONDecodeError:
            continue
        t = evt.get("type")
        if t == "tool_call":
            tool_calls += 1
            tool_names.append(evt.get("name"))
            print(f"[tool_call #{tool_calls}] {evt.get('name')} args={json.dumps(evt.get('arguments'), ensure_ascii=False)}")
        elif t == "tool_result":
            content = evt.get("content", "")
            if "json_invalid" in content or ("exit_code" in content and "\"3\"" in content):
                saw_json_invalid = True
            try:
                c = json.loads(content)
                compact = json.dumps(c, ensure_ascii=False)[:240]
            except Exception:
                compact = content[:240]
            print(f"  -> [tool_result] ok={evt.get('ok')} {compact}")
        elif t == "delta":
            final_text.append(evt.get("content", ""))
        elif t == "stats":
            stats = evt
        elif t == "error":
            print(f"[ERROR] {evt.get('message')}")
        elif t == "done":
            print("[done]")

print("\n=== SUMMARY ===")
print(f"total tool calls : {tool_calls}")
print(f"tool names       : {tool_names}")
print(f"saw json_invalid : {saw_json_invalid}")
if stats:
    print(f"stats            : {json.dumps(stats, ensure_ascii=False)}")
print("\n=== FINAL ANSWER (first 600 chars) ===")
print("".join(final_text)[:600])
