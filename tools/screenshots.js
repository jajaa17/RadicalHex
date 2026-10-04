// Makes the README screenshots (docs/screenshot-*.png) in dark mode, from a demo save built here, so no real save is needed.
// Usage: npx electron tools/screenshots.js
//        (Linux without a display: xvfb-run -a npx electron tools/screenshots.js --no-sandbox)
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const C = require('../src/core.js');
const load = f => { const w = {}; new Function('window', fs.readFileSync(path.join(root, f), 'utf8'))(w); return w; };
const D = load('src/data.js').RH_DATA, X = load('src/dex.js').RH_DEX, M = C.mon;
const sp = n => { const i = D.species.findIndex(s => s && s.n === n); if (i < 0) throw new Error('No species ' + n); return i; };
const it = n => { const i = D.items.indexOf(n); if (i < 0) throw new Error('No item ' + n); return i; };
const mv = (...n) => n.map(x => { const i = D.moves.indexOf(x); if (i < 0) throw new Error('No move ' + x); return i; });
const met = n => { const k = Object.keys(X.metNames).find(i => X.metNames[i] === n); if (!k) throw new Error('No place ' + n); return +k; };
// The last level-up moves a species knows at a level, like a wild Pokémon.
const lvMoves = (id, level) => [...new Set(X.species[id].lv.filter(([m, l]) => m && l <= level).map(([m]) => m))].slice(-4).map(m => D.moves[m]);

