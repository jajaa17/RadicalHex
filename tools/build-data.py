"""Builds src/data.js and the sprite sheets.

Run tools/build-dex.js first: it writes tools/rr-tables.json (Radical Red's own move and item tables).

Sources (fetch these first, see README):
  ../pkforge   - sofianeelhor/PKForge (GPLv3): Radical Red 4.1 species ids/names
  ../pokeapi   - PokeAPI/pokeapi data/v2/csv: national ids, growth rates, gender ratios
  ../pksprites - PokeAPI/sprites sprites/pokemon (+ shiny)
"""
import csv, json, re, sys, unicodedata, os
from PIL import Image

ROOT = sys.argv[1] if len(sys.argv) > 1 else '..'
OUT = os.path.join(os.path.dirname(__file__), '..', 'src')
PK = f'{ROOT}/pkforge/src/PKForge.Engine/'
API = f'{ROOT}/pokeapi/data/v2/csv/'
SPR = f'{ROOT}/pksprites/sprites/pokemon/'

def table(path, sep='\t'):
    t = {}
    for line in open(path, encoding='utf8'):
        if line.startswith('#') or not line.strip():
            continue
        i, n = line.rstrip('\n').split(sep, 1)
        t[int(i)] = n
    return t

species = table(PK + 'RadicalRed/Data/species.txt')
rom_items = table(PK + 'RadicalRed/Data/items.txt')
rr = json.load(open(os.path.join(os.path.dirname(__file__), 'rr-tables.json'), encoding='utf8'))
FILLER = re.compile(r'^(\.|-|\?)|Free Space|DONT USE', re.I)
# Item names from Radical Red's dex; an id stays empty if either table marks it as a ROM filler slot.
items = {i: n for i, n in enumerate(rr['items']) if i and n and not FILLER.search(n) and not FILLER.search(rom_items.get(i, '.'))}
moves = {i: n for i, n in enumerate(rr['moves']) if i and n}
movepp = {i: p for i, p in enumerate(rr['pp']) if i}

pokemon = {r['identifier']: r for r in csv.DictReader(open(API + 'pokemon.csv'))}
pokemon_by_id = {r['id']: r for r in pokemon.values()}
forms = {r['identifier']: r for r in csv.DictReader(open(API + 'pokemon_forms.csv'))}
spec = {r['identifier']: r for r in csv.DictReader(open(API + 'pokemon_species.csv'))}
spec_by_id = {r['id']: r for r in spec.values()}
default_poke = {r['species_id']: r for r in pokemon.values() if r['is_default'] == '1'}
exp = {}
for r in csv.DictReader(open(API + 'experience.csv')):
    exp.setdefault(int(r['growth_rate_id']), [0] * 101)[int(r['level'])] = int(r['experience'])

def norm(n):
    n = unicodedata.normalize('NFKD', n).encode('ascii', 'ignore').decode().lower()
    n = re.sub(r"[.'’:%]", '', n)
    return re.sub(r'[\s_]+', '-', n)

ALIAS = {
    'unown-!': 'unown-exclamation', 'unown-?': 'unown-question', 'zygarde-10': 'zygarde-10',
    'necrozma-dusk-mane': 'necrozma-dusk', 'necrozma-dawn-wings': 'necrozma-dawn',
    'minior-meteor': 'minior-red-meteor', 'squawkabilly-white': 'squawkabilly-white-plumage',
    'ogerpon-wellspring': 'ogerpon-wellspring-mask', 'ogerpon-hearthflame': 'ogerpon-hearthflame-mask',
    'ogerpon-cornerstone': 'ogerpon-cornerstone-mask', 'cherrim-sunshine': 'cherrim-sunshine',
}
# Same-name form slots, by Radical Red id.
BY_ID = {
    853: 'pumpkaboo-small', 854: 'pumpkaboo-large', 855: 'pumpkaboo-super',
    856: 'gourgeist-small', 857: 'gourgeist-large', 858: 'gourgeist-super',
    1065: 'minior-orange', 1066: 'minior-yellow', 1067: 'minior-green', 1068: 'minior-blue',
    1069: 'minior-indigo', 1070: 'minior-violet', 1071: 'minior-red',
}
for p in ('original', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'partner'):
    ALIAS[f'pikachu-{p}'] = f'pikachu-{p}-cap'

def sprite_file(poke_row, form_row=None):
    if form_row is not None and pokemon_by_id[form_row['pokemon_id']]['is_default'] == '1' and form_row['form_identifier']:
        f = f"{poke_row['species_id']}-{form_row['form_identifier']}"
        if os.path.exists(SPR + f + '.png'):
            return f
    return poke_row['id'] if os.path.exists(SPR + poke_row['id'] + '.png') else None

