// RadicalHex sounds: short GBA-style blips made on the fly with Web Audio (no sound files, nothing loaded
// until the first sound), and Pokémon cries, loaded one at a time only when asked for.
window.RHSound = (() => {
  'use strict';
  let on = true;
  try { on = localStorage.getItem('radicalhex-sound') !== '0'; } catch { /* default on */ }
  let ctx = null, master = null;
  function audio() {
    if (!ctx) {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return null;
      ctx = new A();
      master = ctx.createGain();
      master.gain.value = 0.12;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Each note: [frequency, start (s), length (s), wave, volume, glide-to frequency]
  const SQ = 'square', TRI = 'triangle';
  const SFX = {
    tick: [[1568, 0, 0.03, SQ, 0.35]],                                     // a button
    tab: [[1175, 0, 0.03, SQ, 0.3], [1568, 0.03, 0.04, SQ, 0.3]],          // tabs and pockets
    select: [[988, 0, 0.035, SQ, 0.35], [1319, 0.035, 0.05, SQ, 0.35]],    // a Pokémon slot
    open: [[784, 0, 0.04, TRI, 0.6]],                                     // a list opens
    pick: [[1319, 0, 0.04, SQ, 0.3], [1760, 0.04, 0.06, SQ, 0.3]],         // a choice in a list
    ok: [[1319, 0, 0.04, TRI, 0.7], [1976, 0.045, 0.07, TRI, 0.7]],        // an edit went through
    error: [[196, 0, 0.09, SQ, 0.5], [147, 0.1, 0.16, SQ, 0.5]],
    undo: [[1319, 0, 0.04, TRI, 0.7], [880, 0.045, 0.08, TRI, 0.7]],
    save: [[1047, 0, 0.07, SQ, 0.3], [1319, 0.07, 0.07, SQ, 0.3], [1568, 0.14, 0.07, SQ, 0.3], [2093, 0.21, 0.2, TRI, 0.7]],
    ball: [[330, 0, 0.06, SQ, 0.35, 660], [880, 0.08, 0.03, SQ, 0.3], [880, 0.16, 0.03, SQ, 0.3], [1760, 0.26, 0.22, TRI, 0.7]], // Poké Ball wobble, then caught
    release: [[1175, 0, 0.3, TRI, 0.7, 294]],
    heal: [[1047, 0, 0.07, TRI, 0.7], [1319, 0.08, 0.07, TRI, 0.7], [1568, 0.16, 0.07, TRI, 0.7], [1319, 0.24, 0.07, TRI, 0.7], [2093, 0.32, 0.22, TRI, 0.7]],
    shiny: [[2093, 0, 0.05, TRI, 0.6], [2637, 0.05, 0.05, TRI, 0.6], [3136, 0.1, 0.05, TRI, 0.6], [4186, 0.15, 0.16, TRI, 0.5], [3136, 0.22, 0.12, TRI, 0.35]],
    hax: [[523, 0, 0.06, SQ, 0.3], [622, 0.06, 0.06, SQ, 0.3], [740, 0.12, 0.12, SQ, 0.3]],
  };
  let last = 0;
  function play(name) {
    if (!on || !SFX[name]) return;
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime + 0.005;
    if (name === 'tick' && t0 - last < 0.03) return; // no machine-gun clicks
    last = t0;
    for (const [f, s, d, type, v, to] of SFX[name]) {
      const o = a.createOscillator(), g = a.createGain(), t = t0 + s;
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + d + 0.02);
    }
  }

  // Cries: one small file per national dex number, played at a fixed volume. A new cry stops the previous one.
  let current = null;
  function cry(nat, el) {
    if (!nat) return;
    if (current) { current.pause(); current = null; }
    const a = new Audio(`assets/cries/${nat}.ogg`);
    a.volume = 0.45;
    a.play().catch(() => {});
    current = a;
    a.addEventListener('ended', () => { if (current === a) current = null; });
    if (el) { el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop'); } // restart the hop
  }

  function setOn(v) {
    on = !!v;
    try { localStorage.setItem('radicalhex-sound', on ? '1' : '0'); } catch { /* not remembered */ }
  }
  return { play, cry, isOn: () => on, setOn };
})();
