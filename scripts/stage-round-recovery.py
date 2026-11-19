"""Construct an interrupted round only inside the harness-owned, stopped service store."""
from pathlib import Path
import json
import os
import sys
import blake3

run = Path(sys.argv[1]).resolve()
workspace = Path(__file__).resolve().parents[1] / "work" / "practice-baseline"
if run.parent != workspace.resolve() or not run.name.startswith("run-"):
    raise SystemExit("Recovery fixture must stay in this harness run")
data = run / "data"
for path in [run, data, data / "performance-history", data / "web-practice-history.ron"]:
    if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
        raise SystemExit("Recovery fixture does not use linked locations")
before = (run / "round-history-before.ron").read_bytes()
info = json.loads((run / "round-before.json").read_text(encoding="utf-8"))
if len(info["ids"]) != 1:
    raise SystemExit("Expected exactly one completed round in the captured baseline")
history_path = data / "web-practice-history.ron"
after = history_path.read_bytes()
archives = []
for path in (data / "performance-history").glob("*.json"):
    if path.is_symlink():
        raise SystemExit("Recovery fixture archive is linked")
    raw = path.read_bytes()
    value = json.loads(raw)
    if value["contentId"] == info["contentId"] and value["id"] not in info["ids"]:
        archives.append((path, raw, value["id"]))
if len(archives) != 1 or before == after:
    raise SystemExit("Expected one new archive and a changed history after the second real round")
archive_path, archive, record_id = archives[0]
if len(archive_path.name) != 69 or any(c not in "0123456789abcdef" for c in archive_path.stem):
    raise SystemExit("Unexpected archive identity")
def digest(value):
    return blake3.blake3(value).hexdigest()
def durable(path, value):
    with path.open("xb") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
folder = data / "round-save-pending"
folder.mkdir()
durable(folder / "history.next", after)
durable(folder / "archive.next", archive)
intent = {"version": 1, "committed": False, "before": digest(before), "after": digest(after),
          "archive": {"name": archive_path.name, "before": None, "after": digest(archive)}}
durable(folder / "intent.json", json.dumps(intent).encode())
durable(run / "round-history-after.ron", after)
durable(run / "round-archive-after.json", archive)
# The archive has been published; history still contains only the first round.
temporary = data / "round-fixture-history.tmp"
durable(temporary, before)
os.replace(temporary, history_path)
report = {"contentId": info["contentId"], "beforeIds": info["ids"], "pendingId": record_id,
          "archive": archive_path.name, "interruption": "archive-published-history-pending"}
durable(run / "round-recovery-fixture.json", json.dumps(report, ensure_ascii=False, indent=2).encode())
print("Interrupted-round fixture staged in the isolated, stopped service store")