def resolve(rid, name):
    """-> (pokemon row, sprite key, exact) or None"""
    k = norm(name)
    cands = [BY_ID.get(rid), ALIAS.get(k), k, k + '-breed', k.replace('-mega', '-gmax'),
             re.sub(r'-f$', '-female', k), re.sub(r'-f$', '-female', k) and None]
    for c in filter(None, cands):
        if c in pokemon:
            return pokemon[c], sprite_file(pokemon[c]), True
        if c in forms:
            row = pokemon_by_id[forms[c]['pokemon_id']]
            return row, sprite_file(row, forms[c]), True
    parts = k.split('-')
    while parts:
        c = '-'.join(parts)
        if c in spec:
            row = default_poke[spec[c]['id']]
            return row, sprite_file(row), False
        parts.pop()
    return None

GENDER = {-1: 255, 0: 0, 1: 31, 2: 63, 4: 127, 6: 191, 7: 225, 8: 254}
BATTLE_ONLY = re.compile(r'-(Mega|Primal|Gmax|Gigantamax|Eternamax|Ultra|Busted|School|Zen|Blade|Pirouette|Crowned|Sunshine|Hangry|Noice|Complete|Stellar)\b')
out_species, sprites, missing = [], [], []
sprite_index = {}
maxid = max(species)
for rid in range(maxid + 1):
    name = species.get(rid, '')
    valid = rid > 0 and name and name not in ('.', 'Bad.Egg') and not name.startswith('-')
    entry = {'n': name if valid else ''}
    if valid:
        res = resolve(rid, name)
        if res is None:
            missing.append((rid, name))
        else:
            row, key, exact = res
            sp = spec_by_id[row['species_id']]
            entry.update(nat=int(row['species_id']), g=int(sp['growth_rate_id']), gr=GENDER[int(sp['gender_rate'])])
            if key is not None:
                if key not in sprite_index:
                    sprite_index[key] = len(sprites)
                    sprites.append(key)
                entry['s'] = sprite_index[key]
        if BATTLE_ONLY.search(name):
            entry['b'] = 1
    out_species.append(entry)

print('species', len(out_species), 'no data:', missing)
print('sprites', len(sprites))

def fit(im, room=88):
    """Trims empty space and enlarges small sprites by a whole-number factor, so pixel art stays crisp."""
    box = im.getbbox()
    if not box:
        return im
    im = im.crop(box)
    k = max(1, min(room // im.width, room // im.height))
    return im.resize((im.width * k, im.height * k), Image.NEAREST) if k > 1 else im

# Sprite sheets: 96x96 cells, 40 per row.
COLS, CELL = 40, 96
rows = (len(sprites) + COLS - 1) // COLS
for folder, fname in (('', 'sprites.png'), ('shiny/', 'sprites-shiny.png')):
    sheet = Image.new('RGBA', (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    for i, key in enumerate(sprites):
        path = SPR + folder + key + '.png'
        if not os.path.exists(path):
            path = SPR + key + '.png'
        im = fit(Image.open(path).convert('RGBA'))
        sheet.paste(im, ((i % COLS) * CELL + (CELL - im.width) // 2, (i // COLS) * CELL + (CELL - im.height) // 2))
    sheet.save(os.path.join(OUT, 'assets', fname), optimize=True)

# The game's own short spellings for names longer than 10 letters, as stored in real saves.
NICK = {'Dudunsparce': 'Dudunsprce', 'Basculegion': 'Basclegion', 'Crabominable': 'Crabminble', 'Blacephalon': 'Blacphalon',
        'Corviknight': 'Corvknight', 'Barraskewda': 'Baraskewda', 'Centiskorch': 'Centskorch', 'Polteageist': 'Poltegeist',
        'Stonjourner': 'Stonjorner', 'Meowscarada': 'Meowscrada', 'Squawkabilly': 'Squawkbily', 'Kilowattrel': 'Kilowattrl',
        'Brambleghast': 'Bramblgast'}
nick = {}
for e in out_species:
    if e['n'] in NICK and 'nat' in e:
        nick[e['nat']] = NICK[e['n']]

arr = lambda t, lim: [t.get(i, '') for i in range(lim + 1)]
data = {
    'species': out_species,
    'items': arr(items, max(items)),
    'moves': arr(moves, max(moves)),
    'pp': [int(x or 0) for x in arr(movepp, max(moves))],
    'exp': [exp[g] for g in range(1, 7)],
    'nick': nick,
    'spriteCols': COLS,
    'spriteRows': rows,
}
with open(os.path.join(OUT, 'data.js'), 'w', encoding='utf8') as f:
    f.write('// Generated by tools/build-data.py. Do not edit by hand.\nwindow.RH_DATA = ')
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
