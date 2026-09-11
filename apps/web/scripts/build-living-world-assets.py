"""Build responsive derivatives from approved original living-world masters."""

import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
MASTERS = ROOT / "outputs/living-world/masters"
DEST = ROOT / "public/art/living-world"
DEST.mkdir(parents=True, exist_ok=True)

SPECS = {
    "hero-desktop": [1200, 1584],
    "hero-mobile": [768, 1024],
    "ancestry-roots": [640, 1200],
}

records = []
for name, widths in SPECS.items():
    source = MASTERS / f"{name}.png"
    with Image.open(source) as master:
        record = {
            "name": name,
            "master": str(source),
            "dimensions": master.size,
            "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "derivatives": [],
        }
        for width in widths:
            if width > master.width:
                raise ValueError(f"Refusing to upscale {name}: {width} > {master.width}")
            size = (width, round(master.height * width / master.width))
            resized = master.resize(size, Image.Resampling.LANCZOS)
            for extension, quality in (("avif", 67), ("webp", 84)):
                target = DEST / f"{name}-{width}.{extension}"
                resized.save(target, quality=quality)
                with Image.open(target) as check:
                    if check.size != size:
                        raise ValueError(f"Bad derivative dimensions: {target}")
                record["derivatives"].append(
                    {
                        "file": str(target.relative_to(ROOT)),
                        "dimensions": size,
                        "bytes": target.stat().st_size,
                        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                    }
                )
        records.append(record)

manifest = ROOT / "outputs/living-world/asset-manifest.json"
manifest.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(records, ensure_ascii=False, indent=2))
