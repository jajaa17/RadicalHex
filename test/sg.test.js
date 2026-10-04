// Usage: node test/sg.test.js <soulgold.srm|.sav> [more ...]
// Exercises every SoulGold editing path; each result must reload (with the game's own slot checks) and change only allowed bytes.
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = {};
eval(fs.readFileSync(path.join(__dirname, '../src/sg-data.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../src/sg-dex.js'), 'utf8'));
const D = window.SG_DATA, X = window.SG_DEX;
const C = require('../src/sg-core.js'), R = require('../src/core.js');
const M = C.mon;
let failures = 0;
const t = (name, fn) => { try { fn(); console.log('  ok  ', name); } catch (e) { failures++; console.log('  FAIL', name, '\n       ', e.message); } };
const sp = n => { const i = D.species.findIndex(s => s.n === n); assert.ok(i > 0, n); return i; };
const mv = n => { const i = D.moves.indexOf(n); assert.ok(i > 0, n); return i; };
const it = n => { const i = D.items.indexOf(n); assert.ok(i > 0, n); return i; };

t('SoulGold data looks right', () => {
  assert.strictEqual(D.species[1].n, 'Bulbasaur'); assert.strictEqual(D.species[1289].n, 'Sprigatito');
  assert.strictEqual(D.items[28], 'Potion'); assert.strictEqual(D.moves[1], 'Pound');
  assert.strictEqual(C.BALLS[1], 'Poké Ball');
  for (const n of ['Typhlosion-Mega', 'Meowscarada-Mega', 'Primarina-Mega', 'Absol-Mega-Z']) assert.ok(D.species[sp(n)].b, n + ' is battle-only');
  assert.deepStrictEqual(X.species[sp('Typhlosion')].st, [78, 84, 78, 109, 85, 100]);
});

