"""Bundled Panthesia adapter for the local DuET runtime. No downloads or audio transcription."""
import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
from pathlib import Path


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
    import torch
    from duet import DuET
    torch.set_num_threads(2)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    device = ('cuda' if torch.cuda.is_available() else 'cpu') if args.device == 'auto' else args.device
    model = DuET.from_pretrained(str(args.model), device=device, local_files_only=True)
    model.transcribe(str(args.input), args.output, title=args.title,
                     progress=lambda window: print(json.dumps(window), flush=True))


if __name__ == '__main__':
    main()
