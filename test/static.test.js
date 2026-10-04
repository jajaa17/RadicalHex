// Checks that need no save file: data tables, sprite indexes and the window's safety settings. Runs in CI.
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
global.window = {}; eval(fs.readFileSync(path.join(root, 'src/data.js'), 'utf8'));
const D = window.RH_DATA, C = require('../src/core.js');
assert.ok(D.species.length > 1300, 'species table');
assert.ok(Math.max(...D.species.map(s => s.nat || 0)) <= C.NATIONAL_DEX, 'every national number fits the Pokédex');
assert.ok(D.items.length > 700 && D.moves.length > 1000 && D.moves.length <= 1024 && D.pp.length === D.moves.length, 'item and move tables (move ids must fit 10 bits)');
assert.strictEqual(D.exp.length, 6); for (const c of D.exp) assert.strictEqual(c.length, 101);
for (const [i, s] of D.species.entries()) {
  if (!s.n) continue;
  if (s.s !== undefined) assert.ok(s.s >= 0 && s.s < 2000, `sprite index for ${s.n}`);
  if (s.g) { assert.ok(s.g >= 1 && s.g <= 6, `growth for ${s.n}`); assert.ok(C.encodeText(C.defaultNickname(D, i), 10), `nickname for ${s.n}`); }
}
assert.ok(fs.statSync(path.join(root, 'build/icon.png')).size > 1000, 'icon');
const spriteCount = Math.max(...D.species.filter(s => s.s !== undefined).map(s => s.s)) + 1;
for (let i = 0; i < spriteCount; i++) for (const dir of ['', 'shiny/']) assert.ok(fs.existsSync(path.join(root, `src/assets/sprites/${dir}${i}.png`)), `sprite ${dir}${i}`);
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
assert.ok(/Content-Security-Policy[^>]+script-src 'self'/.test(html), 'CSP');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
// Every file main.js loads must be packed into the .exe.
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const m of main.match(/require\('\.\/[^']+'\)/g) || []) assert.ok(pkg.build.files.includes(m.slice(11, -2) + '.js'), `${m} is in build.files`);
assert.ok(main.includes('contextIsolation: true') && main.includes('nodeIntegration: false') && main.includes('sandbox: true'), 'window isolation');
// Undo and failed edits must restore every part of the save the editor writes, boxes 23-25 (sv.ext) included.
const appJs = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
// Undo covers every editable buffer of both save layouts (Radical Red: data, stream, raw, ext; SoulGold: sb1, sb2, sb3, ps).
assert.ok(appJs.includes(`sv.game === 'sg' ? ['sb1', 'sb2', 'sb3', 'ps'] : ['data', 'stream', 'raw', 'ext']`) && appJs.includes('sv[k].slice()') && appJs.includes('sv[k].set(s[k])'), 'undo snapshot covers every part of both save layouts');
for (const f of ['src/app.js', 'src/core.js', 'src/sg-core.js']) assert.ok(!/require\(['"](fs|child_process)/.test(fs.readFileSync(path.join(root, f), 'utf8')), `${f} must not touch the disk`);
// The PID solver must hit every nature/shiny combination quickly.
for (let n = 0; n < 25; n++) for (const shiny of [true, false]) {
  const pid = C.solvePid({ otid: 0x75CF0AFE, nature: n, shiny }), x = (0x75CF0AFE ^ pid) >>> 0;
  assert.strictEqual(pid % 25, n); assert.strictEqual(((x & 0xFFFF) ^ (x >>> 16)) < 16, shiny);
}
// Every item has its icon.
for (let i = 1; i < D.items.length; i++) if (D.items[i] && C.validItem(D, i)) assert.ok(fs.existsSync(path.join(root, `src/assets/items/${i}.png`)), `icon for ${D.items[i]}`);
// Every species with a national dex number has its cry, and the page loads the sound code.
for (const n of new Set(D.species.filter(s => s.n && s.nat).map(s => s.nat))) assert.ok(fs.statSync(path.join(root, `src/assets/cries/${n}.ogg`)).size > 500, `cry ${n}`);
assert.ok(html.includes('<script src="sound.js"></script>'), 'sound.js is loaded');
// EV limits: 252 per stat, 510 in total, filled in stat order.
assert.deepStrictEqual(C.clampEvs([252, 6, 25662, 0, 0, 0]), [252, 6, 252, 0, 0, 0]);
assert.deepStrictEqual(C.clampEvs([252, 252, 252, 0, 0, 0]), [252, 252, 6, 0, 0, 0]);
assert.deepStrictEqual(C.clampEvs([4, 0, 0, 252, 0, 252]), [4, 0, 0, 252, 0, 252]);
console.log('static checks passed');

// RadicalDex data: every reference points at a species the editor knows.
eval(fs.readFileSync(path.join(root, 'src/dex.js'), 'utf8'));
const X = window.RH_DEX;
assert.strictEqual(X.caps.length, 18, 'level caps');
assert.ok(X.caps.every((c, i) => c.normal >= (i ? X.caps[i - 1].normal : 0) && c.hardcore >= c.normal), 'caps rise through the story');
assert.strictEqual(X.metNames[88], 'Pallet Town'); assert.strictEqual(X.metNames[101], 'Route 1');
for (const [id, s] of Object.entries(X.species)) {
  assert.ok(D.species[id] && D.species[id].n, `dex species ${id} exists in the editor`);
  for (const e of s.evo) assert.ok(X.species[e[0]], `evolution target ${e[0]} of ${id}`);
  for (const t of s.t) assert.ok(X.types.some(x => x.id === t), `type ${t} of ${id}`);
}
for (const [sp, rows] of Object.entries(X.enc)) for (const r of rows) {
  assert.ok(X.species[sp] && X.areas[r[0]] && X.methods[r[1]], `encounter row for ${sp}`);
  if (r[2] != null) assert.ok(r[2] > 0 && r[2] <= 100 && r[3] <= r[4], `encounter odds/levels for ${sp}`);
}
// Abilities are [ability 1, ability 2, hidden] by name. Spot checks against Radical Red: Espeon's hidden ability is Magic Bounce.
for (const [id, s] of Object.entries(X.species)) assert.ok(s.ab.length === 3 && s.ab[0] && s.ab.every(a => typeof a === 'string'), `abilities of ${id}`);
const byName = n => X.species[D.species.findIndex(s => s && s.n === n)];
assert.deepStrictEqual(byName('Espeon').ab, ['Synchronize', '', 'Magic Bounce']);
assert.deepStrictEqual(byName('Garchomp').ab, ['Sand Veil', '', 'Rough Skin']);
assert.deepStrictEqual(byName('Eevee').ab, ['Run Away', 'Adaptability', '']);
// Changing the ability keeps nature, shininess and gender, and the game sees the chosen slot.
const M = C.mon, eevee = D.species.findIndex(s => s && s.n === 'Eevee'), otid = 0x75CF0AFE;
for (let n = 0; n < 25; n++) for (const shiny of [true, false]) for (const gender of [0, 1]) {
  const m = { buf: new Uint8Array(58), off: 0, party: false };
  M.setSpecies(m, eevee);
  for (let k = 0; k < 4; k++) m.buf[4 + k] = (otid >>> (8 * k)) & 255;
  M.setPid(m, C.solvePid({ otid, nature: n, shiny, gender, ratio: C.genderRatio(D, eevee) }));
  for (const i of [1, 0, 2, 1, 0]) {
    C.setAbility(D, m, i);
    assert.strictEqual(M.abilityIndex(m), i); assert.strictEqual(M.nature(m), n); assert.strictEqual(M.shiny(m), shiny); assert.strictEqual(C.genderOf(D, m), gender);
    // Eevee has no hidden ability, so the game falls back to the personality's slot.
    assert.strictEqual(C.abilityName(X, m), ['Run Away', 'Adaptability'][i < 2 ? i : M.pid(m) & 1]);
  }
}
// Rerolling the PID keeps Unown's letter and Minior's core, which the game also reads from it.
for (const [name, form] of [['Unown', p => ((((p >>> 24) & 3) << 6) | (((p >>> 16) & 3) << 4) | (((p >>> 8) & 3) << 2) | (p & 3)) % 28], ['Minior', p => p % 7]]) {
  const m = { buf: new Uint8Array(58), off: 0, party: false };
  M.setSpecies(m, D.species.findIndex(s => s && s.n === name));
  M.setPid(m, 0x12345678);
  const want = form(M.pid(m));
  for (let n = 0; n < 25; n++) { C.setNatureShiny(m, n, n % 3 === 0, D); assert.strictEqual(form(M.pid(m)), want, `${name} form after nature ${n}`); assert.strictEqual(M.nature(m), n); }
}
const set = C.fromShowdown(D, 'Espeon @ Leftovers\nAbility: Magic Bounce\n- Psychic', X);
assert.strictEqual(set.opts.ability, 2); assert.strictEqual(set.warnings.length, 0);
console.log('dex checks passed');

// SoulGold: its own data, dex, sprites and icons, all consistent, and nothing shared with Radical Red's tables.
global.window = {};
eval(fs.readFileSync(path.join(root, 'src/sg-data.js'), 'utf8'));
eval(fs.readFileSync(path.join(root, 'src/sg-dex.js'), 'utf8'));
const SD = window.SG_DATA, SX = window.SG_DEX, SC = require('../src/sg-core.js');
assert.ok(html.includes('<script src="sg-core.js"></script>') && html.includes('<script src="sg-data.js"></script>') && html.includes('<script src="sg-dex.js"></script>'), 'SoulGold scripts are loaded');
assert.ok(SD.species.length > 1500 && SD.species.length <= 2048, 'SoulGold species fit 11 bits');
assert.ok(SD.items.length > 900 && SD.items.length <= 1024, 'SoulGold items fit 10 bits');
assert.ok(SD.moves.length > 800 && SD.moves.length <= 2048 && SD.pp.length === SD.moves.length, 'SoulGold moves fit 11 bits');
assert.ok(SD.exp.length >= 6 && SD.exp.every(c => c.length === 101), 'SoulGold growth tables');
assert.deepStrictEqual(SC.BALLS.slice(0, 5), ['Strange Ball', 'Poké Ball', 'Great Ball', 'Ultra Ball', 'Master Ball']);
let sgSprites = 0;
for (const [i, s] of SD.species.entries()) {
  if (!s.n) continue;
  assert.ok(s.nat >= 1 && s.nat <= SC.NATIONAL_DEX, `national number of ${s.n}`);
  assert.ok(s.g >= 1 && s.g <= SD.exp.length, `growth of ${s.n}`);
  assert.ok(SC.encodeText(SC.defaultNickname(SD, i), 12), `nickname of ${s.n}`);
  if (s.s !== undefined) { sgSprites = Math.max(sgSprites, s.s + 1); }
}
for (let i = 0; i < sgSprites; i++) assert.ok(fs.existsSync(path.join(root, `src/assets/sg/sprites/${i}.png`)), `SoulGold sprite ${i}`);
for (const [id, s] of Object.entries(SX.species)) {
  assert.ok(SD.species[id] && SD.species[id].n, `SoulDex species ${id} exists`);
  for (const e of s.evo) assert.ok(SX.species[e[0]], `SoulDex evolution target ${e[0]} of ${id}`);
  for (const t of s.t) assert.ok(SX.types.some(x => x.id === t), `SoulDex type ${t} of ${id}`);
  for (const m of s.ln) assert.ok(SD.moves[m], `SoulDex move ${m} of ${id}`);
}
for (const [sp, rows] of Object.entries(SX.enc)) for (const r of rows) assert.ok(SX.species[sp] && SX.areas[r[0]] && SX.methods[r[1]] && r[3] <= r[4], `SoulDex encounter row for ${sp}`);
assert.strictEqual(SX.metNames[232], 'New Bark Town');
assert.strictEqual(SD.species[1289].n, 'Sprigatito'); assert.strictEqual(SD.items[28], 'Potion');
assert.deepStrictEqual(SX.species[157].st, [78, 84, 78, 109, 85, 100], 'Typhlosion base stats');
console.log('SoulGold checks passed');
// The UI reads Pokémon data through the core's accessors, never raw offsets (Radical Red and SoulGold differ).
assert.ok(!/\b\w+\.buf\[\w+\.off \+/.test(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8')), 'app.js reads raw Pokémon bytes');
assert.strictEqual(typeof C.mon.hp, 'function'); assert.strictEqual(typeof require('../src/sg-core.js').mon.hp, 'function');
console.log('accessor checks passed');
// Move types and categories line up with the move lists, in both games.
for (const [d, x, g] of [[D, X, 'Radical Red'], [SD, SX, 'SoulGold']]) {
  assert.strictEqual(x.mt.length, d.moves.length, g + ' move types'); assert.strictEqual(x.ms.length, d.moves.length, g + ' move categories');
  const ids = new Set(x.types.map(t => t.id));
  // Struggle is typeless.
  d.moves.forEach((n, i) => { if (n) { assert.ok(ids.has(x.mt[i]) || n === 'Struggle', `${g} type of ${n}`); assert.ok([0, 1, 2].includes(x.ms[i]), `${g} category of ${n}`); } });
  const tn = n => x.types.find(t => t.id === x.mt[d.moves.indexOf(n)]).n, cat = n => x.ms[d.moves.indexOf(n)];
  assert.deepStrictEqual([tn('Toxic'), tn('Razor Leaf'), tn('Flamethrower')], ['Poison', 'Grass', 'Fire'], g);
  assert.deepStrictEqual([cat('Razor Leaf'), cat('Flamethrower'), cat('Toxic')], [0, 1, 2], g);
}
assert.strictEqual(X.metNames[157], "Professor Oak's Lab");
assert.ok(!Object.values(X.metNames).some(n => /Sevii Isle \d/.test(n)), 'no FireRed placeholder names');
console.log('move type checks passed');
