"""Real, public-network smoke test for Windows/Linux/container services."""
import argparse
import json
from pathlib import Path
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:19110")
parser.add_argument("--output", type=Path, default=Path(".runtime/smoke-python"))
args = parser.parse_args()
token = ""


def request(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {} if body is None else {"Content-Type": "application/json", "X-Castorice-Token": token}
    req = urllib.request.Request(args.base_url + path, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)["data"]


for attempt in range(20):
    try:
        health = request("/api/health")
        break
    except (urllib.error.URLError, ConnectionError):
        if attempt == 19:
            raise
        time.sleep(0.5)
assert health["version"] == "v1.3"
token = request("/api/session")["token"]
options = request("/api/settings")["scan"]
options.update(mode="quick", visible=False, max_seconds=40, navigation_seconds=20, observe_seconds=3, quiet_millis=600)
task = request("/api/scans", {"url": "https://example.com", "options": options})
deadline = time.monotonic() + 50
while task["status"] in {"starting", "running", "stopping"}:
    if time.monotonic() > deadline:
        request("/api/scans/" + task["id"] + "/stop", {})
        raise RuntimeError("Scan timed out")
    time.sleep(0.25)
    task = request("/api/scans/" + task["id"])
assert task["status"] == "completed", task.get("error", task["status"])
assert not task["test_mode"]
domains = request("/api/scans/" + task["id"] + "/domains")
requests = request("/api/scans/" + task["id"] + "/requests?limit=200")
assert any(d["hostname"] == "example.com" for d in domains)
assert any(r["resource_type"] == "Document" and r.get("status_code") == 200 for r in requests["items"])
args.output.mkdir(parents=True, exist_ok=True)
exports = []
for fmt in ("clash", "provider", "singbox"):
    result = request("/api/export", {"task_id": task["id"], "mode": "observed", "category_ids": [], "format": fmt, "policy": "dibao", "filename": "acceptance-" + fmt, "list_only": False, "use_suffix": False, "domains": [d["hostname"] for d in domains if d["kind"] == "domain"], "excluded": []})
    assert result["final_rules"] > 0
    if fmt == "singbox":
        assert json.loads(result["content"])["version"] == 3
    if fmt == "provider":
        assert ",dibao" not in result["content"]
    (args.output / result["filename"]).write_text(result["content"], encoding="utf-8")
    exports.append({"format": fmt, "rules": result["final_rules"]})
assert any(s["id"] == task["id"] for s in request("/api/scans"))
report = {"health": health, "status": task["status"], "domains": task["domain_count"], "requests": task["request_count"], "exports": exports, "passed": True}
(args.output / "acceptance.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False))
