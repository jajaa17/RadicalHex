// Builds src/dex.js (the RadicalDex) and tools/rr-tables.json (move and item names used by build-data.py).
//
// Usage: node tools/build-dex.js <sources folder>
// The sources folder must contain:
//   jwdex/       github.com/JwowSquared/Radical-Red-Pokedex (the data behind dex.radicalred.net, Radical Red 4.1)
//   pokefirered/ github.com/pret/pokefirered (src/data/region_map/region_map_sections.json for met location names)
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', '..');
const d = eval('(' + fs.readFileSync(path.join(SRC, 'jwdex', 'data.js'), 'utf8').trim().replace(/;\s*$/, '') + ')');
const mapsecs = JSON.parse(fs.readFileSync(path.join(SRC, 'pokefirered', 'src', 'data', 'region_map', 'region_map_sections.json'), 'utf8')).map_sections;

const { species, moves, items, types, abilities } = d;
// Radical Red cuts a few Mega Stone names to fit the game's 12-letter limit; RadicalHex shows the full, official spelling.
const FULL_NAMES = { 'Charzardite X': 'Charizardite X', 'Charzardite Y': 'Charizardite Y', 'Blastoisnite': 'Blastoisinite',
  'Kangaskanite': 'Kangaskhanite', 'Aerodactlite': 'Aerodactylite', 'Houndoomnite': 'Houndoominite' };
for (const it of Object.values(items)) if (it && FULL_NAMES[it.name]) it.name = FULL_NAMES[it.name];

// Evolution descriptions are template strings in the dex data; render them once here.
function evoText(evo) {
  const tpl = d.evolutions[evo[0]];
  if (!tpl) return 'Special condition';
  return Function('evo', 'items', 'moves', 'types', 'species', 'return ' + tpl)(evo, items, moves, types, species);
}

// Stats are stored HP/Atk/Def/Spe/SpA/SpD; the app shows HP/Atk/Def/SpA/SpD/Spe.
const statOrder = s => [s[0], s[1], s[2], s[4], s[5], s[3]];

// Every move a species can know in Radical Red: level-up, TM, tutor and egg moves, plus those of its pre-evolutions.
const prevos = {};
for (const [id, s] of Object.entries(species)) for (const e of s.evolutions || []) if (e[0] !== 254) (prevos[e[2]] = prevos[e[2]] || []).push(+id);
function ownMoves(id) {
  const s = species[id], set = new Set();
  if (!s) return set;
  for (const [m] of s.levelupMoves || []) set.add(m);
  for (const i of s.tmMoves || []) set.add(d.tmMoves[i]);
  for (const i of s.tutorMoves || []) set.add(d.tutorMoves[i]);
  for (const m of s.eggMoves || []) set.add(m);
  return set;
}
function learnable(id, seen = new Set()) {
  seen.add(id);
  const set = ownMoves(id);
  for (const p of prevos[id] || []) if (!seen.has(p)) for (const m of learnable(p, seen)) set.add(m);
  return set;
}

// Moves a species can only get by levelling up (not from a TM, tutor or as an egg move, its own or a pre-evolution's),
// with the lowest level it or a pre-evolution learns each one at: [move, level, species that learns it there].
function ancestors(id, seen = new Set()) {
  for (const p of prevos[id] || []) if (!seen.has(p)) { seen.add(p); ancestors(p, seen); }
  return seen;
}
function nonLevel(id) {
  const set = new Set();
  for (const a of [+id, ...ancestors(+id)]) {
    const s = species[a];
    if (!s) continue;
    for (const i of s.tmMoves || []) set.add(d.tmMoves[i]);
    for (const i of s.tutorMoves || []) set.add(d.tutorMoves[i]);
    for (const m of s.eggMoves || []) set.add(m);
  }
  return set;
}
function levelOnly(id) {
  const nl = nonLevel(id), best = new Map();
  for (const a of [+id, ...ancestors(+id)]) for (const [m, lv] of (species[a] && species[a].levelupMoves) || []) {
    if (!moves[m] || nl.has(m)) continue;
    const cur = best.get(m);
    if (!cur || lv < cur[1]) best.set(m, [m, lv, a]);
  }
  return [...best.values()].sort((x, y) => x[0] - y[0]);
}

const outSpecies = {};
for (const [id, s] of Object.entries(species)) {
  outSpecies[id] = {
    t: [...new Set(s.type)],
    st: statOrder(s.stats),
    // The dex stores abilities as [hidden, first, second], each [ability id, which of its names this species shows].
    // Saved here in the game's slot order: [first, second, hidden], by name ('' = none).
    ab: [s.abilities[1], s.abilities[2], s.abilities[0]].map(([a, n]) => (a ? abilities[a].names[n] : '')),
    nat: s.dexID,
    anc: s.ancestor,
    evo: (s.evolutions || []).filter(e => species[e[2]]).map(e => [e[2], evoText(e), e[0] === 254 ? 1 : 0]),
    lv: (s.levelupMoves || []).map(m => [m[0], m[1]]),
    ln: [...learnable(+id)].filter(m => moves[m]).sort((a, b) => a - b),
    lo: levelOnly(+id),
  };
}

