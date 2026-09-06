"""Responsive delivery only; preserve approved ImageGen masters untouched."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MASTERS = ROOT / 'outputs/living-world-v3/masters'
DEST = ROOT / 'public/art/living-world-v3'
DEST.mkdir(parents=True, exist_ok=True)
SPECS = {'hero-desktop': [1200, 1536], 'hero-mobile': [768, 1024],
         'forest-writing': [768, 1440], 'tree-ring-clock': [640, 1200]}
records = []
for name, widths in SPECS.items():
    source = MASTERS / f'{name}.png'
    with Image.open(source) as master:
        record = {'name': name, 'master': str(source.relative_to(ROOT)),
                  'dimensions': master.size, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'derivatives': []}
        for width in widths:
            if width > master.width:
                raise ValueError(f'Refusing upscale: {name}')
            size = (width, round(master.height * width / master.width))
            derivative = master.resize(size, Image.Resampling.LANCZOS)
            for extension, quality in [('avif', 62), ('webp', 81)]:
                target = DEST / f'{name}-{width}.{extension}'
                derivative.save(target, quality=quality)
                with Image.open(target) as check:
                    assert check.size == size
                record['derivatives'].append({'file': str(target.relative_to(ROOT)), 'dimensions': size,
                    'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
        records.append(record)
(ROOT / 'outputs/living-world-v3/asset-manifest.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
print(json.dumps(records, indent=2))