// ── Demo save: 14 empty sections with valid footers, then Pokémon, items and money added with RadicalHex's own code ──
function demoSave() {
  const data = new Uint8Array(0x20000);
  const w16 = (o, v) => { data[o] = v & 255; data[o + 1] = v >>> 8; };
  const w32 = (o, v) => { w16(o, v & 0xFFFF); w16(o + 2, v >>> 16); };
  data.set(C.encodeText('RED', 7), 0); data[7] = 0xFF; // trainer name
  w16(0xA, 24601); w16(0xC, 11037); // trainer and secret id
  const party = [
    ['Charizard', 62, 'Timid', 'Charizardite Y', ['Flamethrower', 'Air Slash', 'Solar Beam', 'Focus Blast'], 2, 'Route 4'],
    ['Snorlax', 61, 'Careful', 'Leftovers', ['Body Slam', 'Rest', 'Sleep Talk', 'Curse'], 0, 'Route 12'],
    ['Lapras', 60, 'Modest', 'Assault Vest', ['Freeze-Dry', 'Surf', 'Thunderbolt', 'Ice Shard'], 0, 'Silph Co.'],
    ['Alakazam', 61, 'Timid', 'Life Orb', ['Psychic', 'Shadow Ball', 'Focus Blast', 'Recover'], 2, 'Route 24'],
    ['Gyarados', 62, 'Jolly', 'Heavy-Duty Boots', ['Waterfall', 'Bounce', 'Dragon Dance', 'Earthquake'], 0, 'Route 6'],
    ['Venusaur', 60, 'Bold', 'Black Sludge', ['Giga Drain', 'Sludge Bomb', 'Leech Seed', 'Synthesis'], 2, 'Pallet Town'],
  ];
  for (let id = 0; id < 14; id++) {
    const o = id * 0x1000;
    w16(o + 0xFF4, id); w32(o + 0xFF8, 0x08012025); w32(o + 0xFFC, 40);
    w16(o + 0xFF6, C.checksum(data, o, C.WIN[id]));
  }
  const sv = C.load(data);
  let n = 0;
  const add = (box, slot, [name, level, nature, item, moves, ability, place], extra = {}) => {
    const ref = C.boxRef(sv, box, slot);
    C.createInBox(sv, D, ref, { species: sp(name), level, nature: C.NATURES.indexOf(nature), item: item ? it(item) : 0, moves: mv(...moves).concat([0, 0, 0]).slice(0, 4),
      ability, shiny: false, gender: null, ball: [3, 2, 1, 14, 12][n++ % 5], friendship: 255, ivs: [31, 31, 31, 31, 31, 31], evs: [0, 0, 0, 0, 0, 0], ...extra });
    ref.buf[ref.off + 0x33] = met(place); ref.buf[ref.off + 0x34] = (ref.buf[ref.off + 0x34] & 0x80) | Math.min(level, 40);
    return ref;
  };
  // Party: made in a spare box slot, then withdrawn like in the game.
  party.forEach(p => C.withdraw(sv, D, X, add(24, 29, p)));
  const box1 = [
    ['Garchomp', 58, 'Jolly', 'Choice Scarf', ['Earthquake', 'Outrage', 'Stone Edge', 'Fire Fang'], 2, 'Victory Road'],
    ['Golisopod', 54, 'Adamant', 'Assault Vest', ['First Impression', 'Liquidation', 'Leech Life', 'Knock Off'], 0, 'Route 19'],
    ['Espeon', 53, 'Timid', 'Leftovers', ['Psychic', 'Dazzling Gleam', 'Shadow Ball', 'Calm Mind'], 2, 'Celadon City'],
    ['Umbreon', 53, 'Calm', 'Leftovers', ['Foul Play', 'Moonlight', 'Wish', 'Protect'], 0, 'Celadon City'],
    ['Gengar', 55, 'Timid', 'Focus Sash', ['Shadow Ball', 'Sludge Bomb', 'Focus Blast', 'Nasty Plot'], 0, 'Pokémon Tower'],
    ['Dragonite', 57, 'Adamant', 'Heavy-Duty Boots', ['Dragon Dance', 'Extreme Speed', 'Earthquake', 'Fire Punch'], 2, 'Safari Zone'],
    ['Tyranitar', 56, 'Careful', 'Leftovers', ['Stone Edge', 'Crunch', 'Earthquake', 'Stealth Rock'], 0, 'Mt. Moon'],
    ['Metagross', 56, 'Jolly', 'Life Orb', ['Meteor Mash', 'Zen Headbutt', 'Bullet Punch', 'Earthquake'], 0, 'Power Plant'],
    ['Lucario', 52, 'Timid', 'Life Orb', ['Aura Sphere', 'Flash Cannon', 'Vacuum Wave', 'Nasty Plot'], 1, 'Rock Tunnel'],
    ['Gardevoir', 62, 'Modest', 'Choice Specs', ['Moonblast', 'Psychic', 'Mystical Fire', 'Calm Mind'], 0, 'Route 2'],
    ['Togekiss', 54, 'Calm', 'Leftovers', ['Air Slash', 'Dazzling Gleam', 'Roost', 'Nasty Plot'], 1, 'Route 5'],
    ['Rotom-Wash', 50, 'Bold', 'Leftovers', ['Hydro Pump', 'Volt Switch', 'Will-O-Wisp', 'Pain Split'], 0, 'Power Plant'],
    ['Ferrothorn', 51, 'Relaxed', 'Rocky Helmet', ['Gyro Ball', 'Leech Seed', 'Knock Off', 'Spikes'], 0, 'Rock Tunnel'],
    ['Corviknight', 52, 'Impish', 'Leftovers', ['Brave Bird', 'Body Press', 'Roost', 'Defog'], 0, 'Route 8'],
    ['Toxapex', 68, 'Bold', 'Black Sludge', ['Scald', 'Recover', 'Toxic', 'Haze'], 1, 'Seafoam Islands'],
    ['Volcarona', 55, 'Timid', 'Heavy-Duty Boots', ['Quiver Dance', 'Fiery Dance', 'Bug Buzz', 'Giga Drain'], 0, 'Route 15'],
    ['Hydreigon', 56, 'Modest', 'Choice Specs', ['Draco Meteor', 'Dark Pulse', 'Flamethrower', 'U-turn'], 0, 'Cerulean Cave'],
    ['Excadrill', 53, 'Jolly', 'Focus Sash', ['Earthquake', 'Iron Head', 'Rock Slide', 'Rapid Spin'], 2, 'Diglett\'s Cave'],
    ['Scizor', 54, 'Adamant', 'Choice Band', ['Bullet Punch', 'U-turn', 'Close Combat', 'Knock Off'], 1, 'Safari Zone'],
    ['Azumarill', 51, 'Adamant', 'Choice Band', ['Aqua Jet', 'Play Rough', 'Liquidation', 'Superpower'], 1, 'Route 25'],
    ['Salamence', 57, 'Naive', 'Life Orb', ['Draco Meteor', 'Earthquake', 'Fire Blast', 'Roost'], 0, 'Victory Road'],
    ['Blaziken', 54, 'Adamant', 'Life Orb', ['Flare Blitz', 'Close Combat', 'Thunder Punch', 'Swords Dance'], 2, 'Route 3'],
    ['Greninja', 55, 'Timid', 'Life Orb', ['Hydro Pump', 'Dark Pulse', 'Ice Beam', 'Water Shuriken'], 2, 'Route 24'],
    ['Talonflame', 50, 'Jolly', 'Heavy-Duty Boots', ['Brave Bird', 'Flare Blitz', 'Roost', 'Swords Dance'], 2, 'Route 16'],
    ['Mimikyu', 52, 'Jolly', 'Life Orb', ['Play Rough', 'Shadow Claw', 'Shadow Sneak', 'Swords Dance'], 0, 'Pokémon Tower'],
    ['Kingambit', 58, 'Adamant', 'Leftovers', ['Kowtow Cleave', 'Iron Head', 'Sucker Punch', 'Swords Dance'], 0, 'Route 23'],
    ['Dragapult', 57, 'Jolly', 'Choice Band', ['Dragon Darts', 'Phantom Force', 'U-turn', 'Sucker Punch'], 1, 'Route 23'],
    ['Meowscarada', 55, 'Jolly', 'Choice Scarf', ['Flower Trick', 'Knock Off', 'U-turn', 'Triple Axel'], 0, 'Route 1'],
    ['Skeledirge', 64, 'Bold', 'Leftovers', ['Torch Song', 'Shadow Ball', 'Slack Off', 'Will-O-Wisp'], 0, 'Route 1'],
    ['Eevee', 30, 'Hardy', 'Eviolite', ['Quick Attack', 'Bite', 'Swift', 'Baby-Doll Eyes'], 1, 'Celadon City'],
  ];
  const shiny = new Set([2, 5, 16, 27]);
  box1.forEach((p, s) => add(0, s, p, { shiny: shiny.has(s), evs: s % 3 ? [0, 252, 4, 0, 0, 252] : [252, 0, 4, 0, 252, 0] }));
  const early = [['Pidgey', 'Route 1'], ['Rattata', 'Route 1'], ['Caterpie', 'Viridian Forest'], ['Weedle', 'Viridian Forest'], ['Zubat', 'Mt. Moon'],
    ['Geodude', 'Mt. Moon'], ['Oddish', 'Route 24'], ['Abra', 'Route 24'], ['Machop', 'Rock Tunnel'], ['Growlithe', 'Route 7'],
    ['Ponyta', 'Route 17'], ['Psyduck', 'Route 6'], ['Bellsprout', 'Route 25'], ['Tentacool', 'Route 4'], ['Magikarp', 'Route 4']];
  early.forEach(([name, place], s) => add(1, s, [name, 8 + s, C.NATURES[s * 7 % 25], 0, lvMoves(sp(name), 8 + s), 0, place]));
  ['Ditto', 'Pikachu', 'Gastly'].forEach((name, s) => add(2, s, [name, 20, 'Hardy', 0, lvMoves(sp(name), 20), 0, ['Route 9', 'Viridian Forest', 'Pokémon Tower'][s]]));
  const pocket = (key, list) => C.writePocket(sv, C.POCKETS.find(p => p.key === key), list.map(([name, qty]) => ({ id: it(name), qty })));
  pocket('items', [['Rare Candy', 87], ['Bottle Cap', 6], ['Gold Bottle Cap', 2], ['Ability Pill', 3], ['Dream Patch', 1], ['HP Up', 12], ['Protein', 20],
    ['Iron', 9], ['Calcium', 14], ['Zinc', 9], ['Carbos', 31], ['PP Up', 5], ['Max Revive', 8], ['Full Restore', 15], ['Max Repel', 23], ['Escape Rope', 4],
    ['Leftovers', 2], ['Life Orb', 1], ['Choice Scarf', 1], ['Weakness Policy', 1], ['Expert Belt', 1], ['Light Clay', 1], ['Sharp Beak', 1], ['Mystic Water', 1]]);
  pocket('balls', [['Poke Ball', 34], ['Ultra Ball', 41], ['Quick Ball', 12], ['Dusk Ball', 7]]);
  pocket('berries', [['Sitrus Berry', 9], ['Lum Berry', 6], ['Oran Berry', 18]]);
  C.setMoney(sv, 384200);
  C.registerOwned(sv, D); // like a played game: everything owned is caught
  const out = C.serialize(sv), check = C.load(out); // the demo must load like a real save, with nothing illegal on screen
  const refs = [...Array(C.partyCount(check)).keys()].map(i => C.partyRef(check, i));
  for (let b = 0; b < C.BOXES; b++) for (let s = 0; s < C.SLOTS; s++) refs.push(C.boxRef(check, b, s));
  for (const r of refs) if (!M.empty(r)) for (const p of C.legality(D, X, r)) if (p.level !== 'info') console.log('demo:', D.species[M.species(r)].n, p.text);
  return out;
}

