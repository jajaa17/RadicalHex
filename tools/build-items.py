"""Builds the item icons in src/assets/items (<item id>.png, 24x24) from Radical Red's own item graphics.

Run it after tools/build-data.py, which writes the item table in src/data.js.

Usage: python3 tools/build-items.py <sources folder>, which must contain:
  <sources>/jwdex - github.com/JwowSquared/Radical-Red-Pokedex (graphics/items/<item id>.png, same ids as the save)
"""
import json, os, sys
from PIL import Image

ROOT = sys.argv[1] if len(sys.argv) > 1 else '..'
SRC = os.path.join(ROOT, 'jwdex', 'graphics', 'items')
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'items')

data = json.loads(open(os.path.join(os.path.dirname(__file__), '..', 'src', 'data.js'), encoding='utf8').read().split('= ', 1)[1].rstrip().rstrip(';'))
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    os.remove(os.path.join(OUT, f))
count = 0
for i, name in enumerate(data['items']):
    if not i or not name:
        continue
    im = Image.open(os.path.join(SRC, f'{i}.png'))
    if im.mode != 'P' or im.size != (24, 24):
        raise SystemExit(f'item {i} ({name}): expected a 24x24 paletted image')
    # GBA graphics: palette colour 0 is the transparent background.
    im.save(os.path.join(OUT, f'{i}.png'), transparency=0, optimize=True)
    count += 1
print(f'item icons {count}')