for (const file of process.argv.slice(2)) {
  console.log(path.basename(file));
  const bytes = new Uint8Array(fs.readFileSync(file));
  const fresh = () => C.load(bytes);
  const save = sv => C.load(C.build(sv, D));

  t('round trip is byte-identical', () => assert.deepStrictEqual(Buffer.from(C.build(fresh(), D)), Buffer.from(bytes)));
  t('Radical Red core refuses it, and SoulGold refuses Radical Red files', () => {
    assert.throws(() => R.load(bytes));
    assert.throws(() => C.load(new Uint8Array(0x20000)));
    assert.throws(() => C.load(new Uint8Array(0x20000).fill(0xFF)));
  });
  t('a damaged live slot is never edited', () => {
    const sv = fresh(), bad = bytes.slice(); bad[sv.sec[6] + 100] ^= 0xFF;
    let other = null; try { other = C.load(bad); } catch { /* no complete older slot */ }
    if (other) { assert.notStrictEqual(other.slot, sv.slot); assert.strictEqual(other.newerDamaged, sv.saveIndex); }
    const bad2 = bytes.slice(); bad2[sv.aux + 40] ^= 0xFF; // box 19 sector
    let o2 = null; try { o2 = C.load(bad2); } catch { /* fine */ }
    if (o2) assert.notStrictEqual(o2.slot, sv.slot);
    const bad3 = bytes.slice(); bad3[sv.ov + 2000] ^= 0xFF; // box 17 data, covered by the box 18 checksum
    let o3 = null; try { o3 = C.load(bad3); } catch { /* fine */ }
    if (o3) assert.notStrictEqual(o3.slot, sv.slot);
  });
  t('box names and wallpapers edit and save for every box', () => {
    const sv = fresh();
    for (let b = 0; b < C.BOXES; b++) { assert.ok(C.setBoxName(sv, b, 'Name' + (b + 1))); assert.ok(C.setWallpaper(sv, b, (b * 5) % C.WALLPAPERS.length)); }
    assert.ok(!C.setBoxName(sv, 0, 'NineChars') && !C.setBoxName(sv, 0, '') && !C.setWallpaper(sv, 0, C.WALLPAPERS.length), 'bad input refused');
    const back = C.load(C.build(sv, D));
    for (let b = 0; b < C.BOXES; b++) { assert.strictEqual(C.boxName(back, b), 'Name' + (b + 1)); assert.strictEqual(C.wallpaper(back, b), (b * 5) % C.WALLPAPERS.length); }
    for (let b = 0; b < C.BOXES; b++) for (let s = 0; s < C.SLOTS; s++) assert.deepStrictEqual(Buffer.from(C.boxRef(back, b, s).buf.subarray(C.boxRef(back, b, s).off, C.boxRef(back, b, s).off + 20)), Buffer.from(C.boxRef(fresh(), b, s).buf.subarray(C.boxRef(fresh(), b, s).off, C.boxRef(fresh(), b, s).off + 20)), 'Pokémon untouched');
    C.setFriendsWallpaper(sv, true); assert.ok(C.friendsWallpaper(C.load(C.build(sv, D))), 'Friends wallpaper unlock');
  });

  t('party levels and stats match what the game stored', () => {
    const sv = fresh();
    for (let i = 0; i < C.partyCount(sv); i++) {
      const m = C.partyRef(sv, i);
      assert.strictEqual(C.expLevel(D, m), M.level(m));
      assert.deepStrictEqual(C.calcStats(D, X, m), M.partyStats(m));
      assert.deepStrictEqual(C.legality(D, X, m).filter(p => p.level !== 'info'), []);
    }
  });

  t('create a Pokémon in every box (1-19), then save and reload', () => {
    const sv = fresh(), made = [];
    for (let b = 0; b < C.BOXES; b++) {
      const s = (b * 7) % C.SLOTS, r = C.boxRef(sv, b, s);
      if (!M.empty(r)) continue;
      const opts = { species: [sp('Cyndaquil'), sp('Typhlosion'), sp('Eevee'), sp('Pikachu'), sp('Absol')][b % 5], level: 5 + b * 5,
        nature: b % 25, shiny: b % 2 === 0, gender: b % 2, item: b % 3 ? it('Leftovers') : 0, ball: 1 + (b % 5),
        moves: null, ivs: [31, 30, 29, 28, 27, 26], evs: [4, 252, 0, 0, 0, 252], ability: b % 3, nickname: b % 4 ? '' : 'Buddy' + b };
      const lv = X.species[opts.species].lv.filter(([, l]) => l <= opts.level).map(([m]) => m);
      opts.moves = [lv[0], b % 2 && lv[1] !== lv[0] ? lv[1] || 0 : 0, 0, 0];
      C.createInBox(sv, D, r, opts);
      made.push([b, s, opts]);
    }
    const back = save(sv);
    for (const [b, s, o] of made) {
      const m = C.boxRef(back, b, s), where = `box ${b + 1}`;
      assert.strictEqual(M.species(m), o.species, where);
      assert.strictEqual(C.levelOf(D, m), o.level, where);
      assert.strictEqual(M.nature(m), o.nature, where);
      assert.strictEqual(M.shiny(m), o.shiny, where);
      if (D.species[o.species].gr > 0 && D.species[o.species].gr < 254) assert.strictEqual(C.genderOf(D, m), o.gender, where);
      assert.strictEqual(M.item(m), o.item, where);
      assert.strictEqual(M.ball(m), o.ball, where);
      assert.deepStrictEqual(M.moves(m), o.moves, where);
      assert.deepStrictEqual(M.ivs(m), o.ivs, where);
      assert.deepStrictEqual(M.evs(m), o.evs, where);
      assert.strictEqual(M.abilityIndex(m), o.ability, where);
      assert.strictEqual(M.nickname(m), o.nickname || C.defaultNickname(D, o.species), where);
      assert.strictEqual(M.otName(m), C.trainer(back).name, where);
      assert.strictEqual(X.metNames[M.metLocation(m)], 'New Bark Town', where);
      assert.strictEqual(M.metLevel(m), o.level, where);
      // like a Pokémon caught in the game: the personality gives the nature and shininess, base friendship
      assert.strictEqual(m.buf[m.off + 20] >> 3, 0, where + ' hidden nature bits');
      assert.strictEqual((m.buf[m.off + 31] >> 6) & 1, 0, where + ' shiny bit');
      assert.strictEqual(M.pid(m) % 25, o.nature, where);
      assert.strictEqual(M.friendship(m), C.baseFriendship(D, o.species), where);
      assert.ok(!M.isEgg(m));
      const bad = C.legality(D, X, m).filter(p => p.level === 'error');
      assert.deepStrictEqual(bad, [], where + ' legal');
    }
    let open = 0; const f0 = fresh(); for (let b = 0; b < C.BOXES; b++) if (M.empty(C.boxRef(f0, b, (b * 7) % C.SLOTS))) open++;
    assert.strictEqual(made.length, open, 'made one in every box with room');
    assert.deepStrictEqual(C.unknownData(back, D), []);
  });

  t('box 19 and boxes 16-18 keep their data and the game checks pass after edits', () => {
    const sv = fresh(), was = {};
    for (const b of [15, 16, 17, 18]) for (let s = 0; s < C.SLOTS; s++) {
      const r = C.boxRef(sv, b, s);
      was[b * 100 + s] = M.empty(r) ? sp('Pikachu') : M.species(r);
      if (M.empty(r)) C.createInBox(sv, D, r, { species: sp('Pikachu'), level: 10 + s, nature: s % 25, shiny: false, moves: [mv('Thunder Shock'), 0, 0, 0] });
    }
    const out = C.build(sv, D), back = C.load(out);
    assert.strictEqual(back.slot, sv.slot); assert.strictEqual(back.saveIndex, sv.saveIndex);
    for (const b of [15, 16, 17, 18]) for (let s = 0; s < C.SLOTS; s++) assert.strictEqual(M.species(C.boxRef(back, b, s)), was[b * 100 + s]);
    // and back to empty
    for (const b of [15, 16, 17, 18]) for (let s = 0; s < C.SLOTS; s++) C.release(C.boxRef(back, b, s));
    const empty = C.load(C.build(back, D));
    for (const b of [15, 16, 17, 18]) for (let s = 0; s < C.SLOTS; s++) assert.ok(M.empty(C.boxRef(empty, b, s)));
  });

  t('nature, shiny, gender, ability and IDs edit independently', () => {
    const sv = fresh(), r = C.boxRef(sv, 0, 0);
    if (!M.empty(r)) C.release(r);
    C.createInBox(sv, D, r, { species: sp('Eevee'), level: 20, nature: 3, shiny: false, gender: 0, moves: [mv('Tackle'), 0, 0, 0] });
    for (let n = 0; n < 25; n++) for (const sh of [true, false]) {
      const g = C.genderOf(D, r), pid = M.pid(r), ab = M.abilityIndex(r);
      C.setNatureShiny(r, n, sh);
      assert.strictEqual(M.nature(r), n); assert.strictEqual(M.shiny(r), sh);
      assert.strictEqual(M.pid(r), pid, 'personality kept'); assert.strictEqual(C.genderOf(D, r), g); assert.strictEqual(M.abilityIndex(r), ab);
    }
    for (const g of [1, 0, 1]) { const n = M.nature(r), sh = M.shiny(r); assert.ok(C.setGender(D, r, g)); assert.strictEqual(C.genderOf(D, r), g); assert.strictEqual(M.nature(r), n); assert.strictEqual(M.shiny(r), sh); }
    for (const a of [2, 1, 0]) { C.setAbility(D, r, a); assert.strictEqual(M.abilityIndex(r), a); }
    C.setNatureShiny(r, 10, true);
    C.setOtIds(D, r, 12345, 54321);
    assert.strictEqual(M.otid(r), ((54321 << 16) | 12345) >>> 0); assert.ok(M.shiny(r)); assert.strictEqual(M.nature(r), 10);
    C.makeMine(sv, D, r);
    assert.ok(M.shiny(r)); assert.strictEqual(M.otName(r), C.trainer(sv).name);
    const back = save(sv), b2 = C.boxRef(back, 0, 0);
    assert.ok(M.shiny(b2)); assert.strictEqual(M.nature(b2), 10);
  });

  t('withdraw, deposit, swap and move keep the Pokémon intact', () => {
    const sv = fresh(), n0 = C.partyCount(sv);
    const r = C.boxRef(sv, 2, 3);
    if (!M.empty(r)) C.release(r);
    C.createInBox(sv, D, r, { species: sp('Typhlosion'), level: 50, nature: 15, shiny: true, moves: [mv('Flamethrower'), mv('Eruption'), 0, 0], evs: [0, 0, 4, 252, 0, 252] });
    const snap = Buffer.from(r.buf.subarray(r.off, r.off + 76));
    if (n0 < 6 && n0 >= 1) {
      const i = C.withdraw(sv, D, X, r);
      const p = C.partyRef(sv, i);
      assert.ok(M.empty(r));
      assert.strictEqual(M.level(p), 50); assert.deepStrictEqual(M.partyStats(p), C.calcStats(D, X, p));
      assert.strictEqual(C.partyStatus(p), '');
      const hp = p.buf[p.off + 82] | (p.buf[p.off + 83] << 8);
      assert.strictEqual(hp, M.partyStats(p)[0], 'full HP');
      assert.deepStrictEqual(Buffer.from(p.buf.subarray(p.off, p.off + 76)), snap, 'box part unchanged');
      C.deposit(sv, D, i, r);
      assert.deepStrictEqual(Buffer.from(r.buf.subarray(r.off, r.off + 76)), snap, 'deposited back unchanged');
      assert.strictEqual(C.partyCount(sv), n0);
    }
    if (n0 >= 1) {
      const before = Buffer.from(C.partyRef(sv, 0).buf.subarray(C.partyRef(sv, 0).off, C.partyRef(sv, 0).off + 76));
      assert.ok(C.moveMon(sv, D, X, { party: false, box: 2, slot: 3 }, { party: true, slot: 0 }));
      assert.strictEqual(M.species(C.partyRef(sv, 0)), sp('Typhlosion'));
      assert.deepStrictEqual(Buffer.from(r.buf.subarray(r.off, r.off + 76)), before, 'the party Pokémon went to the box as it was');
    }
    assert.ok(C.moveMon(sv, D, X, { party: false, box: 2, slot: 3 }, { party: false, box: 18, slot: 29 }) || M.empty(C.boxRef(sv, 2, 3)));
    const back = save(sv);
    assert.strictEqual(C.partyCount(back), n0);
  });

  t('heal, level, EXP and stats on a party Pokémon', () => {
    const sv = fresh();
    if (!C.partyCount(sv)) return;
    const p = C.partyRef(sv, 0);
    const w16 = (o, v) => { p.buf[p.off + o] = v & 255; p.buf[p.off + o + 1] = v >> 8; };
    w16(82, 1); p.buf[p.off + 76] = 0x08;
    assert.strictEqual(C.partyStatus(p), 'Poisoned');
    assert.ok(C.heal(D, p));
    assert.strictEqual(C.partyStatus(p), '');
    assert.strictEqual(p.buf[p.off + 82] | (p.buf[p.off + 83] << 8), M.partyStats(p)[0]);
    C.setLevel(D, p, 40); C.recalcStats(D, X, p);
    assert.strictEqual(M.level(p), 40); assert.deepStrictEqual(M.partyStats(p), C.calcStats(D, X, p));
    C.setExp(D, p, C.growth(D, M.species(p))[40] + 5);
    assert.strictEqual(M.level(p), 40);
    const back = save(sv), q = C.partyRef(back, 0);
    assert.strictEqual(M.level(q), 40); assert.deepStrictEqual(M.partyStats(q), C.calcStats(D, X, q));
  });

  t('bag, money, coins and Pokédex', () => {
    const sv = fresh();
    C.setMoney(sv, 1234567); C.setCoins(sv, 4321);
    const med = C.POCKETS.find(p => p.key === 'medicine'), balls = C.POCKETS.find(p => p.key === 'balls');
    C.writePocket(sv, med, [{ id: it('Potion'), qty: 5 }, { id: it('Full Restore'), qty: 999 }]);
    C.writePocket(sv, balls, [{ id: it('Ultra Ball'), qty: 30 }]);
    C.dex.register(sv, 155);
    const back = save(sv);
    assert.strictEqual(C.trainer(back).money, 1234567); assert.strictEqual(C.trainer(back).coins, 4321);
    assert.deepStrictEqual(C.readPocket(back, med), [{ id: it('Potion'), qty: 5 }, { id: it('Full Restore'), qty: 999 }]);
    assert.deepStrictEqual(C.readPocket(back, balls), [{ id: it('Ultra Ball'), qty: 30 }]);
    assert.ok(C.dex.seen(back, 155) && C.dex.caught(back, 155));
    assert.strictEqual(C.pocketOf(D, it('Potion')), 'medicine');
    assert.strictEqual(C.pocketOf(D, it('Ultra Ball')), 'balls');
    assert.throws(() => { const s2 = fresh(); C.writePocket(s2, med, [{ id: 9999, qty: 1 }]); C.build(s2, D); });
  });

  t('Candy Jar EXP reads, edits and saves (XORed with the key, outside the section checksum)', () => {
    const sv = fresh(), k = C.trainer(sv);
    assert.ok(C.candyJar(sv) >= 0 && C.candyJar(sv) <= C.CANDY_JAR_MAX);
    C.setCandyJar(sv, 123456);
    let back = save(sv);
    assert.strictEqual(C.candyJar(back), 123456);
    C.setCandyJar(back, 1e12); assert.strictEqual(C.candyJar(back), C.CANDY_JAR_MAX);
    back = save(back); assert.strictEqual(C.candyJar(back), C.CANDY_JAR_MAX);
    C.setCandyJar(back, 0); assert.strictEqual(C.candyJar(save(back)), 0);
    assert.ok(k);
  });

  t('Battle Points and Game Corner coins edit and save', () => {
    const sv = fresh();
    C.setBp(sv, 1234); C.setCoins(sv, 9999);
    let back = save(sv);
    assert.strictEqual(C.bp(back), 1234); assert.strictEqual(C.trainer(back).coins, 9999);
    C.setBp(back, 99999); assert.strictEqual(C.bp(back), C.BP_MAX);
    back = save(back); assert.strictEqual(C.bp(back), 9999);
  });

  t('registers owned Pokémon in the Pokédex when saving', () => {
    const sv = fresh(), r = C.boxRef(sv, 4, 4);
    if (!M.empty(r)) C.release(r);
    C.createInBox(sv, D, r, { species: sp('Absol'), level: 30, nature: 0, moves: [mv('Bite'), 0, 0, 0] });
    const had = C.dex.caught(sv, 359), got = C.registerOwned(sv, D);
    assert.strictEqual(got.includes(359), !had);
    assert.ok(C.dex.caught(save(sv), 359));
  });

  t('never-written (all 0xFF) box slots count as empty', () => {
    const sv = fresh(), r = C.boxRef(sv, 3, 3);
    if (!M.empty(r)) C.release(r);
    r.buf.fill(0xFF, r.off, r.off + 76);
    assert.ok(M.empty(r));
    assert.ok(C.clearErased(sv) >= 1);
    assert.ok(r.buf.subarray(r.off, r.off + 76).every(x => x === 0));
  });

  t('Showdown sets go both ways', () => {
    const sv = fresh(), r = C.boxRef(sv, 1, 1);
    if (!M.empty(r)) C.release(r);
    const { opts, warnings } = C.fromShowdown(D, 'Sparky (Pikachu) (F) @ Leftovers\nAbility: Lightning Rod\nLevel: 42\nShiny: Yes\nEVs: 252 SpA / 4 SpD / 252 Spe\nTimid Nature\nIVs: 0 Atk\n- Thunderbolt\n- Protect', X);
    assert.deepStrictEqual(warnings, []);
    C.createInBox(sv, D, r, opts);
    const txt = C.toShowdown(D, r, X);
    for (const s of ['Sparky (Pikachu) (F) @ Leftovers', 'Ability: Lightning Rod', 'Level: 42', 'Shiny: Yes', 'Timid Nature', '- Thunderbolt', '- Protect']) assert.ok(txt.includes(s), s + ' in\n' + txt);
  });

  t('converts to RetroArch .srm and back without changing the save data', () => {
    const srm = C.convertSave(bytes, 'srm');
    assert.strictEqual(srm.length, 0x20000);
    assert.deepStrictEqual(Buffer.from(C.convertSave(srm, 'sav')), Buffer.from(srm));
    assert.deepStrictEqual(Buffer.from(C.build(C.load(srm), D)), Buffer.from(srm));
  });

  t('a save edit never touches the older slot or SaveBlock3', () => {
    const sv = fresh(), r = C.boxRef(sv, 0, 5);
    if (!M.empty(r)) C.release(r);
    C.createInBox(sv, D, r, { species: sp('Cyndaquil'), level: 5, nature: 1, moves: [mv('Tackle'), 0, 0, 0] });
    const out = C.build(sv, D), other = 1 - sv.slot;
    for (let i = 0; i < 14; i++) { const o = (other * 14 + i) * 0x1000; assert.ok(out.subarray(o, o + 0x1000).every((v, k) => v === bytes[o + k]), 'older slot sector ' + i); }
    for (const o of [(30 + other) * 0x1000, (28 + other) * 0x1000]) assert.ok(out.subarray(o, o + 0x1000).every((v, k) => v === bytes[o + k]));
    for (let i = 0; i < 14; i++) { const o = sv.sec[i]; assert.ok(out.subarray(o + 3968, o + 0xFF4).every((v, k) => v === bytes[o + 3968 + k]), 'SaveBlock3 chunk ' + i); }
  });
}

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
