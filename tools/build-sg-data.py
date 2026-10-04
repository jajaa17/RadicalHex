"""Builds src/sg-data.js, src/sg-dex.js and the SoulGold sprites and item icons in src/assets/sg.

SoulGold (github.com/Eemeliri/soulgold) is built on pokeemerald-expansion. Instead of reading its C sources by hand,
this compiles the game's own data tables with the ARM compiler the game is built with, and reads the numbers from the
assembly output, so every id, learnset and evolution is exactly what the game uses.

Usage: python3 tools/build-sg-data.py <soulgold repo> <arm-none-eabi-gcc>
The repo must have its host tools built (make tools) and its generated headers made:
  make src/data/pokemon/teachable_learnsets.h graphics/pokemon/spinda/spots/spot_{0,1,2,3}.1bpp
Docs data (docs/data/*.json in the repo) is used only for encounter locations.
"""
import json, os, re, subprocess, sys, tempfile
from PIL import Image

REPO, GCC = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src')
TMP = tempfile.mkdtemp(prefix='sgdata-')
DEFS = ['-iquote', 'include', '-iquote', 'gflib', '-iquote', '.', '-DMODERN=1', '-DTESTING=0', '-DEMERALD', '-DRELEASE', '-std=gnu17']
CFLAGS = ['-mthumb', '-mthumb-interwork', '-mabi=apcs-gnu', '-mtune=arm7tdmi', '-march=armv4t', '-O0', '-std=gnu17', '-w', '-fno-toplevel-reorder']


def compile_c(src, name):
    """Compiles one C file of the game (or our probe) to assembly. Graphics (INCBIN) are left out; strings go
    through the game's own preproc so they come out in the game's text encoding."""
    pre = subprocess.run([GCC, '-E', *DEFS, src], cwd=REPO, capture_output=True, text=True, encoding='latin-1', check=True).stdout
    open(os.path.join(TMP, name + '.i'), 'w', encoding='latin-1').write(pre)
    pre = re.sub(r'INCBIN_[A-Z0-9]+\(\s*"[^"]*"(\s*,\s*"[^"]*")*\s*\)', '{0}', pre)
    pp = subprocess.run(['tools/preproc/preproc', '-i', src, 'charmap.txt'], cwd=REPO, input=pre, capture_output=True, text=True, encoding='latin-1', check=True).stdout
    out = os.path.join(TMP, name + '.s')
    subprocess.run([GCC, *CFLAGS, '-x', 'c', '-S', '-o', out, '-'], cwd=REPO, input=pp, text=True, encoding='latin-1', check=True)
    return out


# ── Reading GNU assembler data ──
LABEL = re.compile(r'^([A-Za-z_.$][\w.$]*):\s*$')


def unescape(s):
    out, i = bytearray(), 0
    while i < len(s):
        c = s[i]
        if c == '\\':
            n = s[i + 1]
            if n in '01234567':
                j, v = i + 1, ''
                while j < len(s) and len(v) < 3 and s[j] in '01234567':
                    v += s[j]; j += 1
                out.append(int(v, 8)); i = j; continue
            out.append({'n': 10, 't': 9, 'r': 13, '"': 34, '\\': 92, 'b': 8, 'f': 12}.get(n, ord(n))); i += 2; continue
        out += c.encode('latin-1'); i += 1
    return out


