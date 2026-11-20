"""Download/extract the official Curated v1.2 MIDI release with portable filenames."""
import argparse
import csv
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import urllib.request
import zipfile

RELEASE_URL = "https://drive.usercontent.google.com/download?id=1jLZ8wtRwxKZz6GbxzqpLNYqsWh-TF4-r&export=download&confirm=t"
# Locally observed digest of the official public download on 2026-11-19;
# this is a reproducibility pin, not a publisher-provided checksum.
RELEASE_SHA256 = "d51ac80f80dbe947bd8fa168dcaf1e8cc722bb3357b076856404d4419a78a7a3"


def digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def portable_name(name):
    result = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name).rstrip(' .')
    if result != name or len(result) > 160:
        suffix = hashlib.sha256(name.encode('utf-8')).hexdigest()[:12]
        result = f"{Path(result).stem[:140]}__{suffix}{Path(result).suffix}"
    if result.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}:
        result = '_' + result
    return result


def prepare(archive, destination):
    if digest(archive) != RELEASE_SHA256:
        raise ValueError('Archive differs from the pinned official v1.2 download')
    destination.mkdir(parents=True, exist_ok=True)
    mappings = []
    existing_names = {}
    if (destination / 'filename-map.csv').exists():
        with (destination / 'filename-map.csv').open(encoding='utf-8-sig', newline='') as handle:
            existing_names = {r['OriginalBaseName']: Path(r['LocalPath']) for r in csv.DictReader(handle)}
    seen = set()
    with zipfile.ZipFile(archive) as release:
        for entry in release.infolist():
            original = PurePosixPath(entry.filename)
            if original.is_absolute() or '..' in original.parts:
                raise ValueError(f'Unsafe archive member: {entry.filename}')
            if entry.is_dir() or original.suffix.lower() not in {'.mid', '.midi'}:
                continue
            relative = Path("midis", *(portable_name(part) for part in original.parts[1:]))
            relative = existing_names.get(original.stem, relative)
            key = str(relative).casefold()
            if key in seen:
                # Distinct case-sensitive YouTube IDs can collide on Windows.
                suffix = hashlib.sha256(entry.filename.encode('utf-8')).hexdigest()[:12]
                relative = relative.with_name(f'{relative.stem[:140]}__{suffix}{relative.suffix}')
                key = str(relative).casefold()
                if key in seen:
                    raise ValueError(f'Filename collision: {entry.filename}')
            seen.add(key)
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            data = release.read(entry)  # Also verifies the ZIP member CRC.
            if target.exists():
                if digest(target) != hashlib.sha256(data).hexdigest():
                    raise ValueError(f'Existing source differs: {target}')
            else:
                partial = target.with_suffix(target.suffix + '.partial')
                partial.write_bytes(data)
                os.replace(partial, target)
            mappings.append({'LocalPath': str(relative), 'OriginalBaseName': original.stem})
    if len(mappings) != 7236:
        raise ValueError(f'Unexpected release size: {len(mappings)} MIDI files')
    temporary = destination / 'filename-map.csv.tmp'
    with temporary.open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=['LocalPath', 'OriginalBaseName'])
        writer.writeheader()
        writer.writerows(mappings)
    os.replace(temporary, destination / 'filename-map.csv')
    print(f'Prepared {len(mappings)} MIDI files: {destination}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, default=Path(r'D:\Music\MIDI\Datasets\_archives\giantmidi-surname-checked-v1.2.zip'))
    parser.add_argument('--destination', type=Path, default=Path(r'D:\Music\MIDI\B站纯钢琴演奏视频转MIDI\GiantMIDI-Piano\source'))
    args = parser.parse_args()
    if not args.archive.exists():
        args.archive.parent.mkdir(parents=True, exist_ok=True)
        partial = args.archive.with_suffix('.zip.partial')
        with urllib.request.urlopen(RELEASE_URL, timeout=60) as response, partial.open('wb') as output:
            shutil.copyfileobj(response, output)
        if digest(partial) != RELEASE_SHA256:
            raise ValueError('Download did not match the pinned release; retained .partial for diagnosis')
        os.replace(partial, args.archive)
    prepare(args.archive, args.destination)


if __name__ == '__main__':
    main()