module.exports = { demoSave };
// Electron's entry script is not require.main, so check the command line instead.
if (process.versions.electron && path.resolve(process.argv[1] || '') === __filename) shoot();

// ── Window ──
function shoot() {
  const call = v => () => ({ ok: true, value: v });
  ipcMain.handle('set-dirty', call());
  ipcMain.handle('list-backups', call([]));
  ipcMain.handle('version', call(require('../package.json').version));

  const wait = ms => new Promise(r => setTimeout(r, ms));
  app.disableHardwareAcceleration();
  app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark'; // RadicalHex follows the Windows theme; the README shows the dark one
    // Shown, and never throttled: a hidden window can hand capturePage a frame from before the last change.
    const win = new BrowserWindow({ width: 1440, height: 880, useContentSize: true, show: true, backgroundColor: '#141217',
      webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    await win.webContents.session.clearStorageData(); // no Nuzlocke or RadicalHaX settings left from an earlier run
    await win.loadFile(path.join(root, 'src', 'index.html'));
    const js = code => win.webContents.executeJavaScript(`{ ${code} }`); // a block, so each step has its own consts
    const shot = async name => { await wait(400); await js(`Promise.all([...document.images].filter(i => i.getBoundingClientRect().width).map(i => i.decode().catch(() => {})))`); await wait(400); fs.writeFileSync(path.join(root, 'docs', `screenshot-${name}.png`), (await win.webContents.capturePage()).toPNG()); console.log('docs/screenshot-' + name + '.png'); };
    const bytes = Buffer.from(demoSave()).toString('base64');
    await js(`RadicalHex.openBytes(Uint8Array.from(atob('${bytes}'), c => c.charCodeAt(0)), 'RadicalRed.sav'); document.querySelector('#status').textContent = 'Opened RadicalRed.sav. A backup was saved in C:\\\\Games\\\\RadicalHex\\\\Backups.';`);
    // Boxes: Garchomp, with its hidden ability and held item.
    await js(`document.querySelector('.tab[data-tab="boxes"]').click(); document.querySelectorAll('.pc .slot')[0].click();`);
    await shot('boxes');
    await js(`document.querySelector('.tab[data-tab="party"]').click(); document.querySelectorAll('.pcard')[0].click();`);
    await shot('party');
    await js(`document.querySelector('.tab[data-tab="trainer"]').click();`);
    await shot('bag');
    await js(`document.querySelector('.tab[data-tab="dex"]').click(); const s = document.querySelector('#dex-search'); s.value = 'Eevee'; s.dispatchEvent(new Event('input'));`);
    await wait(300);
    await js(`[...document.querySelectorAll('.dex-row')].find(b => b.querySelector('.grow').textContent === 'Eevee').click();
      const s = document.querySelector('#dex-search'); s.value = ''; s.dispatchEvent(new Event('input')); s.blur();`);
    // Scroll the full list to Eevee (rows are 35 px, in RadicalDex order: national number, then id).
    const order = Object.keys(X.species).map(Number).filter(id => D.species[id] && D.species[id].n).sort((a, b) => X.species[a].nat - X.species[b].nat || a - b);
    await js(`const list = document.querySelector('.dex-list'); list.scrollTop = ${order.indexOf(sp('Eevee')) * 35} - list.clientHeight / 2 + 17; list.dispatchEvent(new Event('scroll'));`);
    await shot('radicaldex');
    await js(`document.querySelector('.tab[data-tab="nuzlocke"]').click(); const g = document.querySelector('#nz-grave'); g.value = '2'; g.dispatchEvent(new Event('change'));`);
    await js(`const c = document.querySelector('#nz-cap'); c.value = '9'; c.dispatchEvent(new Event('change'));`); // Koga, Lv 68
    await shot('nuzlocke');
    app.exit(0);
  }).catch(e => { console.error(e); app.exit(1); });
}
