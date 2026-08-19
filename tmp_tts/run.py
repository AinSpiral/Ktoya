from pathlib import Path
import base64, gzip

root = Path(__file__).resolve().parent
raw = base64.b64decode((root / 'tts_pairs.json.gz.b64').read_text(encoding='ascii'))
(root / 'tts_pairs.json').write_bytes(gzip.decompress(raw))
code = (root / 'generate.py').read_text(encoding='utf-8')
exec(compile(code, str(root / 'generate.py'), 'exec'), {'__name__': '__main__', '__file__': str(root / 'generate.py')})