// Encounters: wild slots use FireRed's slot odds, so chances match the official location docs.
const SLOTS = {
  'wild-day': [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1],
  'wild-night': [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1],
  'wild-surf': [60, 30, 5, 4, 1],
  'wild-smash': [60, 30, 5, 4, 1],
  'wild-oldRod': [70, 30],
  'wild-goodRod': [60, 20, 20],
  'wild-superRod': [40, 40, 15, 4, 1],
};
const METHOD = {
  'wild-day': 'Grass (day)', 'wild-night': 'Grass (night)', 'wild-surf': 'Surfing', 'wild-smash': 'Rock Smash',
  'wild-oldRod': 'Old Rod', 'wild-goodRod': 'Good Rod', 'wild-superRod': 'Super Rod',
  'fixed-gift': 'Gift', 'fixed-overworld': 'Overworld', 'fixed-roaming': 'Roaming', 'fixed-trade': 'In-game trade',
  raid1: 'Raid ★1', raid2: 'Raid ★2', raid3: 'Raid ★3', raid4: 'Raid ★4', raid5: 'Raid ★5', raid6: 'Raid ★6',
};
const methods = Object.values(METHOD);
const areas = [];
const enc = {}; // species -> [[area, method, chance|null, minLv|null, maxLv|null]]
for (const a of d.areas) {
  let ai = -1;
  for (const [key, tables] of Object.entries(a)) {
    if (!METHOD[key]) continue;
    if (ai < 0) { ai = areas.length; areas.push(a.name); }
    const mi = methods.indexOf(METHOD[key]);
    for (const list of Object.values(tables)) {
      const seen = new Map();
      list.forEach((e, slot) => {
        const sp = Array.isArray(e) ? e[0] : e;
        if (!species[sp]) return;
        const k = sp;
        const row = seen.get(k) || [ai, mi, null, null, null];
        if (key.startsWith('wild')) {
          if (SLOTS[key].length !== list.length) throw new Error(`Unexpected slot count in ${a.name} ${key}`);
          row[2] = (row[2] || 0) + SLOTS[key][slot];
          row[3] = row[3] == null ? e[1] : Math.min(row[3], e[1]);
          row[4] = row[4] == null ? e[2] : Math.max(row[4], e[2]);
        }
        seen.set(k, row);
      });
      for (const [sp, row] of seen) (enc[sp] = enc[sp] || []).push(row);
    }
  }
}

// Met location names (FireRed map sections, numbered from 0; Kanto starts at 88).
const title = s => s.toLowerCase().replace(/(^|[\s.\-])([a-zé])/g, (m, p, c) => p + c.toUpperCase());
const metNames = {};
mapsecs.forEach((m, i) => { if (m.name && i >= 88) metNames[i] = title(m.name); });
// FireRed's unused "Sevii Isle N" map sections are reused by Radical Red. 157 is Professor Oak's Lab (where the starter is
// met, confirmed in the game's summary screen); the others are not known yet, so they are not given a made-up place name.
metNames[157] = "Professor Oak's Lab";
for (const i of [155, 156, 158, 171, 172, 173]) metNames[i] = `Radical Red place #${i}`;
metNames[253] = 'Hatched from an Egg';
metNames[254] = 'In-game trade';
metNames[255] = 'Fateful encounter';

// Level caps (Normal / Hardcore) in story order.
const capName = n => n.replace(/-(\d)$/, (m, k) => ` (${['', '1st', '2nd', '3rd'][k] || k + 'th'})`).replace('Elite (4th)', 'Elite Four').replace('Elite-4', 'Elite Four').replace('Post-Game', 'Post-game');
const caps = Object.entries(d.caps).sort((a, b) => a[1].ID - b[1].ID).map(([n, c]) => ({ n: capName(n), normal: c.cap[0], hardcore: c.cap[1] }));

const dex = {
  types: Object.values(types).sort((a, b) => a.ID - b.ID).map(t => ({ id: t.ID, n: t.name, c: t.color })),
  species: outSpecies,
  areas, methods, enc, metNames, caps,
  // What each ability does (Radical Red's own descriptions), by every name it is shown under.
  abd: Object.fromEntries(Object.values(abilities).flatMap(a => (a && a.description ? a.names.map(n => [n, a.description]) : []))),
  // Type of each move (by move id, -1 for none), for the move lists.
  mt: Array.from({ length: Math.max(...Object.keys(moves).map(Number)) + 1 }, (_, i) => (moves[i] ? moves[i].type : -1)),
  // Category of each move: 0 physical, 1 special, 2 status (-1 for none).
  ms: Array.from({ length: Math.max(...Object.keys(moves).map(Number)) + 1 }, (_, i) => (moves[i] ? moves[i].split : -1)),
};
fs.writeFileSync(path.join(__dirname, '..', 'src', 'dex.js'),
  '// Generated by tools/build-dex.js from the official Radical Red 4.1 dex data. Do not edit by hand.\nwindow.RH_DEX = ' + JSON.stringify(dex) + ';\n');

// Move and item names (and move PP) for build-data.py, straight from Radical Red's own tables.
const maxMove = Math.max(...Object.keys(moves).map(Number));
const maxItem = Math.max(...Object.keys(items).map(Number));
fs.writeFileSync(path.join(__dirname, 'rr-tables.json'), JSON.stringify({
  moves: Array.from({ length: maxMove + 1 }, (_, i) => (moves[i] ? moves[i].name : '')),
  pp: Array.from({ length: maxMove + 1 }, (_, i) => (moves[i] ? moves[i].pp : 0)),
  items: Array.from({ length: maxItem + 1 }, (_, i) => (items[i] ? items[i].name : '')),
}));
console.log(`species ${Object.keys(outSpecies).length}, areas ${areas.length}, species with encounters ${Object.keys(enc).length}, met names ${Object.keys(metNames).length}, caps ${caps.length}, moves ${maxMove}, items ${maxItem}`);
