"""Bundled Panthesia adapter for the local DuET runtime. No downloads or audio transcription."""
import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict, deque
from pathlib import Path


def source_notes(path):
    """Keep DuET's retained input order, with original MIDI event identities."""
    import mido
    from duet.midi import read_performance_midi
    midi = mido.MidiFile(str(path))
    events = []
    for track, messages in enumerate(midi.tracks):
        tick = 0
        for order, message in enumerate(messages):
            tick += message.time
            events.append((tick, track, order, message))
    active, counters, notes = defaultdict(deque), defaultdict(int), []
    seconds, previous_tick, tempo = 0.0, 0, 500000
    for tick, track, _, message in sorted(events, key=lambda row: row[:3]):
        seconds += mido.tick2second(tick - previous_tick, midi.ticks_per_beat, tempo)
        previous_tick = tick
        if message.type == 'set_tempo':
            tempo = message.tempo
        elif message.type in ('note_on', 'note_off'):
            key = track, message.channel, message.note
            if message.type == 'note_on' and message.velocity > 0:
                note = dict(track=track, source_index=counters[track], pitch=message.note,
                            start=seconds, end=None)
                counters[track] += 1
                notes.append(note)
                active[key].append(note)
            elif active[key]:
                note = active[key].popleft()
                if seconds > note['start']:
                    note['end'] = seconds
    retained = [note for note in notes if note['end'] is not None]
    official = read_performance_midi(path)
    if len(retained) != len(official['ref_pitch']):
        raise RuntimeError('DuET input cleanup changed; update the source identity adapter.')
    for i, note in enumerate(retained):
        if (note['pitch'] != int(official['ref_pitch'][i])
                or abs(note['start'] - float(official['ref_onset'][i])) > 1e-6
                or abs(note['end'] - float(official['ref_offset'][i])) > 1e-6):
            raise RuntimeError('DuET input order changed; update the source identity adapter.')
    return retained


def install_engraving_identity(source, content_id):
    """Versioned local bridge for DuET's readable writer.

    Capture the exact input dict used by pitch_el, including tied pieces and
    grace notes. Accidentals also use Speller; those calls are excluded. The
    output count and every written pitch are verified before adding source IDs.
    A changed DuET writer fails here rather than publishing guessed identities.
    """
    from duet.readable import musicxml
    original_write, original_speller = musicxml.write, musicxml.Speller
    calls = []

    class TrackedSpeller(original_speller):
        def spell(self, note):
            if sys._getframe(1).f_code.co_name == 'pitch_el':
                if not isinstance(note, dict) or 'i' not in note:
                    raise RuntimeError('DuET engraving no longer exposes the input note identity.')
                calls.append((int(note['i']), int(note['pitch'])))
            return super().spell(note)

    def write(plan, ctx, path):
        calls.clear()
        musicxml.Speller = TrackedSpeller
        try:
            original_write(plan, ctx, path)
        finally:
            musicxml.Speller = original_speller
        xml = Path(path).read_text(encoding='utf-8')
        cursor = 0

        def annotate(match):
            nonlocal cursor
            node = ET.fromstring(match.group())
            pitch = node.find('pitch')
            if pitch is None:
                return match.group()
            if cursor >= len(calls):
                raise RuntimeError('DuET engraving identity count differs from the written score.')
            input_id, expected_pitch = calls[cursor]
            cursor += 1
            actual = (int(pitch.findtext('octave')) + 1) * 12
            actual += dict(C=0, D=2, E=4, F=5, G=7, A=9, B=11)[pitch.findtext('step')]
            actual += int(pitch.findtext('alter', '0'))
            if not 0 <= input_id < len(source) or actual != expected_pitch or source[input_id]['pitch'] != actual:
                raise RuntimeError('DuET engraving pitch differs from its source identity.')
            note = source[input_id]
            identity = f"panthesia1-{content_id}-{note['track']}-{note['source_index']}-{actual}-{round(note['start'] * 1e6)}-{round(note['end'] * 1e6)}-{input_id}-{cursor}"
            return match.group().replace('<note', f'<note id="{identity}"', 1)

        xml = re.sub(r'<note(?:\s[^>]*)?>.*?</note>', annotate, xml, flags=re.S)
        if cursor != len(calls):
            raise RuntimeError('DuET engraving emitted unmatched input identities.')
        Path(path).write_text(xml, encoding='utf-8')

    musicxml.write = write
    from duet.readable import pipeline
    pipeline.write = write


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--probe', type=Path)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--title', default='钢琴乐谱')
    parser.add_argument('--source-content-id')
    parser.add_argument('--device', choices=['auto', 'cuda', 'cpu'], default='auto')
    args = parser.parse_args()
    if args.probe:
        spec = importlib.util.find_spec('duet')
        if not spec or not spec.submodule_search_locations:
            raise RuntimeError('The configured Python runtime does not have duet-score installed.')
        package = Path(next(iter(spec.submodule_search_locations)))
        implementation = hashlib.sha256()
        for file in sorted(package.rglob('*.py')):
            implementation.update(file.relative_to(package).as_posix().encode())
            implementation.update(bytes.fromhex(digest(file)))
        report = {'duet_version': importlib.metadata.version('duet-score'),
                  'torch_version': importlib.metadata.version('torch'),
                  'implementation': implementation.hexdigest(),
                  'weights': digest(args.model / 'model.safetensors'),
                  'config': digest(args.model / 'config.json')}
        args.probe.write_text(json.dumps(report), encoding='utf-8')
        return
    if not args.input or not args.output:
        parser.error('--input and --output are required for generation')
    if not args.source_content_id or not re.fullmatch('[a-f0-9]{64}', args.source_content_id):
        parser.error('--source-content-id is required for generation')
    import torch
    from duet import DuET
    source = source_notes(args.input)
    install_engraving_identity(source, args.source_content_id)
    torch.set_num_threads(2)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    device = ('cuda' if torch.cuda.is_available() else 'cpu') if args.device == 'auto' else args.device
    model = DuET.from_pretrained(str(args.model), device=device, local_files_only=True)
    model.transcribe(str(args.input), args.output, title=args.title,
                     progress=lambda window: print(json.dumps(window), flush=True))
    (args.output / 'input-identity.json').write_text(json.dumps(source), encoding='utf-8')


if __name__ == '__main__':
    main()
