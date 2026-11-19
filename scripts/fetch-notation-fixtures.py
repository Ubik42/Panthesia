"""Fetch a small, pinned MIT MusicXML corpus; retain its source and license."""
from pathlib import Path
import hashlib, json, urllib.request
ROOT=Path(__file__).resolve().parents[1]/'panthesia-engine/assets/notation-corpus'
REV='0618bdee1bfcb965ffdd9f4e52271c909d744fd1'
BASE=f'https://raw.githubusercontent.com/w3c-cg/musicxmlTestSuite/{REV}'
FILES=['43d-MultiStaff-StaffChange.musicxml','42a-MultiVoice-TwoVoicesOnStaff-Lyrics.musicxml','24a-GraceNotes.musicxml','45b-RepeatWithAlternatives.musicxml','11c-TimeSignatures-CompoundSimple.musicxml']
ROOT.mkdir(exist_ok=True)
previous=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8')) if (ROOT/'manifest.json').exists() else []
manifest=[entry for entry in previous if entry.get('tool')]
for name in ['LICENSE']+FILES:
    url=BASE+('/' if name=='LICENSE' else '/xmlFiles/')+name
    raw=urllib.request.urlopen(url).read(); (ROOT/name).write_bytes(raw)
    old=next((entry for entry in previous if entry['file']==name and entry.get('revision')==REV),None)
    if old and old['sha256'] != hashlib.sha256(raw).hexdigest(): raise ValueError(f'Pinned fixture changed: {name}')
    manifest.append(dict(file=name,url=url,revision=REV,sha256=hashlib.sha256(raw).hexdigest(),license='MIT'))
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(f'Fetched {len(FILES)} pinned MusicXML fixtures and MIT license')