def parse_asm(path):
    syms, cur = {}, None
    for line in open(path, encoding='latin-1'):
        line = line.rstrip('\n')
        m = LABEL.match(line)
        if m:
            cur = {'data': bytearray(), 'relocs': {}}
            syms[m.group(1)] = cur
            continue
        if cur is None:
            continue
        s = line.strip()
        if not s.startswith('.'):
            if s and not s.startswith('@'):
                cur = None  # code, not data
            continue
        d, _, arg = s.partition('\t') if '\t' in s else s.partition(' ')
        arg = arg.strip()
        items = [a.strip() for a in arg.split(',') if a.strip()]
        if d == '.byte':
            for a in items: cur['data'].append(int(a, 0) & 255)
        elif d in ('.short', '.2byte', '.hword'):
            for a in items: cur['data'] += (int(a, 0) & 0xFFFF).to_bytes(2, 'little')
        elif d in ('.word', '.4byte', '.long'):
            for a in items:
                try:
                    cur['data'] += (int(a, 0) & 0xFFFFFFFF).to_bytes(4, 'little')
                except ValueError:
                    cur['relocs'][len(cur['data'])] = a
                    cur['data'] += bytes(4)
        elif d in ('.space', '.zero'):
            cur['data'] += bytes(int(items[0], 0))
        elif d == '.ascii':
            cur['data'] += unescape(arg[1:-1])
        elif d in ('.string', '.asciz'):
            cur['data'] += unescape(arg[1:-1]) + b'\0'
    return syms


