#!/usr/bin/env python3
"""Write release.json for imprint-update.sh from the committed HEAD.

Run after committing the code you want to ship; then commit release.json on top.
The updater downloads the archive at `rev` and checks every file against these hashes.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def sha(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    dirty = subprocess.run(["git", "status", "--porcelain", "--", "api_loop.py", "imprint_store.py", "claude_subscription.py", "imprint-app/dist"],
                           cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    if dirty:
        print("commit backend files and imprint-app/dist first:\n" + dirty, file=sys.stderr)
        return 1
    rev = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    tracked = subprocess.run(["git", "ls-files", "imprint-app/dist"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    dist = {name[len("imprint-app/dist/"):]: sha(ROOT / name) for name in sorted(tracked)}
    # Every hash an earlier deploy script installed or accepted: the updater only replaces files it recognises.
    known = set()
    for script in ROOT.glob("deploy-imprint-*.sh"):
        known.update(re.findall(r"\b[0-9a-f]{64}\b", script.read_text(encoding="utf-8")))
    previous = ROOT / "release.json"
    if previous.exists():
        old = json.loads(previous.read_text(encoding="utf-8"))
        known.update(old.get("known", []))
        known.update(old.get("backend", {}).values())
    backend_files = ("api_loop.py", "imprint_store.py", "claude_subscription.py")
    # Every committed version of a backend file counts as known too. A deploy straight from a
    # commit (without a matching release.json) must not make the next imprint-update refuse.
    for name in backend_files:
        revs = subprocess.run(["git", "rev-list", "HEAD", "--", name], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
        for commit in revs:
            blob = subprocess.run(["git", "show", f"{commit}:{name}"], cwd=ROOT, capture_output=True, check=False).stdout
            if blob:
                known.add(hashlib.sha256(blob).hexdigest())
    backend = {name: sha(ROOT / name) for name in backend_files}
    js = next(name for name in dist if re.fullmatch(r"assets/index-[^/]+\.js", name))
    release = {"rev": rev, "backend": backend, "dist": dist, "entry_js": js, "known": sorted(known | set(backend.values()))}
    previous.write_text(json.dumps(release, indent=1) + "\n", encoding="utf-8")
    print(f"release.json -> {rev[:7]} ({len(dist)} frontend files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
