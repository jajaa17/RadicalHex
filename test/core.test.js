// Usage: node test/core.test.js <save.sav> [more.sav ...]
// Exercises every editing path and checks the result reloads and only touches allowed bytes.
const fs = require('fs'), path = require('path'), assert = require('assert');
const C = require('../src/core.js');
global.window = {}; eval(fs.readFileSync(path.join(__dirname, '../src/data.js'), 'utf8')); const D = window.RH_DATA;
const M = C.mon;
let failures = 0;
const t = (name, fn) => { try { fn(); console.log('  ok  ', name); } catch (e) { failures++; console.log('  FAIL', name, '\n       ', e.message); } };

for (const file of process.argv.slice(2)) {
  console.log(path.basename(file));
  const bytes = new Uint8Array(fs.readFileSync(file));
  const fresh = () => C.load(bytes);

  t('round trip is byte-identical', () => assert.deepStrictEqual(Buffer.from(C.build(fresh(), D)), Buffer.from(bytes)));

  t('rejects a blank file and a corrupted save', () => {
    assert.throws(() => C.load(new Uint8Array(0x20000)));
    const bad = bytes.slice(); const sv = fresh(); bad[sv.sec[1] + 0x100] ^= 0xFF; assert.throws(() => C.load(bad));
  });

  t('levels match stored party levels', () => {
    const sv = fresh();
    for (let i = 0; i < C.partyCount(sv); i++) { const m = C.partyRef(sv, i); assert.strictEqual(M.level(m), (() => { const g = C.growth(D, M.species(m)); let L = 1; while (L < 100 && g[L + 1] <= M.exp(m)) L++; return L; })()); }
  });

  t('nature / shiny / gender edits keep everything else', () => {
    const sv = fresh();
    for (let n = 0; n < 25; n++) for (const shiny of [true, false]) {
      const m = C.partyRef(sv, 0), low = M.pid(m) & 0xFF, ab = M.abilitySlot(m), g = C.genderOf(D, m);
      C.setNatureShiny(m, n, shiny);
      assert.strictEqual(M.nature(m), n); assert.strictEqual(M.shiny(m), shiny);
      const x = (M.otid(m) ^ M.pid(m)) >>> 0; if (shiny) assert.ok(((x & 0xFFFF) ^ (x >>> 16)) < 8, 'shiny under the strict rule too');
      assert.strictEqual(M.pid(m) & 0xFF, low); assert.strictEqual(M.abilitySlot(m), ab); assert.strictEqual(C.genderOf(D, m), g);
    }
    C.build(sv, D);
  });

  t('add a Pokémon to every empty slot of a box, then save', () => {
    const sv = fresh(); let box = -1;
    for (let b = 0; b < C.BOXES && box < 0; b++) for (let s = 0; s < 30; s++) if (M.empty(C.boxRef(sv, b, s))) { box = b; break; }
    if (box < 0) { // full save: release a whole box first
      for (let s = 0; s < 30; s++) C.release(C.boxRef(sv, 21, s)); box = 21;
    }
    const sp = D.species.findIndex(x => x.n === 'Garchomp'), moves = ['Earthquake', 'Dragon Claw', 'Swords Dance', 'Stone Edge'].map(n => D.moves.indexOf(n));
    let made = 0;
    for (let s = 0; s < 30; s++) {
      const r = C.boxRef(sv, box, s); if (!M.empty(r)) continue;
      C.createInBox(sv, D, r, { species: sp, level: 50 + s, nature: s % 25, shiny: s % 2 === 0, gender: s % 2, item: D.items.indexOf('Leftovers'), ball: 3, moves, hidden: s % 3 === 0 });
      made++;
    }
    const out = C.build(sv, D), back = C.load(out);
    for (let s = 0; s < 30; s++) {
      const r = C.boxRef(back, box, s); if (M.species(r) !== sp) continue;
      assert.strictEqual(C.levelOf(D, r), 50 + s); assert.strictEqual(M.nature(r), s % 25); assert.strictEqual(M.shiny(r), s % 2 === 0);
      assert.strictEqual(C.genderOf(D, r), s % 2); assert.deepStrictEqual(M.moves(r), moves); assert.deepStrictEqual(M.ivs(r), [31, 31, 31, 31, 31, 31]);
      assert.strictEqual(M.nickname(r), 'Garchomp'); assert.strictEqual(M.otName(r), C.trainer(back).name); assert.strictEqual(M.hiddenAbility(r), s % 3 === 0);
    }
    assert.ok(C.dex.caught(back, 445), 'Garchomp registered in the Pokédex');
    assert.ok(made > 0);
  });

  t('add into the extra boxes 20-22 (raw region) round-trips', () => {
    const sv = fresh(); const r = C.boxRef(sv, 20, 29); C.release(r);
    C.createInBox(sv, D, r, { species: D.species.findIndex(x => x.n === 'Pikachu'), level: 5, nature: 3, shiny: true, moves: [D.moves.indexOf('Thunderbolt'), 0, 0, 0] });
    const back = C.load(C.build(sv, D));
    assert.strictEqual(D.species[M.species(C.boxRef(back, 20, 29))].n, 'Pikachu');
  });

  t('move, clone, release, copy party to box', () => {
    const sv = fresh();
    const a = C.boxRef(sv, 0, 0), b = C.boxRef(sv, 1, 5);
    const ab = a.buf.slice(a.off, a.off + 58), bb = b.buf.slice(b.off, b.off + 58);
    C.swap(a, b);
    assert.deepStrictEqual(a.buf.slice(a.off, a.off + 58), bb); assert.deepStrictEqual(b.buf.slice(b.off, b.off + 58), ab);
    const dst = C.boxRef(sv, 21, 0); C.release(dst); C.copyToBox(D, C.partyRef(sv, 0), dst);
    const p = C.partyRef(sv, 0);
    assert.strictEqual(M.species(dst), M.species(p)); assert.deepStrictEqual(M.moves(dst), M.moves(p)); assert.deepStrictEqual(M.ivs(dst), M.ivs(p));
    assert.deepStrictEqual(M.evs(dst), M.evs(p)); assert.strictEqual(M.pid(dst), M.pid(p)); assert.strictEqual(M.nickname(dst), M.nickname(p));
    C.build(sv, D);
  });

  t('edit IVs/EVs/moves/item/level/nickname on party and box', () => {
    const sv = fresh();
    for (const r of [C.partyRef(sv, 0), C.boxRef(sv, 0, 0)]) {
      if (M.empty(r)) continue;
      M.setIvs(r, [1, 2, 3, 4, 5, 6]); M.setEvs(r, [10, 20, 30, 40, 50, 60]); M.setItem(r, D.items.indexOf('Choice Scarf'));
      M.setMoves(r, [D.moves.indexOf('Protect'), D.moves.indexOf('Surf'), 0, 0], D); C.setLevel(D, r, 42); M.setNickname(r, 'Bestie');
    }
    const back = C.load(C.build(sv, D));
    for (const r of [C.partyRef(back, 0), C.boxRef(back, 0, 0)]) {
      if (M.empty(r)) continue;
      assert.deepStrictEqual(M.ivs(r), [1, 2, 3, 4, 5, 6]); assert.deepStrictEqual(M.evs(r), [10, 20, 30, 40, 50, 60]);
      assert.strictEqual(C.levelOf(D, r), 42); assert.strictEqual(M.nickname(r), 'Bestie'); assert.strictEqual(D.moves[M.moves(r)[1]], 'Surf');
      if (r.party) assert.strictEqual(M.movePp(r)[1], D.pp[D.moves.indexOf('Surf')]);
    }
  });

  t('Gen 9 move ids up to 1003 round-trip in the 58-byte box form', () => {
    const sv = fresh(), r = C.boxRef(sv, 21, 28); C.release(r);
    C.createInBox(sv, D, r, { species: D.species.findIndex(x => x.n === 'Sprigatito'), level: 20, nature: 0, shiny: false, moves: [767, 1003, 742, 90] });
    const back = C.load(C.build(sv, D));
    assert.deepStrictEqual(M.moves(C.boxRef(back, 21, 28)), [767, 1003, 742, 90]);
    assert.strictEqual(D.moves[767], 'Aqua Step');
  });

  t('money, coins and every bag pocket', () => {
    const sv = fresh();
    C.setMoney(sv, 999999); C.setCoins(sv, 9999);
    const want = {};
    for (const p of C.POCKETS) {
      const ids = []; for (let i = 1; i < D.items.length && ids.length < 5; i++) if (C.validItem(D, i) && C.pocketOf(D, i) === p.key && !C.readPocket(sv, p).some(x => x.id === i)) ids.push(i);
      const list = C.readPocket(sv, p).concat(ids.map(id => ({ id, qty: p.max === 1 ? 1 : 77 })));
      C.writePocket(sv, p, list); want[p.key] = list;
    }
    const back = C.load(C.build(sv, D));
    assert.strictEqual(C.trainer(back).money, 999999); assert.strictEqual(C.trainer(back).coins, 9999);
    for (const p of C.POCKETS) assert.deepStrictEqual(C.readPocket(back, p), want[p.key]);
    // removing items leaves no stale entries
    C.writePocket(sv, C.POCKETS[0], want.items.slice(0, 1));
    assert.strictEqual(C.readPocket(C.load(C.build(sv, D)), C.POCKETS[0]).length, 1);
    assert.throws(() => C.writePocket(sv, C.POCKETS[1], Array(76).fill({ id: 260, qty: 1 })));
  });

  t('the guard refuses invalid Pokémon and stray byte changes', () => {
    let sv = fresh(); const r = C.boxRef(sv, 0, 0);
    if (!M.empty(r)) { M.setSpecies(r, 260); assert.throws(() => C.build(sv, D), /unknown species/); }
    sv = fresh(); const r2 = C.boxRef(sv, 0, 0);
    if (!M.empty(r2)) { M.setMoves(r2, [0, 0, 0, 0], D); assert.throws(() => C.build(sv, D), /no moves/); }
    sv = fresh(); sv.data[sv.sec[0] + 0x500] ^= 1; assert.throws(() => C.build(sv, D), /Unexpected change/);
    sv = fresh(); C.setLevel(D, C.boxRef(sv, 0, 0), 100); M.setExp(C.boxRef(sv, 0, 0), 99999999); if (!M.empty(C.boxRef(sv, 0, 0))) assert.throws(() => C.build(sv, D), /EXP/);
  });

  t('Showdown export → import reproduces the Pokémon', () => {
    const sv = fresh(); const src = C.partyRef(sv, 0);
    const text = C.toShowdown(D, src); const { opts } = C.fromShowdown(D, text);
    assert.strictEqual(opts.species, M.species(src)); assert.deepStrictEqual(opts.ivs, M.ivs(src)); assert.deepStrictEqual(opts.evs, M.evs(src));
    assert.strictEqual(opts.nature, M.nature(src)); assert.deepStrictEqual(opts.moves, M.moves(src)); assert.strictEqual(opts.shiny, M.shiny(src));
    const set = C.fromShowdown(D, 'Rotom-Wash @ Leftovers\nAbility: Levitate\nLevel: 50\nShiny: Yes\nEVs: 252 HP / 4 Def / 252 SpD\nCalm Nature\nIVs: 0 Atk\n- Volt Switch\n- Hydro Pump\n- Will-O-Wisp\n- Thunder Punch');
    assert.strictEqual(D.species[set.opts.species].n, 'Rotom-Wash'); assert.strictEqual(set.opts.ivs[1], 0); assert.strictEqual(set.opts.moves.filter(Boolean).length, 4);
  });

  t('every species marked addable has data and a valid nickname', () => {
    for (let i = 1; i < D.species.length; i++) {
      const s = D.species[i]; if (!s.n || !s.g) continue;
      assert.ok(C.encodeText(C.defaultNickname(D, i), 10), 'nickname for ' + s.n);
    }
  });
}
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
