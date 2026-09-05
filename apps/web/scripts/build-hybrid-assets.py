"""Resize approved original masters; no creative edits or background synthesis."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MASTERS = ROOT / 'outputs/hybrid-art/masters'
DEST = ROOT / 'public/art/life-book'
DEST.mkdir(parents=True, exist_ok=True)
specs = {'forest-desktop': [1200, 1584], 'forest-mobile': [768, 1024], 'book': [560, 1120]}
records = []
for name, widths in specs.items():
    source = MASTERS / f'{name}.png'
    with Image.open(source) as master:
        if name == 'book' and (master.mode != 'RGBA' or master.getextrema()[3] != (0, 255)):
            raise ValueError('Book must contain actual alpha')
        record = {'name': name, 'master': str(source), 'dimensions': master.size,
                  'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'derivatives': []}
        for width in widths:
            if width > master.width:
                raise ValueError('Do not upscale masters')
            size = (width, round(master.height * width / master.width))
            resized = master.resize(size, Image.Resampling.LANCZOS)
            for extension, quality in [('avif', 66), ('webp', 83)]:
                target = DEST / f'{name}-{width}.{extension}'
                resized.save(target, quality=quality)
                with Image.open(target) as check:
                    assert check.size == size
                    if name == 'book':
                        assert check.mode == 'RGBA' and check.getextrema()[3] == (0, 255)
                record['derivatives'].append({'file': str(target.relative_to(ROOT)), 'dimensions': size,
                    'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
        records.append(record)
output = ROOT / 'outputs/hybrid-art/asset-manifest.json'
output.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(records, ensure_ascii=False, indent=2))
