"""Real, public-network smoke test for Windows/Linux/container services."""
import argparse
import base64
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:19110")
parser.add_argument("--output", type=Path, default=Path(".runtime/smoke-python"))
parser.add_argument("--access-password-file", help="Password file for a protected service, or - for standard input")
parser.add_argument("--check-compose-sandbox", action="store_true")
args = parser.parse_args()
token = ""
authorization = ""
if args.access_password_file:
    secret = sys.stdin.read() if args.access_password_file == "-" else Path(args.access_password_file).read_text()
    authorization = "Basic " + base64.b64encode(("castorice:" + secret.rstrip("\r\n")).encode()).decode()


def request(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {} if body is None else {"Content-Type": "application/json", "X-Castorice-Token": token}
    if authorization:
        headers["Authorization"] = authorization
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
assert health["version"] == "v" + (Path(__file__).resolve().parents[1] / "VERSION").read_text().strip().removesuffix(".0")
token = request("/api/session")["token"]
options = request("/api/settings")["scan"]
options.update(mode="quick", visible=False, max_seconds=40, navigation_seconds=20, observe_seconds=3, quiet_millis=600)
if args.check_compose_sandbox:
    options.update(observe_seconds=20, quiet_millis=10000)
task = request("/api/scans", {"url": "https://example.com", "options": options})
if args.check_compose_sandbox:
    probe = r'''
awk '/^NoNewPrivs:/{nnp=$2} /^Seccomp:/{mode=$2}
     END {if (nnp != 1) exit 3; if (mode != 2) exit 4}' /proc/self/status || exit $?
baseline=$(awk '/^Seccomp_filters:/{print $2}' /proc/self/status)
if [ "${baseline:-0}" -lt 1 ]; then exit 4; fi
printf 'Container seccomp filters: %s\n' "$baseline"
for file in /proc/[0-9]*/cmdline; do
  # Chromium can put the entire process title in one NUL-terminated entry.
  if [ -r "$file" ] && tr '\000' '\n' < "$file" 2>/dev/null | grep -Eq -- '(^|[[:space:]])--type=renderer([[:space:]]|$)'; then
    awk -v base="$baseline" '
      /^NSpid:/{depth=NF-1}
      /^Seccomp:/{mode=$2}
      /^Seccomp_filters:/{filters=$2}
      END {
        printf "Renderer PID namespace depth: %d; seccomp mode: %d; filters: %d\n", depth, mode, filters
        if (depth < 2 || mode != 2 || filters <= base) exit 1
      }' "${file%/cmdline}/status" && exit 0
  fi
done
exit 1
'''
    probe_output = set()
    for _ in range(40):
        state = subprocess.run(
            ["docker", "compose", "exec", "-T", "analyzer", "sh", "-c", probe],
            check=False, capture_output=True, timeout=10,
        )
        if state.returncode == 0:
            break
        if state.returncode in (3, 4):
            raise RuntimeError("Container security settings were not applied")
        probe_output.update(state.stdout.decode().splitlines())
        current = request("/api/scans/" + task["id"])
        if current["status"] not in {"starting", "running", "stopping"}:
            task = current
            break
        time.sleep(0.5)
    if state.returncode != 0:
        diagnostics = "\n".join(sorted(probe_output))
        raise RuntimeError(
            "No Chromium renderer with a nested PID namespace and an additional seccomp filter. "
            f"Scan: {task['status']} ({task.get('end_reason', '')}). {task.get('error', '')}\n{diagnostics}"
        )
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
if args.check_compose_sandbox:
    report["renderer_sandbox"] = True
(args.output / "acceptance.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False))
