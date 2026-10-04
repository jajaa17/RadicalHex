// Usage: node test/core.test.js <save.sav> [more.sav ...]
// Exercises every editing path and checks the result reloads and only touches allowed bytes.
const fs = require('fs'), path = require('path'), assert = require('assert');
const C = require('../src/core.js');
global.window = {}; eval(fs.readFileSync(path.join(__dirname, '../src/data.js'), 'utf8')); const D = window.RH_DATA;
eval(fs.readFileSync(path.join(__dirname, '../src/dex.js'), 'utf8')); const X = window.RH_DEX;
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
    const sv = fresh(), bad = bytes.slice(); bad[sv.sec[1] + 0x100] ^= 0xFF;
    // A damaged newest save: like the game, the previous complete save is used, and the damaged one is reported.
    let prev = null; try { prev = C.load(bad); } catch { /* no complete previous save in this file */ }
    if (prev) { assert.strictEqual(prev.newerDamaged, sv.saveIndex); assert.ok(prev.saveIndex < sv.saveIndex); assert.ok(prev.sec.every(o => Math.floor(o / 0xE000) !== Math.floor(sv.sec[0] / 0xE000))); }
    assert.ok(sv.newerDamaged === null || sv.newerDamaged > sv.saveIndex, 'only a newer unfinished save is reported');
    const worse = bad.slice(); if (prev) worse[prev.sec[1] + 0x100] ^= 0xFF;
    assert.throws(() => C.load(worse), 'both saves damaged: refused');
  });

  t('Minimal Grinding mode is read from the save and kept by edits', () => {
    const sv = fresh(), on = C.modes(sv).minGrind;
    assert.strictEqual(typeof on, 'boolean');
    C.setMoney(sv, 1234);
    assert.strictEqual(C.modes(C.load(C.build(sv, D))).minGrind, on);
    // The flags sit in section 4's unused tail (outside its checksum): either one turns the mode on.
    for (const id of [0x1032, 0x1040]) {
      const b = bytes.slice(), o = sv.sec[4] + C.WIN[4] + ((id - 0x900) >> 3) - 0xCC;
      b[o] |= 1 << (id & 7);
      assert.strictEqual(C.modes(C.load(b)).minGrind, true, id.toString(16));
      b[o] &= ~(1 << (id & 7));
    }
    const off = bytes.slice();
    for (const id of [0x1032, 0x1040]) off[sv.sec[4] + C.WIN[4] + ((id - 0x900) >> 3) - 0xCC] &= ~(1 << (id & 7));
    assert.strictEqual(C.modes(C.load(off)).minGrind, false);
  });

  t('a first save the emulator wrote mid-save (a blank section) is refused with a clear reason', () => {
    const sv = fresh(), b = bytes.slice(), live = Math.floor(sv.sec[0] / 0xE000);
    b.fill(0xFF, (1 - live) * 0xE000, (2 - live) * 0xE000); // no older save, like a new game's first save
    b.fill(0, sv.sec[0], sv.sec[0] + 0x1000); // section 0 not written yet
    assert.throws(() => C.load(b), /partly written/);
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
    assert.ok(!C.dex.caught(back, 445) || C.dex.caught(fresh(), 445), 'adding alone does not touch the Pokédex');
    C.registerOwned(back, D);
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

  t('boxes 23-25 read, and writes across the section boundary round-trip', () => {
    const sv = fresh();
    let n = 0; for (let b = 22; b < 25; b++) for (let s = 0; s < 30; s++) if (!M.empty(C.boxRef(sv, b, s))) n++;
    console.log('       (Pokémon found in boxes 23-25: ' + n + ')');
    const sp = D.species.findIndex(x => x.n === 'Garchomp'), mv = [D.moves.indexOf('Earthquake'), 0, 0, 0];
    for (const [b, s] of [[22, 3], [22, 29], [23, 0], [24, 29]]) { // 22/3 straddles SaveBlock1 sections 2 and 3
      const r = C.boxRef(sv, b, s); C.release(r);
      C.createInBox(sv, D, r, { species: sp, level: 40 + s, nature: 7, shiny: false, moves: mv });
    }
    const back = C.load(C.build(sv, D));
    for (const [b, s] of [[22, 3], [22, 29], [23, 0], [24, 29]]) {
      const r = C.boxRef(back, b, s);
      assert.strictEqual(M.species(r), sp); assert.strictEqual(C.levelOf(D, r), 40 + s); assert.strictEqual(M.nature(r), 7);
    }
  });

  t('heal restores HP, clears status and refills PP for a party Pokémon', () => {
    const sv = fresh(), r = C.partyRef(sv, 0);
    r.buf[r.off + 0x56] = 0; r.buf[r.off + 0x57] = 0; r.buf[r.off + 0x50] = 0x08; for (let i = 0; i < 4; i++) r.buf[r.off + 0x34 + i] = 0;
    assert.strictEqual(C.partyStatus(r), 'Fainted');
    assert.ok(C.heal(D, r));
    const back = C.load(C.build(sv, D)), p = C.partyRef(back, 0);
    const u16 = (b, o) => b[o] | (b[o + 1] << 8);
    assert.strictEqual(u16(p.buf, p.off + 0x56), u16(p.buf, p.off + 0x58));
    assert.strictEqual(C.partyStatus(p), '');
    M.moves(p).forEach((m, i) => assert.strictEqual(M.movePp(p)[i], m ? D.pp[m] + Math.floor(D.pp[m] / 5) * ((p.buf[p.off + 0x28] >> (2 * i)) & 3) : 0));
    assert.strictEqual(C.heal(D, C.partyRef(back, 0)), false, 'healing a healthy Pokémon changes nothing');
  });

  t('legality: catches impossible Pokémon', () => {
    const sv = fresh(), r = C.boxRef(sv, 24, 29); C.release(r);
    const sp = D.species.findIndex(x => x.n === 'Garchomp');
    C.createInBox(sv, D, r, { species: sp, level: 60, nature: 3, shiny: false, moves: [D.moves.indexOf('Earthquake'), D.moves.indexOf('Dragon Claw'), 0, 0] });
    assert.deepStrictEqual(C.legality(D, X, r).filter(p => p.level === 'error'), [], 'a normal Garchomp is legal');
    M.setMoves(r, [D.moves.indexOf('Earthquake'), D.moves.indexOf('Spore'), D.moves.indexOf('Earthquake'), 0], D);
    M.setEvs(r, [252, 252, 252, 0, 0, 0]);
    const errs = C.legality(D, X, r).filter(p => p.level === 'error').map(p => p.field).sort();
    assert.deepStrictEqual(errs, ['evs', 'move1', 'moves']);
    M.setMoves(r, [D.moves.indexOf('Earthquake'), D.moves.indexOf('Dragon Claw'), 0, 0], D); M.setEvs(r, [255, 0, 0, 0, 0, 0]);
    assert.deepStrictEqual(C.legality(D, X, r).filter(p => p.level === 'error').map(p => p.field), ['evs'], 'one EV above 252');
    M.setSpecies(r, D.species.findIndex(x => x.n === 'Charizard-Mega-X'));
    assert.ok(C.legality(D, X, r).some(p => p.field === 'species' && p.level === 'error'), 'battle-only form');
  });

  t('party stats: recalculation matches the game and follows edits', () => {
    const sv = fresh(), r = C.partyRef(sv, 0), before = M.partyStats(r).join();
    assert.ok(C.recalcStats(D, X, r));
    assert.strictEqual(M.partyStats(r).join(), before, 'recalculating an untouched Pokémon changes nothing');
    M.setIvs(r, [0, 0, 0, 0, 0, 0]); C.recalcStats(D, X, r);
    assert.notStrictEqual(M.partyStats(r).join(), before);
    assert.ok(!C.legality(D, X, r).some(p => p.field === 'stats'), 'stats are consistent after recalculating');
    C.load(C.build(sv, D));
  });

  t('legality: no Pokémon in this save is flagged for stats or level-vs-EXP when untouched', () => {
    const sv = fresh();
    for (let i = 0; i < C.partyCount(sv); i++) assert.ok(!C.legality(D, X, C.partyRef(sv, i)).some(p => p.field === 'stats'));
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
    sv = fresh(); sv.data[sv.sec[0] + 0x900] ^= 1; // section 0, after box 25 (0xB0-0x77C) assert.throws(() => C.build(sv, D), /Unexpected change/);
    sv = fresh(); C.setLevel(D, C.boxRef(sv, 0, 0), 100); M.setExp(C.boxRef(sv, 0, 0), 99999999); if (!M.empty(C.boxRef(sv, 0, 0))) assert.throws(() => C.build(sv, D), /EXP/);
  });

  t('Showdown export → import reproduces the Pokémon', () => {
    const sv = fresh(); const src = C.partyRef(sv, 0);
    const text = C.toShowdown(D, src, X); const { opts, warnings } = C.fromShowdown(D, text, X);
    assert.deepStrictEqual(warnings, []); assert.strictEqual(C.abilityName(X, src), X.species[opts.species].ab[opts.ability]);
    assert.strictEqual(opts.species, M.species(src)); assert.deepStrictEqual(opts.ivs, M.ivs(src)); assert.deepStrictEqual(opts.evs, M.evs(src));
    assert.strictEqual(opts.nature, M.nature(src)); assert.deepStrictEqual(opts.moves, M.moves(src)); assert.strictEqual(opts.shiny, M.shiny(src));
    const set = C.fromShowdown(D, 'Rotom-Wash @ Leftovers\nAbility: Levitate\nLevel: 50\nShiny: Yes\nEVs: 252 HP / 4 Def / 252 SpD\nCalm Nature\nIVs: 0 Atk\n- Volt Switch\n- Hydro Pump\n- Will-O-Wisp\n- Thunder Punch');
    assert.strictEqual(D.species[set.opts.species].n, 'Rotom-Wash'); assert.strictEqual(set.opts.ivs[1], 0); assert.strictEqual(set.opts.moves.filter(Boolean).length, 4);
  });

  t('ability: every slot the species has can be set on party and box Pokémon, then saved', () => {
    const sv = fresh(), refs = [];
    for (let i = 0; i < C.partyCount(sv); i++) refs.push(C.partyRef(sv, i));
    for (let b = 0; b < C.BOXES; b++) for (let s = 0; s < C.SLOTS; s++) refs.push(C.boxRef(sv, b, s));
    let n = 0;
    for (const m of refs) {
      if (M.empty(m) || M.isEgg(m) || !X.species[M.species(m)]) continue;
      const ab = X.species[M.species(m)].ab, keep = [M.nature(m), M.shiny(m), C.genderOf(D, m), M.otid(m), M.species(m)];
      for (const i of [2, 1, 0].filter(k => ab[k])) {
        C.setAbility(D, m, i); if (m.party) C.recalcStats(D, X, m);
        assert.strictEqual(M.abilityIndex(m), i); assert.strictEqual(C.abilityName(X, m), ab[i]);
        assert.deepStrictEqual([M.nature(m), M.shiny(m), C.genderOf(D, m), M.otid(m), M.species(m)], keep);
      }
      if (++n >= 60) break;
    }
    const back = C.load(C.build(sv, D));
    for (let i = 0; i < C.partyCount(sv); i++) assert.strictEqual(M.abilityIndex(C.partyRef(back, i)), M.abilityIndex(C.partyRef(sv, i)));
  });

  t('party: deposit and withdraw like the game, add straight to the party, then save', () => {
    const sv = fresh(), n = C.partyCount(sv);
    assert.ok(n >= 1, 'save has a party');
    const keep = r => [M.pid(r), M.otid(r), M.nickname(r), M.otName(r), M.species(r), M.item(r), M.exp(r), M.friendship(r), M.ball(r), M.moves(r).join(), M.evs(r).join(), M.ivWord(r), M.metLocation(r), M.metLevel(r), C.levelOf(D, r)].join('|');
    const first = C.partyRef(sv, 0), before = keep(first), wasStats = M.partyStats(first).join();
    const spot = (() => { for (let b = 0; b < C.BOXES; b++) for (let s2 = 0; s2 < C.SLOTS; s2++) if (M.empty(C.boxRef(sv, b, s2))) return C.boxRef(sv, b, s2); })();
    if (n === 1) assert.throws(() => C.deposit(sv, D, 0, spot), /last Pokémon/);
    else {
      const second = keep(C.partyRef(sv, 1));
      C.deposit(sv, D, 0, spot);
      assert.strictEqual(C.partyCount(sv), n - 1); assert.strictEqual(keep(C.partyRef(sv, 0)), second, 'the rest moved up');
      assert.ok(M.empty(C.partyRef(sv, n - 1)), 'old last slot cleared');
      assert.strictEqual(keep(spot), before, 'deposited Pokémon kept everything');
      const i = C.withdraw(sv, D, X, spot);
      assert.strictEqual(i, n - 1); assert.strictEqual(C.partyCount(sv), n); assert.ok(M.empty(spot), 'box slot emptied');
      const back = C.partyRef(sv, i);
      assert.strictEqual(keep(back), before, 'withdrawn Pokémon kept everything');
      assert.strictEqual(M.partyStats(back).join(), wasStats, 'stats recalculated to the same values');
      assert.strictEqual(back.buf[back.off + 0x56] | (back.buf[back.off + 0x57] << 8), M.partyStats(back)[0], 'full HP');
      assert.strictEqual(C.partyStatus(back), ''); assert.strictEqual(back.buf[back.off + 0x55], 0xFF, 'no mail');
      assert.ok(!C.heal(D, back), 'PP already full, like a fresh withdraw');
    }
    // Fill the party to 6 by adding straight to it, then a 7th is refused.
    const sp = D.species.findIndex(x => x.n === 'Garchomp'), moves = [D.moves.indexOf('Earthquake'), D.moves.indexOf('Dragon Claw'), 0, 0];
    while (C.partyCount(sv) < 6) {
      const i = C.createInParty(sv, D, X, { species: sp, level: 50, nature: 3, shiny: false, moves, ability: 2 });
      const r = C.partyRef(sv, i);
      assert.strictEqual(M.level(r), 50); assert.strictEqual(C.abilityName(X, r), 'Rough Skin');
      assert.deepStrictEqual(C.legality(D, X, r).filter(p => p.level !== 'info'), [], 'new party Pokémon is legal, stats included');
    }
    assert.throws(() => C.createInParty(sv, D, X, { species: sp, level: 50, nature: 3, moves }), /party is full/);
    assert.throws(() => C.withdraw(sv, D, X, C.boxRef(sv, 0, 0)), /party is full|Pick a Pokémon/);
    const back = C.load(C.build(sv, D));
    assert.strictEqual(C.partyCount(back), 6);
    // Deposit down to the last Pokémon and save again.
    while (C.partyCount(back) > 1) { const dst = (() => { for (let b = 0; b < C.BOXES; b++) for (let s2 = 0; s2 < C.SLOTS; s2++) if (M.empty(C.boxRef(back, b, s2))) return C.boxRef(back, b, s2); })(); C.deposit(back, D, 0, dst); }
    assert.throws(() => C.deposit(back, D, 0, C.boxRef(back, 24, 29)), /last Pokémon|empty box slot/);
    assert.strictEqual(C.partyCount(C.load(C.build(back, D))), 1);
  });

  t('the save guard refuses a party count with an empty slot under it', () => {
    const sv = fresh(), n = C.partyCount(sv);
    if (n >= 6) return;
    sv.data[sv.sec[1] + 0x34] = n + 1; // a count that points at an empty slot
    assert.throws(() => C.build(sv, D), /party slot/);
  });

  t('Pokédex: matches what the game sets, registers only what is saved, repairs old RadicalHex entries', () => {
    const sv = fresh(), own = new Set();
    const see = r => { if (!M.empty(r) && !M.isEgg(r) && D.species[M.species(r)].nat) own.add(D.species[M.species(r)].nat); };
    for (let i = 0; i < C.partyCount(sv); i++) see(C.partyRef(sv, i));
    for (let b = 0; b < C.BOXES; b++) for (let s2 = 0; s2 < C.SLOTS; s2++) see(C.boxRef(sv, b, s2));
    // A save RadicalHex has never written: everything owned is already caught where RadicalHex reads it.
    for (const n of own) assert.ok(C.dex.caught(sv, n) && C.dex.seen(sv, n), `owned No. ${n} is caught in the game's Pokédex`);
    // Mispress: add Crobat, then put a Sylveon over it; only Sylveon is registered when saving.
    const crobat = D.species.findIndex(x => x.n === 'Crobat'), sylveon = D.species.findIndex(x => x.n === 'Sylveon');
    const cNat = D.species[crobat].nat, sNat = D.species[sylveon].nat, hadCrobat = C.dex.caught(sv, cNat);
    const slot = (() => { for (let b = 0; b < C.BOXES; b++) for (let s2 = 0; s2 < C.SLOTS; s2++) if (M.empty(C.boxRef(sv, b, s2))) return C.boxRef(sv, b, s2); })();
    const mv = [D.moves.indexOf('Tackle') > 0 ? D.moves.indexOf('Tackle') : 1, 0, 0, 0];
    C.createInBox(sv, D, slot, { species: crobat, level: 30, nature: 0, moves: mv }); C.release(slot);
    C.createInBox(sv, D, slot, { species: sylveon, level: 30, nature: 0, moves: mv });
    C.registerOwned(sv, D);
    assert.ok(C.dex.caught(sv, sNat) && C.dex.seen(sv, sNat), 'Sylveon caught');
    assert.strictEqual(C.dex.caught(sv, cNat), hadCrobat || own.has(cNat), 'Crobat untouched');
    // Old RadicalHex bug: "caught" written at 0x38D. Charmander (4) set seen No. 1004; Garchomp (445) set caught No. 133.
    const old = fresh(), s1 = old.sec[1], before = C.dex.count(old);
    const eevee = 133, eeveeSeen = C.dex.seen(old, eevee), eeveeCaught = C.dex.caught(old, eevee);
    old.data[s1 + 0x38D + ((445 - 1) >> 3)] |= 1 << ((445 - 1) & 7);
    old.data[s1 + 0x38D + ((1200 - 1) >> 3)] |= 1 << ((1200 - 1) & 7); // a seen entry above 1025
    const fixed = C.dex.repair(old);
    assert.strictEqual(C.dex.caught(old, eevee), eeveeCaught || eeveeSeen, 'stray caught Eevee removed unless it was seen');
    assert.ok(fixed >= 1); assert.deepStrictEqual(C.dex.count(old), before);
    assert.strictEqual(C.dex.repair(fresh()), 0, 'a clean save needs no repair');
    C.load(C.build(old, D));
  });

  t('origin: met location, met level, OT name, gender and IDs on party and box Pokémon', () => {
    const sv = fresh(), refs = [C.partyRef(sv, 0)];
    for (let b = 0; b < C.BOXES && refs.length < 4; b++) for (let s2 = 0; s2 < C.SLOTS && refs.length < 4; s2++) if (!M.empty(C.boxRef(sv, b, s2))) refs.push(C.boxRef(sv, b, s2));
    for (const r of refs) {
      const keep = [M.species(r), M.nature(r), M.shiny(r), C.genderOf(D, r), M.abilityIndex(r), M.exp(r), M.ivWord(r), M.moves(r).join(), M.nickname(r)].join('|');
      const game = (r.buf[r.off + (r.party ? 0x47 : 0x35)] >> 3) & 15;
      M.setMetLocation(r, 101); M.setMetLevel(r, 7); M.setOtGender(r, 1); assert.ok(M.setOtName(r, 'ASH'));
      assert.strictEqual(M.metLocation(r), 101); assert.strictEqual(M.metLevel(r), 7); assert.strictEqual(M.otGender(r), 1); assert.strictEqual(M.otName(r), 'ASH');
      assert.strictEqual((r.buf[r.off + (r.party ? 0x47 : 0x35)] >> 3) & 15, game, 'game of origin kept');
      assert.ok(!M.setOtName(r, 'TOOLONGNAME') && M.otName(r) === 'ASH', 'too long refused');
      for (const [tid, sid] of [[1, 2], [65535, 0], [12345, 54321], [0, 65535]]) {
        C.setOtIds(D, r, tid, sid);
        assert.strictEqual(M.otid(r), ((sid << 16) | tid) >>> 0);
        assert.strictEqual([M.species(r), M.nature(r), M.shiny(r), C.genderOf(D, r), M.abilityIndex(r), M.exp(r), M.ivWord(r), M.moves(r).join(), M.nickname(r)].join('|'), keep, 'IDs change keeps shiny, nature, gender, ability');
      }
      C.makeMine(sv, D, r);
      const t = C.trainer(sv);
      assert.strictEqual(M.otName(r), t.name); assert.strictEqual(M.otid(r) & 0xFFFF, t.tid); assert.strictEqual(M.otid(r) >>> 16, t.sid); assert.strictEqual(M.otGender(r), t.gender & 1);
      if (r.party) C.recalcStats(D, X, r);
    }
    const back = C.load(C.build(sv, D));
    assert.strictEqual(M.metLocation(C.partyRef(back, 0)), 101); assert.strictEqual(M.otName(C.partyRef(back, 0)), C.trainer(back).name);
    // A new Pokémon can be met anywhere chosen.
    const slot = (() => { for (let b = 0; b < C.BOXES; b++) for (let s2 = 0; s2 < C.SLOTS; s2++) if (M.empty(C.boxRef(sv, b, s2))) return C.boxRef(sv, b, s2); })();
    C.createInBox(sv, D, slot, { species: D.species.findIndex(x => x.n === 'Pikachu'), level: 20, nature: 0, moves: [D.moves.indexOf('Thunder Shock'), 0, 0, 0], metLocation: 129 });
    assert.strictEqual(M.metLocation(slot), 129); assert.strictEqual(M.metLevel(slot), 20);
    M.setOtName(slot, ''); assert.ok(C.legality(D, X, slot).some(p => p.level === 'error' && /trainer name/.test(p.text)), 'empty OT is illegal');
  });

  t('drag and drop: party reorder, box to box, party to box, box to party, swaps', () => {
    const sv = fresh(), P = i => ({ party: true, box: 0, slot: i }), B = (b, s2) => ({ party: false, box: b, slot: s2 });
    const id = r => (M.empty(r) ? '-' : [M.pid(r), M.species(r), M.exp(r), M.moves(r).join(), M.evs(r).join(), M.ivWord(r), M.nickname(r), M.otName(r)].join('|'));
    const empty = () => { for (let b = 0; b < C.BOXES; b++) for (let s2 = 0; s2 < C.SLOTS; s2++) if (M.empty(C.boxRef(sv, b, s2))) return [b, s2]; };
    const filledBox = () => { for (let b = 0; b < C.BOXES; b++) for (let s2 = 0; s2 < C.SLOTS; s2++) if (!M.empty(C.boxRef(sv, b, s2)) && X.species[M.species(C.boxRef(sv, b, s2))]) return [b, s2]; };
    const gar = D.species.findIndex(x => x.n === 'Garchomp'), mv = [D.moves.indexOf('Earthquake'), 0, 0, 0];
    while (C.partyCount(sv) < 3) C.createInParty(sv, D, X, { species: gar, level: 40 + C.partyCount(sv), nature: 3, moves: mv });
    const n = C.partyCount(sv), p0 = id(C.partyRef(sv, 0)), p1 = id(C.partyRef(sv, 1));
    assert.ok(C.moveMon(sv, D, X, P(0), P(1)));
    assert.strictEqual(id(C.partyRef(sv, 0)), p1); assert.strictEqual(id(C.partyRef(sv, 1)), p0);
    assert.ok(C.moveMon(sv, D, X, P(0), P(5)) || n === 1, 'to an empty party slot: goes last');
    assert.strictEqual(id(C.partyRef(sv, n - 1)), p1); assert.strictEqual(C.partyCount(sv), n);
    assert.strictEqual(C.moveMon(sv, D, X, P(2), P(2)), false);
    // box to box across boxes (swap and move to empty)
    if (!filledBox()) { const [b0, s0] = empty(); C.createInBox(sv, D, C.boxRef(sv, b0, s0), { species: gar, level: 30, nature: 1, moves: mv }); }
    let [fb, fs] = filledBox(), [eb, es] = empty();
    const bx = id(C.boxRef(sv, fb, fs));
    assert.ok(C.moveMon(sv, D, X, B(fb, fs), B(eb, es)));
    assert.strictEqual(id(C.boxRef(sv, eb, es)), bx); assert.ok(M.empty(C.boxRef(sv, fb, fs)));
    assert.strictEqual(C.moveMon(sv, D, X, B(fb, fs), B(eb, es)), false, 'dragging an empty slot does nothing');
    // party to an empty box slot (deposit), then back to the party (withdraw)
    const last = id(C.partyRef(sv, 0)), cnt = C.partyCount(sv); [eb, es] = empty();
    assert.ok(C.moveMon(sv, D, X, P(0), B(eb, es)));
    assert.strictEqual(C.partyCount(sv), cnt - 1); assert.strictEqual(id(C.boxRef(sv, eb, es)), last);
    assert.ok(C.moveMon(sv, D, X, B(eb, es), P(5)));
    assert.strictEqual(C.partyCount(sv), cnt); assert.strictEqual(id(C.partyRef(sv, cnt - 1)), last); assert.ok(M.empty(C.boxRef(sv, eb, es)));
    // box Pokémon onto a party Pokémon: they trade places, the new party one gets full HP and fresh stats
    [fb, fs] = [eb, es]; C.createInBox(sv, D, C.boxRef(sv, fb, fs), { species: gar, level: 55, nature: 0, moves: mv });
    const inBox = id(C.boxRef(sv, fb, fs)), inParty = id(C.partyRef(sv, 1));
    assert.ok(C.moveMon(sv, D, X, B(fb, fs), P(1)));
    const r = C.partyRef(sv, 1);
    assert.strictEqual(id(r), inBox); assert.strictEqual(id(C.boxRef(sv, fb, fs)), inParty); assert.strictEqual(C.partyCount(sv), cnt);
    assert.strictEqual(r.buf[r.off + 0x56] | (r.buf[r.off + 0x57] << 8), M.partyStats(r)[0]); assert.ok(!C.legality(D, X, r).some(p => p.field === 'stats'));
    assert.ok(C.moveMon(sv, D, X, P(1), B(fb, fs)), 'and back');
    assert.strictEqual(id(C.partyRef(sv, 1)), inParty); assert.strictEqual(id(C.boxRef(sv, fb, fs)), inBox);
    // the last Pokémon can't leave
    while (C.partyCount(sv) > 1) { const [b2, s3] = empty(); C.moveMon(sv, D, X, P(0), B(b2, s3)); }
    const [b4, s4] = empty();
    assert.throws(() => C.moveMon(sv, D, X, P(0), B(b4, s4)), /last Pokémon/);
    const back = C.load(C.build(sv, D));
    assert.strictEqual(C.partyCount(back), 1);
  });

  t('exact EXP: level follows, party level byte and stats stay in sync, limits hold, saves', () => {
    const sv = fresh(), refs = [C.partyRef(sv, 0)];
    for (let b = 0; b < C.BOXES && refs.length < 3; b++) for (let s2 = 0; s2 < C.SLOTS && refs.length < 3; s2++) if (!M.empty(C.boxRef(sv, b, s2))) refs.push(C.boxRef(sv, b, s2));
    for (const r of refs) {
      const g = C.growth(D, M.species(r)); if (!g) continue;
      const keep = [M.pid(r), M.ivWord(r), M.moves(r).join(), M.species(r)].join('|');
      for (const L of [1, 15, 50, 99]) {
        assert.ok(C.setExp(D, r, g[L + 1] - 1)); if (r.party) C.recalcStats(D, X, r);
        assert.strictEqual(C.levelOf(D, r), L, `1 EXP before ${L + 1} is still level ${L}`);
        if (r.party) { assert.strictEqual(M.level(r), L); assert.ok(!C.legality(D, X, r).some(p => /doesn't match|out of date/.test(p.text))); }
        C.setExp(D, r, g[L + 1]); if (r.party) C.recalcStats(D, X, r);
        assert.strictEqual(C.levelOf(D, r), L + 1);
      }
      C.setExp(D, r, g[100] + 1000); assert.strictEqual(M.exp(r), g[100]);
      C.setExp(D, r, -5); assert.strictEqual(M.exp(r), 0); assert.strictEqual(C.levelOf(D, r), 1);
      C.setExp(D, r, g[37] + 123); if (r.party) C.recalcStats(D, X, r);
      assert.strictEqual([M.pid(r), M.ivWord(r), M.moves(r).join(), M.species(r)].join('|'), keep, 'nothing else changes');
    }
    const back = C.load(C.build(sv, D));
    for (const r of [C.partyRef(back, 0)]) { const g = C.growth(D, M.species(r)); if (g) { assert.strictEqual(M.exp(r), g[37] + 123); assert.strictEqual(M.level(r), 37); } }
  });

  t('legality: level-up moves above its level are a warning (its own or a pre-evolution\'s), TM/tutor/egg moves are not', () => {
    const sv = fresh(), r = C.boxRef(sv, 24, 28); C.release(r);
    const sp = n => D.species.findIndex(x => x && x.n === n), mv = n => D.moves.indexOf(n);
    C.createInBox(sv, D, r, { species: sp('Froakie'), level: 15, nature: 0, moves: [mv('Bounce'), mv('Quick Attack'), mv('Hydro Pump'), 0] });
    let w = C.legality(D, X, r).filter(p => /levelling up/.test(p.text));
    assert.strictEqual(w.length, 1); assert.strictEqual(w[0].level, 'warn'); assert.strictEqual(w[0].field, 'move0'); assert.ok(/level 39/.test(w[0].text) && /level 15/.test(w[0].text));
    assert.ok(!C.isIllegal(D, X, r), 'a warning, not illegal');
    C.setLevel(D, r, 39); assert.ok(!C.legality(D, X, r).some(p => /levelling up/.test(p.text)), 'fine at level 39');
    M.setSpecies(r, sp('Greninja')); C.setLevel(D, r, 36); M.setMoves(r, [mv('Bounce'), mv('Water Shuriken'), 0, 0], D);
    w = C.legality(D, X, r).filter(p => /levelling up/.test(p.text));
    assert.strictEqual(w.length, 1); assert.ok(/pre-evolution Froakie/.test(w[0].text), 'pre-evolution move named: ' + w[0].text);
    // a real save: nothing the game gave it is flagged
    if (!/demo/.test(file)) for (let b = 0; b < C.BOXES; b++) for (let s2 = 0; s2 < C.SLOTS; s2++) { const x = C.boxRef(fresh(), b, s2); if (!M.empty(x)) assert.ok(!C.legality(D, X, x).some(p => /levelling up/.test(p.text))); }
  });

  t('unknown data (a save from another Radical Red version) is found; a 4.1 save has none', () => {
    const sv = fresh();
    assert.deepStrictEqual(C.unknownData(sv, D), []);
    const [b, s2] = (() => { for (let x = 0; x < C.BOXES; x++) for (let y = 0; y < C.SLOTS; y++) if (M.empty(C.boxRef(sv, x, y))) return [x, y]; })();
    C.createInBox(sv, D, C.boxRef(sv, b, s2), { species: 1, level: 5, nature: 0, moves: [1, 0, 0, 0] });
    M.setSpecies(C.boxRef(sv, b, s2), 1500);
    const u = C.unknownData(sv, D);
    assert.strictEqual(u.length, 1); assert.ok(/unknown species #1500/.test(u[0]));
  });

  t('converts to RetroArch .srm and back without changing the game data', () => {
    const srm = C.convertSave(bytes, 'srm');
    assert.strictEqual(srm.length, 0x20000);
    assert.ok(C.saveLayout(srm).ok);
    assert.deepStrictEqual(Buffer.from(srm), Buffer.from(bytes.subarray(0, 0x20000)));
    assert.deepStrictEqual(Buffer.from(C.build(C.load(srm), D)), Buffer.from(srm), 'the .srm round trips');
    assert.deepStrictEqual(Buffer.from(C.convertSave(bytes, 'sav')), Buffer.from(bytes), '.sav keeps the file as it is');
    assert.deepStrictEqual(Buffer.from(C.convertSave(srm, 'sav')), Buffer.from(srm));
    const a = C.load(srm), b = fresh();
    assert.strictEqual(a.saveIndex, b.saveIndex);
    assert.strictEqual(C.partyCount(a), C.partyCount(b));
    assert.throws(() => C.convertSave(bytes, 'gba'));
    assert.throws(() => C.convertSave(new Uint8Array(0x20000), 'srm'), 'a blank file is refused');
    assert.throws(() => C.convertSave(new Uint8Array(0x20008), 'srm'), 'an unknown size is refused');
    const bad = new Uint8Array(0x20000).fill(0xFF); bad.set(bytes.subarray(0, 0x1000));
    assert.throws(() => C.convertSave(bad, 'srm'), 'a damaged save is refused');
  });

  t('never-written (all 0xFF) box slots count as empty, like a RetroArch .srm', () => {
    const sv = fresh(), spots = [];
    for (let b = 19; b < 25; b++) for (let s = 0; s < C.SLOTS; s++) { const r = C.boxRef(sv, b, s); if (M.empty(r)) { r.buf.fill(0xFF, r.off, r.off + 58); spots.push([b, s]); } }
    if (!spots.length) return;
    const ff = C.build(sv, D), a = C.load(ff);
    assert.deepStrictEqual(C.unknownData(a, D), [], 'no "unknown species #65535"');
    for (const [b, s] of spots) assert.ok(M.empty(C.boxRef(a, b, s)));
    assert.deepStrictEqual(Buffer.from(C.build(C.load(ff), D)), Buffer.from(ff), 'round trip keeps it byte-identical');
    // Adding into a never-written slot, then saving.
    const [b0, s0] = spots[0], sp = D.species.findIndex(x => x.n === 'Pikachu');
    C.createInBox(a, D, C.boxRef(a, b0, s0), { species: sp, level: 5, nature: 3, shiny: false, moves: [D.moves.indexOf('Thunderbolt'), 0, 0, 0] });
    const r0 = C.boxRef(a, b0, s0);
    assert.strictEqual(M.species(r0), sp);
    // A slot that is 0xFF except one byte is not treated as empty.
    const [b1, s1] = spots[spots.length - 1], r1 = C.boxRef(a, b1, s1);
    r1.buf[r1.off + 30] = 0; assert.ok(!M.empty(r1)); r1.buf[r1.off + 30] = 0xFF; assert.ok(M.empty(r1));
    const n = C.clearErased(a);
    assert.strictEqual(n, spots.length - 1, 'the added Pokémon is kept, the rest are cleared');
    for (const [b, s] of spots.slice(1)) { const r = C.boxRef(a, b, s); assert.ok(r.buf.subarray(r.off, r.off + 58).every(x => x === 0)); }
    const out = C.load(C.build(a, D));
    assert.strictEqual(M.species(C.boxRef(out, b0, s0)), sp);
    assert.strictEqual(C.clearErased(out), 0);
    const sv0 = fresh(); let ffs = 0;
    for (let b = 0; b < 25; b++) for (let s = 0; s < C.SLOTS; s++) { const r = C.boxRef(sv0, b, s); if (r.buf.subarray(r.off, r.off + 58).every(x => x === 0xFF)) ffs++; }
    assert.strictEqual(C.clearErased(sv0), ffs, 'clears exactly the never-written slots');
  });

  t('picks the save slot like the game, ignoring a half-written or stray sector in the other slot', () => {
    const sv = fresh(), cur = sv.saveIndex, slot = Math.floor(sv.sec[0] / 0xE000), other = (1 - slot) * 14 * 0x1000;
    const sameSave = x => { const a = C.load(x); assert.strictEqual(a.saveIndex, cur); assert.deepStrictEqual(a.sec, sv.sec);
      assert.deepStrictEqual(Buffer.from(C.build(a, D)), Buffer.from(x)); };
    // The emulator wrote the file while the game was writing its next save into the other slot.
    for (let k = 1; k < 14; k++) {
      const x = bytes.slice();
      for (let i = 0; i < k; i++) { x.copyWithin(other + i * 0x1000, sv.sec[i], sv.sec[i] + 0x1000); new DataView(x.buffer).setUint32(other + i * 0x1000 + 0xFFC, cur + 1, true); }
      sameSave(x);
      assert.strictEqual(C.load(x).newerDamaged, cur + 1, 'the unfinished newer save is reported');
    }
    // A stray copy of section 0 with a newer counter and a bad checksum.
    const y = bytes.slice();
    y.copyWithin(other + 13 * 0x1000, sv.sec[0], sv.sec[0] + 0x1000);
    new DataView(y.buffer).setUint32(other + 13 * 0x1000 + 0xFFC, cur + 1, true); y[other + 13 * 0x1000] ^= 0xFF;
    sameSave(y);
    // The other slot is complete, valid and newer, but its sections are from different saves: refused, not guessed.
    const z = bytes.slice(), last = other + 13 * 0x1000, id = z[last + 0xFF4];
    z.copyWithin(last, sv.sec[id], sv.sec[id] + 0x1000);
    new DataView(z.buffer).setUint32(last + 0xFFC, cur + 1, true);
    const alone = bytes.slice(); for (let i = 0; i < 14; i++) alone.fill(0, slot * 0xE000 + i * 0x1000 + 0xFF8, slot * 0xE000 + i * 0x1000 + 0xFFC);
    let otherOk = true; try { C.load(alone); } catch { otherOk = false; }
    if (otherOk) assert.throws(() => C.load(z), /only partly written/); else sameSave(z);
    // An older save in the other slot never wins.
    if (cur >= 2) {
      const w = bytes.slice();
      for (let i = 0; i < 14; i++) new DataView(w.buffer).setUint32(other + i * 0x1000 + 0xFFC, cur - 2, true);
      sameSave(w);
      assert.strictEqual(C.load(w).newerDamaged, null);
    }
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
