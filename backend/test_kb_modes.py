"""Test KB retrieval dual-mode:
- forced (use_kb=True): backend auto-injects context; KB tool excluded.
- agentic (use_kb=False, tools=True): model decides to call knowledge_base_search.
"""
import json
import sys
import urllib.request

URL = "http://127.0.0.1:8000/api/chat"


def run(query, use_kb, tools=True, model="qwen-plus"):
    payload = {
        "messages": [{"role": "user", "content": query}],
        "model": model,
        "tools": tools,
        "use_kb": use_kb,
        "thinking": False,
    }
    req = urllib.request.Request(
        URL, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    tool_names = []
    kb_hits = None
    final = []
    with urllib.request.urlopen(req, timeout=180) as resp:
        for raw in resp:
            line = raw.decode().strip()
            if not line.startswith("data:"):
                continue
            d = line[5:].strip()
            if not d:
                continue
            try:
                evt = json.loads(d)
            except json.JSONDecodeError:
                continue
            t = evt.get("type")
            if t == "tool_call":
                tool_names.append(evt.get("name"))
                print(f"    [tool_call] {evt.get('name')} args={json.dumps(evt.get('arguments'), ensure_ascii=False)}")
            elif t == "kb_hits":
                kb_hits = evt.get("hits")
            elif t == "delta":
                final.append(evt.get("content", ""))
            elif t == "error":
                print(f"    [ERROR] {evt.get('message')}")
    return tool_names, kb_hits, "".join(final)


QUERY = "知识库里那篇关于氨蒸法制 CuSiO2 的论文，转化率和选择性是多少？"

print(f"########## FORCED MODE (use_kb=True, tools=True) ##########")
print(f"Query: {QUERY}")
tn, kh, ans = run(QUERY, use_kb=True)
print(f"  tool calls : {tn}")
print(f"  kb_hits    : {'YES (' + str(len(kh)) + ' hits)' if kh else 'none'}")
print(f"  answer[:300]: {ans[:300]}\n")

print(f"########## AGENTIC MODE (use_kb=False, tools=True) ##########")
print(f"Query: {QUERY}")
tn, kh, ans = run(QUERY, use_kb=False)
print(f"  tool calls : {tn}")
print(f"  kb_hits    : {'YES (' + str(len(kh)) + ' hits)' if kh else 'none'}")
print(f"  answer[:300]: {ans[:300]}\n")
