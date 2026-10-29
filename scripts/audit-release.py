"""Scan publishable files, reachable Git blobs, and a portable release ZIP.

Reports only rule names and file identities, never matched secret text.
This is a bounded release check, not a claim to recognize every possible secret.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile
import tarfile

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    "github_token": rb"\bgh[pousr]_[A-Za-z0-9]{30,}\b",
    "github_fine_grained_token": rb"\bgithub_pat_[A-Za-z0-9_]{40,}\b",
    "google_api_key": rb"\bAIza[A-Za-z0-9_-]{30,}\b",
    "openai_key": rb"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b",
    "aws_access_key": rb"\bAKIA[A-Z0-9]{16}\b",
    "private_key": rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "windows_user_path": rb"(?i)[A-Z]:[\\/]Users[\\/](?!Public\b|Default\b|example\b)[A-Za-z0-9_.-]+[\\/]",
}
local_name = Path.home().name.encode()
if len(local_name) >= 4:
    PATTERNS["local_account_name"] = rb"(?i)\b" + re.escape(local_name) + rb"\b"
compiled = {name: re.compile(pattern) for name, pattern in PATTERNS.items()}


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", type=Path)
    parser.add_argument("--tar", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / ".runtime/release-privacy.json")
    args = parser.parse_args()
    findings = []
    counts = {"working_files": 0, "history_blobs": 0, "commits": 0, "zip_files": 0}

    def check(label, data):
        for name, pattern in compiled.items():
            if pattern.search(data):
                findings.append({"file": label, "rule": name})

    for item in git("ls-files", "-z", "--cached", "--others", "--exclude-standard").split(b"\0"):
        if not item:
            continue
        relative = item.decode("utf-8")
        candidate = ROOT / relative
        if candidate.is_file():
            check(relative, candidate.read_bytes())
            counts["working_files"] += 1
    objects = git("rev-list", "--objects", "--all").splitlines()
    for commit in git("rev-list", "--all").splitlines():
        check("commit:" + commit.decode(), git("show", "-s", "--format=fuller", commit.decode()))
        counts["commits"] += 1
    # Batch object inspection avoids hundreds of process launches.
    proc = subprocess.Popen(["git", "cat-file", "--batch"], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        for item in objects:
            oid, _, label = item.partition(b" ")
            proc.stdin.write(oid + b"\n")
            proc.stdin.flush()
            header = proc.stdout.readline().split()
            if len(header) != 3:
                raise RuntimeError("Could not inspect Git object")
            data = proc.stdout.read(int(header[2]))
            proc.stdout.read(1)
            if header[1] == b"blob":
                counts["history_blobs"] += 1
                check("history:" + oid.decode() + ":" + label.decode("utf-8", errors="replace"), data)
    finally:
        proc.stdin.close()
        proc.wait()
    if args.zip:
        with zipfile.ZipFile(args.zip) as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                parts = Path(info.filename).parts
                if any(p in {"data", "exports", ".runtime", "node_modules", ".git"} for p in parts) or info.filename.endswith((".db", ".db-wal", ".db-shm", ".log", ".pem", ".key")):
                    findings.append({"file": info.filename, "rule": "runtime_or_private_file"})
                check("zip:" + info.filename, archive.read(info))
                counts["zip_files"] += 1
    if args.tar:
        counts['tar_files'] = 0
        with tarfile.open(args.tar, 'r:gz') as archive:
            for info in archive.getmembers():
                if info.isdir():
                    continue
                parts = Path(info.name).parts
                if not info.isfile() or any(p in {'data', 'exports', '.runtime', 'node_modules', '.git'} for p in parts) or info.name.endswith(('.db', '.db-wal', '.db-shm', '.log', '.pem', '.key')):
                    findings.append({'file': info.name, 'rule': 'runtime_or_private_file'})
                if info.isfile():
                    check('tar:' + info.name, archive.extractfile(info).read())
                    counts['tar_files'] += 1
    report = {"counts": counts, "findings": findings, "passed": not findings}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    raise SystemExit(1 if findings else 0)


if __name__ == "__main__":
    main()
