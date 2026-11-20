"""Read-only relocation diagnosis. Titles select candidates; byte hashes establish matches."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import blake3


def read_json(path: Path, default):
    if not path.is_file():
        return default
    if path.stat().st_size > 64_000_000:
        raise ValueError(f"Input exceeds diagnosis limit: {path}")
    return json.loads(path.read_text(encoding="utf-8-sig"))


def inspect(profile: Path, project: Path, query: str) -> dict:
    manifest = read_json(project / "midi-info.json", {})
    canonical_name = Path(manifest["performance_midi"]).name
    canonical = project / canonical_name
    files = [canonical, *sorted((project / "versions").glob("*.mid"))]
    assets = []
    for path in files:
        if path.stat().st_size > 32_000_000:
            raise ValueError(f"MIDI exceeds diagnosis limit: {path}")
        data = path.read_bytes()
        if not data.startswith(b"MThd"):
            raise ValueError(f"Missing MIDI header: {path}")
        assets.append({
            "relativePath": path.relative_to(project).as_posix(),
            "contentId": blake3.blake3(data).hexdigest(),
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
            "sidecarPresent": Path(str(path) + ".neothesia.ron").is_file(),
        })
    by_content: dict[str, list[str]] = {}
    for asset in assets:
        by_content.setdefault(asset["contentId"], []).append(asset["relativePath"])
    workspace = read_json(profile / "library-workspace.json", {})
    preferences = read_json(profile / "web-preferences.json", {})
    candidates = []
    for entry in workspace.get("entries", {}).values():
        path = str(entry.get("path", ""))
        if query.casefold() not in path.casefold():
            continue
        cid = entry.get("contentId")
        candidates.append({
            "oldPath": path,
            "oldPathPresent": Path(path).is_file(),
            "contentId": cid,
            "exactMatches": by_content.get(cid, []),
            "savedTrackParts": preferences.get("songs", {}).get(cid, {}).get("parts", {}),
            "savedScoreVersions": len(preferences.get("scoreVersions", {}).get(cid, [])),
            "oldSidecarPresent": Path(path + ".neothesia.ron").is_file(),
        })
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "readOnly": True,
        "identityRule": "BLAKE3 of unchanged MIDI bytes; titles only select diagnosis candidates",
        "profile": str(profile),
        "project": str(project),
        "manifestCanonical": canonical_name,
        "manifestSha256MatchesCanonical": manifest.get("sha256") == assets[0]["sha256"],
        "assets": assets,
        "legacyCandidates": candidates,
        "summary": {
            "files": len(assets),
            "distinctPerformances": len(by_content),
            "legacyCandidates": len(candidates),
            "exactlyRelocatable": sum(bool(c["exactMatches"]) for c in candidates),
            "unmatched": sum(not c["exactMatches"] for c in candidates),
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--query", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    profile, project, output = args.profile.resolve(), args.project.resolve(), args.output.resolve()
    if not profile.is_dir() or not project.is_dir():
        parser.error("Profile and project must already exist")
    if output.is_relative_to(profile) or output.is_relative_to(project):
        parser.error("Report must be outside the source profile and project")
    report = inspect(profile, project, args.query)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"]))


if __name__ == "__main__":
    main()
