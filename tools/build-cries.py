"""Builds the Pokémon cries in src/assets/cries (<national dex number>.ogg, small mono Opus files).

Usage: python3 tools/build-cries.py <sources folder>, which must contain:
  <sources>/cries - github.com/PokeAPI/cries (cries/pokemon/latest/<national dex number>.ogg)
Needs ffmpeg with libopus. Every form uses its species' cry.
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

ROOT = sys.argv[1] if len(sys.argv) > 1 else '..'
SRC = os.path.join(ROOT, 'cries', 'cries', 'pokemon', 'latest')
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'cries')

data = json.loads(open(os.path.join(os.path.dirname(__file__), '..', 'src', 'data.js'), encoding='utf8').read().split('= ', 1)[1].rstrip().rstrip(';'))
nats = sorted({s['nat'] for s in data['species'] if s.get('n') and s.get('nat')})
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    os.remove(os.path.join(OUT, f))

def convert(nat):
    src = os.path.join(SRC, f'{nat}.ogg')
    # Some source files are MP3 inside .ogg; ffmpeg reads either. Mono 32 kb/s Opus keeps a cry at a few KB.
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', '-map_metadata', '-1',
                    os.path.join(OUT, f'{nat}.ogg')], check=True)

with ThreadPoolExecutor(8) as pool:
    list(pool.map(convert, nats))
print(f'cries {len(nats)}')
