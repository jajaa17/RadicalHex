// Checks that need no save file: data tables, sprite indexes and the window's safety settings. Runs in CI.
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
global.window = {}; eval(fs.readFileSync(path.join(root, 'src/data.js'), 'utf8'));
const D = window.RH_DATA, C = require('../src/core.js');
assert.ok(D.species.length > 1300, 'species table');
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
assert.ok(main.includes('contextIsolation: true') && main.includes('nodeIntegration: false') && main.includes('sandbox: true'), 'window isolation');
// Undo and failed edits must restore every part of the save the editor writes, boxes 23-25 (sv.ext) included.
const appJs = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
for (const part of ['data', 'stream', 'raw', 'ext']) assert.ok(appJs.includes(`${part}: sv.${part}.slice()`) && appJs.includes(`sv.${part}.set(s.${part})`), `undo snapshot covers ${part}`);
for (const f of ['src/app.js', 'src/core.js']) assert.ok(!/require\(['"](fs|child_process)/.test(fs.readFileSync(path.join(root, f), 'utf8')), `${f} must not touch the disk`);
// The PID solver must hit every nature/shiny combination quickly.
for (let n = 0; n < 25; n++) for (const shiny of [true, false]) {
  const pid = C.solvePid({ otid: 0x75CF0AFE, nature: n, shiny }), x = (0x75CF0AFE ^ pid) >>> 0;
  assert.strictEqual(pid % 25, n); assert.strictEqual(((x & 0xFFFF) ^ (x >>> 16)) < 16, shiny);
}
// Every item has its icon.
for (let i = 1; i < D.items.length; i++) if (D.items[i] && C.validItem(D, i)) assert.ok(fs.existsSync(path.join(root, `src/assets/items/${i}.png`)), `icon for ${D.items[i]}`);
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