u8 = lambda b, o: b[o]
u16 = lambda b, o: b[o] | b[o + 1] << 8
u32 = lambda b, o: int.from_bytes(b[o:o + 4], 'little')
bits = lambda b, pos, n: (int.from_bytes(b[pos // 8:pos // 8 + 4].ljust(4, b'\0'), 'little') >> (pos % 8)) & ((1 << n) - 1)

# ── The game's text encoding ──
DEC = {}
for line in open(os.path.join(REPO, 'charmap.txt'), encoding='utf8'):
    m = re.match(r"^'(.+)'\s*=\s*([0-9A-Fa-f]{2})\s*$", line)
    if m and len(m.group(1)) == 1 and int(m.group(2), 16) not in DEC:
        DEC[int(m.group(2), 16)] = m.group(1)
DEC[0x00] = ' '


def text(b, o=0, n=None):
    s = ''
    for c in b[o:(o + n) if n else len(b)]:
        if c == 0xFF:
            break
        s += DEC.get(c, '')
    return s.strip()


# ── Compile ──
probe = os.path.join(TMP, 'probe.c')
open(probe, 'w').write(open(os.path.join(HERE, 'sg-probe.c')).read())
P = {}
for k, v in parse_asm(compile_c(probe, 'probe')).items():
    if k[:2] in ('P_', 'S_', 'K_'):
        P[k[2:]] = u32(v['data'], 0)
    elif k.startswith('B_'):
        d = v['data']
        on = [i for i in range(len(d) * 8) if d[i // 8] >> (i % 8) & 1]
        P[k[2:]] = (on[0], len(on))
FILES = {name: parse_asm(compile_c(f'src/{name}.c', name)) for name in ('pokemon', 'item', 'move', 'region_map')}
# Each table is read together with the file it was compiled in: local labels (.LC0 and so on) repeat between files.
asm = FILES['pokemon']
pre = ''.join(open(os.path.join(TMP, n + '.i'), encoding='latin-1').read() for n in ('pokemon', 'item'))
pre += subprocess.run([GCC, '-E', *DEFS, 'src/graphics.c'], cwd=REPO, capture_output=True, text=True, encoding='latin-1', check=True).stdout
GFX = dict(re.findall(r'\b(g\w+)\[\]\s*=\s*INCBIN_U(?:8|16|32)\(\s*"([^"]+)"', pre))


CUR = [asm]


def sym(name):
    return CUR[0].get(name.split('+')[0])


def ref(blob, off):
    return blob['relocs'].get(off)


def string_at(blob, off):
    r = ref(blob, off)
    if not r:
        return ''
    s = sym(r)
    return text(s['data']) if s else ''


def u16_list(r, end):
    out, s = [], sym(r) if r else None
    if not s:
        return out
    for o in range(0, len(s['data']) - 1, 2):
        v = u16(s['data'], o)
        if v == end:
            break
        out.append(v)
    return out


# ── Moves, abilities, items, map sections ──
CUR[0] = FILES['move']
MV, mvb = P['MoveInfo'], CUR[0]['gMovesInfo']
moves, pp = [], []
for i in range(P['MOVES_COUNT']):
    o = i * MV
    moves.append(string_at(mvb, o + P['MoveInfo__name']) if i else '')
    pp.append(u8(mvb['data'], o + P['MoveInfo__pp']) if i else 0)
moves = [('' if n in ('-', '') else n) for n in moves]

CUR[0] = FILES['pokemon']
AB, abb = P['AbilityInfo'], CUR[0]['gAbilitiesInfo']
abilities = [text(abb['data'], i * AB + P['AbilityInfo__name'], 17) if i else '' for i in range(P['ABILITIES_COUNT'])]
abilities = [('' if n.startswith('---') else n) for n in abilities]

CUR[0] = FILES['item']
IT, itb = P['ItemInfo'], CUR[0]['gItemsInfo']
POCKETS = ['', 'items', 'medicine', 'balls', 'tms', 'berries', 'key', 'megas', 'battle']  # filled from the enum below
items, item_pocket, item_ball, item_icon = [], {}, {}, {}
for i in range(P['ITEMS_COUNT']):
    o = i * IT
    n = string_at(itb, o + P['ItemInfo__name']) if i else ''
    if n in ('????????', '?????', '') or n.startswith('?'):
        n = ''
    items.append(n)
    if n:
        pk = bits(itb['data'], o * 8 + P['pocket'][0], P['pocket'][1])
        item_pocket[i] = pk
        item_ball[i] = u16(itb['data'], o + P['ItemInfo__secondaryId'])
        ic, pal = ref(itb, o + P['ItemInfo__iconPic']), ref(itb, o + P['ItemInfo__iconPalette'])
        if ic and pal and GFX.get(ic) and GFX.get(pal):
            item_icon[i] = (GFX[ic], GFX[pal])

CUR[0] = FILES['region_map']
RM, rmb = P['RegionMapLocation'], CUR[0]['gRegionMapEntries']
mapsecs = [string_at(rmb, i * RM + P['RegionMapLocation__name']) for i in range(len(rmb['data']) // RM)]

# ── Species ──
CUR[0] = FILES['pokemon']
SI, spb = P['SpeciesInfo'], CUR[0]['gSpeciesInfo']
exp_tables = []
xb = asm['gExperienceTables']['data']
for g in range(len(xb) // (101 * 4)):
    exp_tables.append([u32(xb, (g * 101 + L) * 4) for L in range(101)])

species = []
for i in range(P['NUM_SPECIES']):
    o = i * SI
    b = spb['data']
    name = text(b, o + P['SpeciesInfo__speciesName'], 13) if i else ''
    st = [b[o + k] for k in range(6)]  # HP, Atk, Def, Speed, SpAtk, SpDef
    lv_ref = ref(spb, o + P['SpeciesInfo__levelUpLearnset'])
    levelup = []
    if lv_ref and sym(lv_ref):
        d = sym(lv_ref)['data']
        for k in range(0, len(d) - 3, P['LevelUpMove']):
            m = u16(d, k + P['LevelUpMove__move'])
            if m == P['LEVEL_UP_MOVE_END']:
                break
            levelup.append([m, u16(d, k + P['LevelUpMove__level'])])
    evos = []
    ev_ref = ref(spb, o + P['SpeciesInfo__evolutions'])
    if ev_ref and sym(ev_ref):
        d = sym(ev_ref)['data']
        for k in range(0, len(d) - 5, P['Evolution']):
            meth = u16(d, k + P['Evolution__method'])
            if meth == P['EVOLUTIONS_END']:
                break
            evos.append([meth, u16(d, k + P['Evolution__param']), u16(d, k + P['Evolution__targetSpecies'])])
    flags = {f: bits(b, o * 8 + P[f][0], 1) for f in ('isMega', 'isPrimal', 'isGmax', 'isUB', 'isTera', 'isTotem')}
    species.append({
        'name': name, 'st': st, 't': [b[o + P['SpeciesInfo__types']], b[o + P['SpeciesInfo__types'] + 1]],
        'gr': b[o + P['SpeciesInfo__genderRatio']], 'growth': b[o + P['SpeciesInfo__growthRate']],
        'ab': [u16(b, o + P['SpeciesInfo__abilities'] + 2 * k) for k in range(3)],
        'inn': [u16(b, o + P['SpeciesInfo__innates'] + 2 * k) for k in range(3)],
        'nat': bits(b, o * 8 + P['natDexNum'][0], 16),
        'lv': levelup, 'tm': u16_list(ref(spb, o + P['SpeciesInfo__teachableLearnset']), P['MOVE_UNAVAILABLE']),
        'egg': u16_list(ref(spb, o + P['SpeciesInfo__eggMoveLearnset']), P['MOVE_UNAVAILABLE']),
        'evo': evos, 'forms': u16_list(ref(spb, o + P['SpeciesInfo__formSpeciesIdTable']), P['FORM_SPECIES_END']),
        'front': GFX.get(ref(spb, o + P['SpeciesInfo__frontPic']) or ''),
        'pal': GFX.get(ref(spb, o + P['SpeciesInfo__palette']) or ''),
        'spal': GFX.get(ref(spb, o + P['SpeciesInfo__shinyPalette']) or ''),
        'battleOnly': any(flags.values()),
    })

json.dump({'probe': P, 'moves': moves, 'pp': pp, 'abilities': abilities, 'items': items, 'item_pocket': item_pocket,
           'item_ball': item_ball, 'item_icon': item_icon, 'mapsecs': mapsecs, 'exp': exp_tables, 'species': species},
          open(os.path.join(TMP, 'sg.json'), 'w'))
print('extracted to', os.path.join(TMP, 'sg.json'))
print(f"species {len(species)}, moves {len(moves)}, abilities {len(abilities)}, items {len(items)}, mapsecs {len(mapsecs)}, growth tables {len(exp_tables)}")

# ── Output ──
D = {'probe': P}
TYPES = ['None', 'Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', '???', 'Fire', 'Water',
         'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark', 'Fairy', 'Stellar']
TYPE_COLORS = {'Normal': '#A8A77A', 'Fighting': '#C22E28', 'Flying': '#A98FF3', 'Poison': '#A33EA1', 'Ground': '#E2BF65', 'Rock': '#B6A136',
               'Bug': '#A6B91A', 'Ghost': '#735797', 'Steel': '#B7B7CE', '???': '#68A090', 'Fire': '#EE8130', 'Water': '#6390F0', 'Grass': '#7AC74C',
               'Electric': '#F7D02C', 'Psychic': '#F95587', 'Ice': '#96D9D6', 'Dragon': '#6F35FC', 'Dark': '#705746', 'Fairy': '#D685AD', 'Stellar': '#40B5A5', 'None': '#888888'}

# Species constants, for form names (SPECIES_TYPHLOSION_HISUI -> Typhlosion-Hisui).
const_of = {}
for name, val in re.findall(r'^#define\s+(SPECIES_\w+)\s+(\d+)\s*$', open(os.path.join(REPO, 'include/constants/species.h')).read(), re.M):
    const_of.setdefault(int(val), name)
docs_names = {}
try:
    for s in json.load(open(os.path.join(REPO, 'docs/data/species.json'), encoding='utf8')):
        docs_names[s['id']] = s['name']
except OSError:
    pass
first_of_nat = {}
for i, s in enumerate(species):
    if i and s['name'] and s['nat'] and s['nat'] not in first_of_nat:
        first_of_nat[s['nat']] = i


def display_name(i):
    s = species[i]
    if not s['name']:
        return ''
    if docs_names.get(i) and docs_names[i].replace('’', "'") != s['name'].replace('’', "'"):
        return docs_names[i]
    base = first_of_nat.get(s['nat'])
    if base is None or base == i:
        return s['name']
    bc, c = const_of.get(base, ''), const_of.get(i, '')
    suffix = c[len(bc) + 1:] if c.startswith(bc + '_') else c.replace('SPECIES_', '')
    return s['name'] + ('-' + '-'.join(w.capitalize() for w in suffix.split('_')) if suffix else '')


# Sprites: the first 64x64 frame of the game's own front picture, with its palette (colour 0 is transparent).
def read_pal(path):
    lines = open(path).read().split('\n')
    n = int(lines[2])
    return [tuple(int(x) for x in lines[3 + k].split()) for k in range(n)]


def render(png, pal, size):
    im = Image.open(png)
    if im.mode != 'P':
        return None
    w, h = im.size
    idx = im.crop((0, 0, min(w, size), min(h, size))).load()
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    px = out.load()
    for y in range(min(h, size)):
        for x in range(min(w, size)):
            c = idx[x, y] & 15
            if c and c < len(pal):
                px[x, y] = pal[c] + (255,)
    return out


def gfx_png(p):
    return os.path.join(REPO, re.sub(r'\.(4bpp|8bpp)(\.smol|\.lz|\.rl)?$', '.png', p))


def gfx_pal(p):
    return os.path.join(REPO, re.sub(r'\.gbapal(\.lz)?$', '.pal', p))


SPR = os.path.join(OUT, 'assets', 'sg', 'sprites')
for d in (SPR, os.path.join(SPR, 'shiny'), os.path.join(OUT, 'assets', 'sg', 'items')):
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        if f.endswith('.png'):
            os.remove(os.path.join(d, f))
sprite_index, sprite_count = {}, 0
out_species = []
for i, s in enumerate(species):
    e = {'n': display_name(i)}
    if e['n'] and i != P['SPECIES_EGG']:
        e['nn'] = s['name'] if s['name'] != e['n'] else None
        if e['nn'] is None:
            del e['nn']
        e['nat'] = s['nat']
        e['g'] = s['growth'] + 1
        e['gr'] = s['gr']
        if s['battleOnly']:
            e['b'] = 1
        key = (s['front'], s['pal'])
        if s['front'] and s['pal'] and os.path.exists(gfx_png(s['front'])) and os.path.exists(gfx_pal(s['pal'])):
            if key not in sprite_index:
                img = render(gfx_png(s['front']), read_pal(gfx_pal(s['pal'])), 64)
                if img:
                    sprite_index[key] = sprite_count
                    img.save(os.path.join(SPR, f'{sprite_count}.png'), optimize=True)
                    if s['spal'] and os.path.exists(gfx_pal(s['spal'])):
                        render(gfx_png(s['front']), read_pal(gfx_pal(s['spal'])), 64).save(os.path.join(SPR, 'shiny', f'{sprite_count}.png'), optimize=True)
                    sprite_count += 1
            if key in sprite_index:
                e['s'] = sprite_index[key]
    elif i == P['SPECIES_EGG']:
        e = {'n': ''}
    out_species.append(e)

for i, (png, pal) in item_icon.items():
    i = int(i)
    if os.path.exists(gfx_png(png)) and os.path.exists(gfx_pal(pal)):
        img = render(gfx_png(png), read_pal(gfx_pal(pal)), 24)
        if img:
            img.save(os.path.join(OUT, 'assets', 'sg', 'items', f'{i}.png'), optimize=True)

# Pockets, by the game's POCKET_* order.
POCKET_KEYS = ['items', 'medicine', 'battle', 'balls', 'tms', 'megas', 'berries', 'key']
ipocket = {int(k): POCKET_KEYS[v] for k, v in item_pocket.items() if v < len(POCKET_KEYS)}
balls = {}
for i, n in enumerate(items):
    if n and ipocket.get(i) == 'balls' and item_ball.get(str(i), item_ball.get(i)):
        b = item_ball.get(str(i), item_ball.get(i))
        balls.setdefault(b, n)
nballs = max(balls) + 1 if balls else 1
ball_names = [balls.get(b, 'Strange Ball' if b == 0 else '') for b in range(nballs)]

data = {'species': out_species, 'items': items, 'moves': moves, 'pp': pp, 'exp': exp_tables,
        'pocket': {str(k): v for k, v in sorted(ipocket.items())}, 'balls': ball_names}
open(os.path.join(OUT, 'sg-data.js'), 'w', encoding='utf8').write(
    '// Generated by tools/build-sg-data.py from the SoulGold source (github.com/Eemeliri/soulgold). Do not edit by hand.\n'
    'window.SG_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
print('sprites', sprite_count, 'items with icons', len(os.listdir(os.path.join(OUT, 'assets', 'sg', 'items'))))

# ── SoulDex ──
sid = {c: i for i, c in const_of.items()}
for name, val in re.findall(r'^#define\s+(SPECIES_\w+)\s+(SPECIES_\w+)\s*$', open(os.path.join(REPO, 'include/constants/species.h')).read(), re.M):
    if val in sid:
        sid.setdefault(name, sid[val])
docs_dir = os.path.join(REPO, 'docs/data')
live = [i for i, e in enumerate(out_species) if e['n']]
prevos = {}
for i in live:
    for meth, param, tgt in species[i]['evo']:
        if meth != 0 and tgt < len(species) and out_species[tgt]['n']:
            prevos.setdefault(tgt, []).append(i)


def ancestors(i, seen=None):
    seen = set() if seen is None else seen
    for p in prevos.get(i, []):
        if p not in seen:
            seen.add(p); ancestors(p, seen)
    return seen


def own_moves(i):
    sp = species[i]
    return {m for m, _ in sp['lv']} | set(sp['tm']) | set(sp['egg'])


def non_level(i):
    out = set()
    for a in [i, *ancestors(i)]:
        out |= set(species[a]['tm']) | set(species[a]['egg'])
    return out


def level_only(i):
    nl, best = non_level(i), {}
    for a in [i, *ancestors(i)]:
        for m, lv in species[a]['lv']:
            if not moves[m] or m in nl:
                continue
            if m not in best or lv < best[m][1]:
                best[m] = [m, lv, a]
    return sorted(best.values())


def family_base(i):
    cur, seen = i, set()
    while prevos.get(cur) and cur not in seen:
        seen.add(cur); cur = min(prevos[cur])
    return cur


details = json.load(open(os.path.join(docs_dir, 'species-details.json'), encoding='utf8')) if os.path.exists(os.path.join(docs_dir, 'species-details.json')) else {}


def evo_label(i, k, meth, param, tgt):
    d = details.get(const_of.get(i, ''), {})
    evs = [e for e in (d.get('evolutions') or []) if sid.get(e.get('target')) == tgt]
    e = evs[0] if len(evs) == 1 else (evs[k] if k < len(evs) else None)
    conds = ', '.join(e.get('conditions') or []) if e else ''
    if meth == 1:
        base = f'at Level {param}' if param else 'Level up'
    elif meth == 3:
        base = f'with the {items[param]}' if param < len(items) and items[param] else 'with an item'
    elif meth == 2:
        base = 'by trade'
    elif meth == 4:
        base = 'when another evolution happens'
    elif meth == 5:
        base = 'by an event in the world'
    elif meth == 6:
        base = f'at Level {param} in battle'
    elif meth == 7:
        base = 'after a battle'
    elif meth == 8:
        base = 'by spinning around'
    else:
        base = 'by a special method'
    return base + (f' ({conds})' if conds else '')


megas = []
try:
    for m in json.load(open(os.path.join(docs_dir, 'common.json'), encoding='utf8')).get('megaEvolutions', []):
        if m['source'] in sid and m['target'] in sid:
            megas.append((sid[m['source']], sid[m['target']], m.get('itemName') or ''))
except OSError:
    pass

out_dex = {}
STAT_ORDER = [0, 1, 2, 4, 5, 3]  # game order HP Atk Def Spe SpA SpD -> HP Atk Def SpA SpD Spe
for i in live:
    sp = species[i]
    evo = []
    seen_t = {}
    for meth, param, tgt in sp['evo']:
        if meth == 0 or tgt >= len(species) or not out_species[tgt]['n']:
            continue
        k = seen_t.get(tgt, 0); seen_t[tgt] = k + 1
        evo.append([tgt, evo_label(i, k, meth, param, tgt), 0])
    for src, tgt, item in megas:
        if src == i:
            evo.append([tgt, f'with the {item}' if item else 'by Mega Evolution', 1])
    learn = set()
    for a in [i, *ancestors(i)]:
        learn |= own_moves(a)
    out_dex[i] = {
        't': list(dict.fromkeys(sp['t'])), 'st': [sp['st'][k] for k in STAT_ORDER],
        'ab': [abilities[a] if a < len(abilities) else '' for a in sp['ab']],
        'inn': [abilities[a] for a in sp['inn'] if a and a < len(abilities) and abilities[a]],
        'nat': sp['nat'], 'anc': family_base(i), 'evo': evo,
        'lv': [[m, lv] for m, lv in sp['lv'] if m < len(moves)],
        'ln': sorted(m for m in learn if m < len(moves) and moves[m]),
        'lo': level_only(i),
    }

# Encounters (from the hack's own docs data). Fishing slots follow the game: 0-1 Old Rod, 2-4 Good Rod, 5-9 Super Rod.
areas, methods, enc = [], [], {}
METHOD = {'land_mons': 'Grass', 'water_mons': 'Surfing', 'rock_smash_mons': 'Rock Smash'}
try:
    encs = json.load(open(os.path.join(docs_dir, 'encounters.json'), encoding='utf8'))
except OSError:
    encs = []
for a in encs:
    if a['name'] not in areas:
        areas.append(a['name'])
    ai = areas.index(a['name'])
    timed = len(a['variants']) > 1
    acc = {}
    for v in a['variants']:
        for mm in v['methods']:
            for k, mon in enumerate(mm['mons']):
                if mm['key'] == 'fishing_mons':
                    label = 'Old Rod' if k < 2 else 'Good Rod' if k < 5 else 'Super Rod'
                else:
                    label = METHOD.get(mm['key'], mm['method'])
                    if timed and mm['key'] == 'land_mons':
                        label += f" ({v['time'].lower()})"
                if label not in methods:
                    methods.append(label)
                spi = sid.get(mon['species'])
                if not spi or spi not in out_dex or mon['minLevel'] is None:
                    continue
                key = (spi, methods.index(label))
                r = acc.setdefault(key, [ai, methods.index(label), 0, mon['minLevel'], mon['maxLevel']])
                r[2] += mon['rate'] or 0
                r[3] = min(r[3], mon['minLevel']); r[4] = max(r[4], mon['maxLevel'])
    for (spi, _), row in acc.items():
        enc.setdefault(spi, []).append(row)

met_names = {i: n for i, n in enumerate(mapsecs) if n}
met_names[0x7FFD] = 'Hatched from an Egg'
met_names[0x7FFE] = 'In-game trade'
met_names[0x7FFF] = 'Fateful encounter'
caps = [{'n': n, 'normal': lv, 'hardcore': lv} for n, lv in [
    ('Badge 1', 12), ('Badge 2', 19), ('Badge 3', 26), ('Badge 4', 34), ('Badge 5', 42), ('Badge 6', 45), ('Badge 7', 48),
    ('Rocket takeover', 55), ('Badge 8', 58), ('Legendary story', 62), ('Champion', 70)]]
dex = {'types': [{'id': k, 'n': n, 'c': TYPE_COLORS.get(n, '#888')} for k, n in enumerate(TYPES) if k],
       'species': {str(k): v for k, v in out_dex.items()}, 'areas': areas, 'methods': methods,
       'enc': {str(k): v for k, v in enc.items()}, 'metNames': {str(k): v for k, v in met_names.items()}, 'caps': caps}
open(os.path.join(OUT, 'sg-dex.js'), 'w', encoding='utf8').write(
    '// Generated by tools/build-sg-data.py from the SoulGold source (github.com/Eemeliri/soulgold). Do not edit by hand.\n'
    'window.SG_DEX = ' + json.dumps(dex, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(f'souldex species {len(out_dex)}, areas {len(areas)}, methods {len(methods)}, species with encounters {len(enc)}, met names {len(met_names)}')
