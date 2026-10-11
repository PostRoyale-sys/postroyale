// Звук игры. Всё синтезируется в браузере (без файлов): каждый звук один раз считается в буфер
// (несколько вариантов, чтобы выстрелы и шаги не звучали одинаково), дальше — только воспроизведение:
// источник → (фильтр по расстоянию) → громкость → панорама → шина; часть — в общий ревербератор.
// Музыка лобби — 16 тактов, считается тем же DSP при первом входе в лобби и крутится по кругу без шва.

import * as THREE from 'three';

const PI2 = Math.PI * 2;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// ---------- DSP: генерация буферов ----------

function makeDsp(SR) {
  let seed = 1;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed / 2147483648; };    // −1..1
  const r01 = () => rnd() * 0.5 + 0.5;
  const D = {
    SR,
    seed(s) { seed = s | 0 || 1; for (let i = 0; i < 4; i++) rnd(); },
    rnd, r01,
    r: (a, b) => a + (b - a) * r01(),
    arr: (sec) => new Float32Array(Math.max(1, Math.ceil(sec * SR))),
    env: (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d)),
  };
  // Биквад (RBJ): lp | hp | bp; частота — число или функция времени (пересчёт каждые 32 сэмпла).
  D.filt = (x, type, f, q = 0.707) => {
    let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const set = (fr) => {
      const w = PI2 * Math.min(Math.max(fr, 10), SR * 0.45) / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
      if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
      else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
      else { b0 = al; b1 = 0; b2 = -al; }
      b0 /= a0; b1 /= a0; b2 /= a0; a1 = -2 * c / a0; a2 = (1 - al) / a0;
    };
    const fn = typeof f === 'function';
    if (!fn) set(f);
    for (let i = 0; i < x.length; i++) {
      if (fn && (i & 31) === 0) set(f(i / SR));
      const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
    }
    return x;
  };
  // Шумовой всплеск: огибающая (атака a, спад d), фильтр, «зернистость» (gr — длина зерна в мс).
  D.burst = (dur, o = {}) => {
    const x = D.arr(dur), a = o.a ?? 0.0005, d = o.d ?? 0.05;
    for (let i = 0; i < x.length; i++) x[i] = rnd() * D.env(i / SR, a, d);
    if (o.gr) D.grain(x, o.gr, o.gd ?? 0.7);
    if (o.type) { D.filt(x, o.type, o.f, o.q); if (o.steep) D.filt(x, o.type, o.f, o.q); }
    return x;
  };
  // Тон со скольжением частоты f0 → f1 (постоянная gt), форма sin | tri | saw | sq.
  D.tone = (dur, f0, f1, o = {}) => {
    const x = D.arr(dur), a = o.a ?? 0.001, d = o.d ?? dur / 3, gt = o.gt ?? dur / 4, sh = o.shape || 'sin', vib = o.vib || 0;
    let ph = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      const f = (f1 + (f0 - f1) * Math.exp(-t / gt)) * (1 + vib * Math.sin(PI2 * 5.5 * t));
      ph += PI2 * f / SR;
      const p = (ph / PI2) % 1;
      const v = sh === 'sin' ? Math.sin(ph) : sh === 'tri' ? 1 - 4 * Math.abs(p - 0.5) : sh === 'saw' ? 2 * p - 1 : p < 0.5 ? 1 : -1;
      x[i] = v * D.env(t, a, d);
    }
    return x;
  };
  // Металл/стекло/дерево: сумма затухающих синусов (моды), чуть разные спады.
  D.modes = (dur, freqs, d, o = {}) => {
    const x = D.arr(dur), ph = freqs.map(() => r01() * PI2), a = o.a ?? 0.0004;
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      let v = 0;
      for (let k = 0; k < freqs.length; k++) v += Math.sin(PI2 * freqs[k] * t + ph[k]) * Math.exp(-t / (d * (1 - k * 0.12)));
      x[i] = v / freqs.length * (t < a ? t / a : 1);
    }
    return x;
  };
  D.grain = (x, ms, depth) => {
    const n = Math.max(1, Math.round(ms / 1000 * SR));
    for (let i = 0; i < x.length; i += n) { const g = 1 - depth + depth * r01(); for (let k = i; k < i + n && k < x.length; k++) x[k] *= g; }
    return x;
  };
  D.add = (dst, src, t0 = 0, g = 1) => {
    const o = Math.round(t0 * SR);
    for (let i = Math.max(0, -o); i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * g;
    return dst;
  };
  D.sat = (x, k) => { const n = Math.tanh(k); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * k) / n; return x; };
  D.gain = (x, g) => { for (let i = 0; i < x.length; i++) x[i] *= g; return x; };
  D.norm = (x, peak = 0.95) => {
    let m = 0;
    for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
    if (m > 1e-6) D.gain(x, peak / m);
    const f = Math.min(x.length, Math.round(0.004 * SR));            // хвост — в ноль (без щелчка)
    for (let i = 0; i < f; i++) x[x.length - 1 - i] *= i / f;
    return x;
  };
  // Петля без шва: последние fade секунд подмешиваются в начало.
  D.loopify = (x, fade) => {
    const fn = Math.round(fade * SR), n = x.length - fn, out = x.slice(0, n);
    for (let i = 0; i < fn; i++) { const k = i / fn; out[i] = x[i] * k + x[n + i] * (1 - k); }
    return out;
  };
  // Частые кирпичики
  D.click = (f = 3000, d = 0.008) => D.add(D.modes(0.05, [f, f * 1.47, f * 2.09], d), D.burst(0.01, { d: 0.0015, type: 'hp', f: 2000 }), 0, 0.6);
  D.scrape = (dur, f, q = 2) => D.burst(dur, { a: dur * 0.3, d: dur * 0.35, type: 'bp', f, q, gr: 3, gd: 0.8 });
  D.thud = (dur, f0, f1, d) => D.tone(dur, f0, f1, { d, gt: dur / 5 });
  D.cloth = (dur, f = 1100, g = 1) => D.gain(D.burst(dur, { a: dur * 0.4, d: dur * 0.3, type: 'bp', f, q: 0.6, gr: 6, gd: 0.5 }), g);
  D.bells = (x, notes, step, d = 0.4, g = 1, t0 = 0) => {
    notes.forEach((f, i) => { D.add(x, D.modes(d * 3, [f, f * 2, f * 3.01], d), t0 + i * step, g); D.add(x, D.tone(d * 2, f, f, { d }), t0 + i * step, g * 0.6); });
    return x;
  };
  return D;
}

// ---------- Оружие: слои выстрела ----------
// crack — щелчок дульной волны, body — «тело» (полосовой шум), thump — удар по низам (тон со спадом),
// tail — хвост (низкочастотный шум), ring — металлический звон, mech — механика (затвор).
const GUN = {
  pistol: { len: 0.55, crack: 0.9, body: [1250, 0.018, 0.9], thump: [210, 65, 0.035, 0.9], tail: [1500, 0.1, 0.35], ring: [2900, 0.02, 0.12], mech: [3600, 0.035, 0.18], sat: 2.0 },
  smg: { len: 0.4, crack: 0.8, body: [1700, 0.012, 0.85], thump: [230, 80, 0.022, 0.7], tail: [1900, 0.07, 0.3], ring: [3400, 0.014, 0.1], mech: [4200, 0.03, 0.14], sat: 2.2 },
  ar: { len: 0.8, crack: 1.0, body: [1050, 0.03, 0.95], thump: [150, 52, 0.055, 1.0], tail: [1100, 0.17, 0.42], ring: [2400, 0.03, 0.16], mech: [3100, 0.045, 0.12], sat: 2.4 },
  shotgun: { len: 1.1, crack: 0.9, body: [700, 0.06, 1.0], thump: [105, 38, 0.13, 1.2], tail: [800, 0.3, 0.55], ring: [1900, 0.04, 0.1], sat: 2.8 },
  sniper: { len: 1.6, crack: 1.3, body: [900, 0.045, 1.0], thump: [95, 34, 0.17, 1.2], tail: [700, 0.45, 0.6], ring: [2100, 0.05, 0.18], echo: true, sat: 3.0 },
};
function gunShot(D, p) {
  const x = D.arr(p.len), j = () => D.r(0.92, 1.08);
  D.add(x, D.burst(0.008, { a: 0.0002, d: 0.0012, type: 'hp', f: 2600 }), 0, p.crack);
  D.add(x, D.burst(0.003, { a: 0.0001, d: 0.0006 }), 0, p.crack * 0.6);
  D.add(x, D.burst(p.body[1] * 6, { a: 0.0006, d: p.body[1], type: 'bp', f: p.body[0] * j(), q: 0.9 }), 0, p.body[2] * 1.6);
  D.add(x, D.thud(p.thump[2] * 5, p.thump[0] * j(), p.thump[1], p.thump[2]), 0, p.thump[3]);
  D.add(x, D.burst(p.len, { a: 0.006, d: p.tail[1], type: 'lp', f: (t) => p.tail[0] * Math.exp(-t * 2.5) + 180 }), 0.003, p.tail[2]);
  if (p.ring) D.add(x, D.modes(p.ring[1] * 6, [p.ring[0] * j(), p.ring[0] * 1.53, p.ring[0] * 2.31], p.ring[1]), 0.002, p.ring[2]);
  if (p.mech) D.add(x, D.click(p.mech[0] * j(), 0.006), p.mech[1], p.mech[2]);
  if (p.echo) {                                                     // эхо от рельефа
    D.add(x, D.burst(0.6, { a: 0.02, d: 0.12, type: 'lp', f: 700 }), 0.21, 0.22);
    D.add(x, D.burst(0.6, { a: 0.03, d: 0.15, type: 'lp', f: 500 }), 0.48, 0.12);
  }
  return D.sat(x, p.sat);
}

// ---------- Все звуки ----------
// Каждая функция возвращает Float32Array (моно); D уже засеян именем и номером варианта.
const SFX = {
  ...Object.fromEntries(Object.entries(GUN).map(([k, p]) => [k, (D) => gunShot(D, p)])),

  bazooka: (D) => {
    const x = D.arr(1.3);
    D.add(x, D.thud(0.3, 140, 45, 0.07), 0, 1);
    D.add(x, D.burst(0.05, { d: 0.008, type: 'hp', f: 1500 }), 0, 0.7);
    D.add(x, D.burst(1.2, { a: 0.03, d: 0.35, type: 'bp', f: (t) => 500 + 2600 * Math.min(1, t * 2), q: 1.1 }), 0, 0.9);
    D.add(x, D.burst(1.2, { a: 0.01, d: 0.25, type: 'lp', f: 900 }), 0, 0.5);
    return D.sat(x, 1.8);
  },
  boom: (D) => {
    const x = D.arr(2.6);
    D.add(x, D.thud(1.4, 95, 26, 0.38), 0, 1.2);
    D.add(x, D.burst(2.4, { a: 0.003, d: 0.45, type: 'lp', f: (t) => 4200 * Math.exp(-t * 3.2) + 140 }), 0, 1.1);
    for (let i = 0; i < 45; i++) { const t = D.r(0, 0.9) ** 1.5; D.add(x, D.burst(0.015, { d: 0.003, type: 'hp', f: D.r(1200, 3500) }), t, D.r(0.1, 0.5) * Math.exp(-t * 3)); }
    D.add(x, D.burst(1.6, { a: 0.1, d: 0.5, type: 'lp', f: 350 }), 0.25, 0.4);       // рокот
    return D.sat(x, 2.6);
  },
  whiz: (D) => {
    const x = D.arr(0.32);
    D.add(x, D.burst(0.32, { a: 0.11, d: 0.05, type: 'bp', f: (t) => 3600 - 6000 * t, q: 2.2 }), 0, 1);
    D.add(x, D.tone(0.32, 1300, 520, { a: 0.1, d: 0.06, gt: 0.12 }), 0, 0.25);
    return x;
  },
  dry: (D) => D.add(D.arr(0.08), D.click(4300, 0.004), 0, 1),

  // механика перезарядки
  magRelease: (D) => D.add(D.add(D.arr(0.12), D.click(2700, 0.007)), D.scrape(0.06, 2200), 0.01, 0.4),
  magOut: (D) => D.add(D.add(D.arr(0.25), D.scrape(0.14, 1700), 0, 0.9), D.click(1900, 0.01), 0.11, 0.7),
  magIn: (D) => { const x = D.arr(0.25); D.add(x, D.scrape(0.07, 1500), 0, 0.6); D.add(x, D.click(2300, 0.012), 0.065, 1); D.add(x, D.thud(0.1, 240, 140, 0.02), 0.065, 0.8); D.add(x, D.click(3400, 0.006), 0.09, 0.4); return D.sat(x, 1.4); },
  chargeBack: (D) => D.add(D.add(D.arr(0.15), D.scrape(0.08, 2500), 0, 0.8), D.click(3100, 0.008), 0.07, 0.8),
  chargeFwd: (D) => { const x = D.arr(0.18); D.add(x, D.click(2600, 0.012), 0, 1); D.add(x, D.thud(0.08, 320, 180, 0.015), 0, 0.7); D.add(x, D.click(4300, 0.006), 0.014, 0.5); return D.sat(x, 1.5); },
  slideBack: (D) => D.add(D.add(D.arr(0.12), D.scrape(0.06, 3000), 0, 0.7), D.click(3500, 0.006), 0.05, 0.8),
  slideFwd: (D) => D.add(D.add(D.arr(0.12), D.click(3000, 0.01), 0, 1), D.thud(0.06, 380, 220, 0.01), 0, 0.5),
  boltUp: (D) => D.add(D.add(D.arr(0.12), D.click(3500, 0.007), 0, 0.9), D.scrape(0.04, 2600), 0.01, 0.4),
  boltBack: (D) => D.add(D.add(D.arr(0.2), D.scrape(0.11, 2000), 0, 0.9), D.click(2700, 0.01), 0.1, 0.8),
  boltFwd: (D) => { const x = D.arr(0.2); D.add(x, D.scrape(0.08, 2300), 0, 0.7); D.add(x, D.click(2500, 0.012), 0.075, 1); D.add(x, D.thud(0.06, 300, 200, 0.012), 0.075, 0.5); return x; },
  boltDown: (D) => D.add(D.add(D.arr(0.12), D.click(3900, 0.008), 0, 1), D.thud(0.05, 420, 260, 0.01), 0, 0.5),
  shellIn: (D) => { const x = D.arr(0.18); D.add(x, D.scrape(0.06, 1300), 0, 0.6); D.add(x, D.thud(0.06, 520, 320, 0.012), 0.045, 0.8); D.add(x, D.click(1900, 0.008), 0.05, 0.7); return x; },
  pumpBack: (D) => { const x = D.arr(0.2); D.add(x, D.scrape(0.09, 1300), 0, 0.8); D.add(x, D.click(1800, 0.014), 0.08, 1); D.add(x, D.thud(0.06, 270, 170, 0.015), 0.08, 0.7); return D.sat(x, 1.4); },
  pumpFwd: (D) => { const x = D.arr(0.2); D.add(x, D.scrape(0.06, 1500), 0, 0.6); D.add(x, D.click(2200, 0.014), 0.055, 1); D.add(x, D.thud(0.07, 300, 180, 0.018), 0.055, 0.8); return D.sat(x, 1.5); },
  rocketSlide: (D) => D.add(D.arr(0.35), D.scrape(0.3, 900, 1.4), 0, 1),
  rocketLock: (D) => { const x = D.arr(0.3); D.add(x, D.click(1500, 0.02), 0, 1); D.add(x, D.thud(0.15, 170, 90, 0.04), 0, 0.9); return x; },
  // гильза звенит по земле; гильза дробовика (пластик) — глуше
  casing: (D) => {
    const x = D.arr(0.4), f = D.r(4600, 6200);
    [[0, 1], [D.r(0.07, 0.1), 0.6], [D.r(0.13, 0.17), 0.35], [D.r(0.19, 0.22), 0.2], [D.r(0.24, 0.26), 0.1]].forEach(([t, g]) => D.add(x, D.modes(0.12, [f, f * 1.41, f * 1.9], 0.022), t, g));
    return x;
  },
  shellDrop: (D) => {
    const x = D.arr(0.35);
    [[0, 1], [0.1, 0.5], [0.17, 0.25]].forEach(([t, g]) => { D.add(x, D.thud(0.04, 720, 420, 0.008), t, g); D.add(x, D.click(1500, 0.006), t, g * 0.4); });
    return x;
  },
  equip: (D) => { const x = D.arr(0.3); D.add(x, D.cloth(0.18), 0, 0.6); D.add(x, D.click(2200, 0.012), 0.12, 0.9); D.add(x, D.click(3300, 0.006), 0.17, 0.5); return x; },
  equipPick: (D) => { const x = D.arr(0.3); D.add(x, D.cloth(0.2, 900), 0, 0.7); D.add(x, D.thud(0.08, 260, 160, 0.02), 0.14, 0.6); return x; },
  equipMed: (D) => { const x = D.arr(0.3); D.add(x, D.cloth(0.18, 1300), 0, 0.6); D.add(x, D.thud(0.05, 620, 400, 0.01), 0.13, 0.7); D.add(x, D.thud(0.05, 560, 380, 0.01), 0.17, 0.4); return x; },
  adsIn: (D) => D.add(D.add(D.arr(0.16), D.cloth(0.11, 1500), 0, 0.8), D.click(2900, 0.005), 0.075, 0.35),
  adsOut: (D) => D.add(D.arr(0.14), D.cloth(0.1, 1200), 0, 0.7),

  // шаги: по поверхностям
  step_grass: (D) => {
    const x = D.arr(0.22);
    D.add(x, D.thud(0.08, 110, 70, 0.02), 0, 0.5);
    D.add(x, D.burst(0.15, { a: 0.004, d: 0.035, type: 'lp', f: 2400 }), 0, 0.45);
    for (let i = 0; i < 9; i++) D.add(x, D.burst(0.012, { d: 0.003, type: 'bp', f: D.r(2200, 5200), q: 1.4 }), D.r(0, 0.06), D.r(0.2, 0.6));
    return x;
  },
  step_dirt: (D) => {
    const x = D.arr(0.2);
    D.add(x, D.thud(0.08, 120, 75, 0.022), 0, 0.7);
    D.add(x, D.burst(0.14, { a: 0.003, d: 0.03, type: 'lp', f: 1500 }), 0, 0.6);
    for (let i = 0; i < 5; i++) D.add(x, D.burst(0.01, { d: 0.003, type: 'bp', f: D.r(1500, 3000), q: 1.2 }), D.r(0, 0.04), D.r(0.2, 0.4));
    return x;
  },
  step_sand: (D) => { const x = D.arr(0.25); D.add(x, D.burst(0.2, { a: 0.012, d: 0.05, type: 'bp', f: D.r(2800, 3800), q: 0.6, gr: 2, gd: 0.6 }), 0, 0.8); D.add(x, D.thud(0.07, 100, 70, 0.02), 0, 0.35); return x; },
  step_wood: (D) => { const x = D.arr(0.25); D.add(x, D.thud(0.12, 170, 105, 0.03), 0, 0.8); D.add(x, D.modes(0.2, [D.r(190, 230), 330, 540], 0.045), 0, 0.6); D.add(x, D.burst(0.02, { d: 0.004, type: 'hp', f: 1500 }), 0, 0.25); return x; },
  step_brick: (D) => { const x = D.arr(0.2); D.add(x, D.burst(0.02, { d: 0.004, type: 'hp', f: 1800 }), 0, 0.6); D.add(x, D.thud(0.07, 150, 95, 0.016), 0, 0.7); for (let i = 0; i < 4; i++) D.add(x, D.burst(0.008, { d: 0.002, type: 'hp', f: 3500 }), D.r(0.004, 0.03), 0.25); return x; },
  step_metal: (D) => { const x = D.arr(0.4); D.add(x, D.modes(0.4, [D.r(580, 660), 1050, 1730, 2600], 0.09), 0, 0.7); D.add(x, D.thud(0.08, 160, 100, 0.02), 0, 0.6); return x; },
  step_water: (D) => {
    const x = D.arr(0.4);
    D.add(x, D.burst(0.35, { a: 0.01, d: 0.08, type: 'bp', f: (t) => 1900 - 2400 * t, q: 0.8 }), 0, 0.9);
    for (let i = 0; i < 3; i++) { const f = D.r(380, 700); D.add(x, D.tone(0.05, f, f * 2, { d: 0.015, gt: 0.03 }), D.r(0.03, 0.15), 0.25); }
    return x;
  },
  jump: (D) => D.add(D.arr(0.25), D.cloth(0.16, 1400), 0, 1),
  gear: (D) => { const x = D.arr(0.15); for (let i = 0; i < 3; i++) D.add(x, D.click(D.r(2500, 4200), 0.004), D.r(0, 0.05), D.r(0.2, 0.4)); D.add(x, D.cloth(0.1, 1600), 0, 0.4); return x; },
  land: (D) => { const x = D.arr(0.35); D.add(x, D.thud(0.3, 95, 45, 0.07), 0, 1); D.add(x, D.burst(0.2, { a: 0.003, d: 0.05, type: 'lp', f: 1000 }), 0, 0.7); D.add(x, D.cloth(0.12, 1300), 0.01, 0.4); return D.sat(x, 1.5); },

  // парашют, ветер, вертолёт, шторм (петли)
  wind: (D) => {
    const x = D.arr(6.5);
    for (let i = 0; i < x.length; i++) x[i] = D.rnd();
    D.filt(x, 'lp', 900);
    const howl = D.filt(x.slice(), 'bp', (t) => 420 + 140 * Math.sin(t * 1.3) + 90 * Math.sin(t * 3.1), 4);
    for (let i = 0; i < x.length; i++) { const t = i / D.SR; x[i] = (x[i] + howl[i] * 1.5) * (0.65 + 0.25 * Math.sin(t * 1.1) + 0.1 * Math.sin(t * 2.7 + 1)); }
    return D.loopify(x, 0.5);
  },
  canopy: (D) => {
    const x = D.arr(4.5);
    for (let i = 0; i < x.length; i++) x[i] = D.rnd();
    D.filt(x, 'bp', 650, 0.7);
    let ph = 0, rate = 11;
    for (let i = 0; i < x.length; i++) {
      if ((i & 255) === 0) rate += (D.r(8, 15) - rate) * 0.1;
      ph += PI2 * rate / D.SR;
      x[i] *= 0.35 + 0.65 * Math.abs(Math.sin(ph)) ** 3;
    }
    return D.loopify(x, 0.4);
  },
  rotor: (D) => {
    const per = 1 / 5.5, x = D.arr(per * 11 + 0.3);
    for (let k = 0; k < 13; k++) { D.add(x, D.burst(0.18, { a: 0.01, d: 0.05, type: 'lp', f: 320 }), k * per, 1); D.add(x, D.thud(0.12, 85, 60, 0.04), k * per, 0.6); }
    D.add(x, D.gain(D.tone(x.length / D.SR, 1150, 1150, { d: 99, vib: 0.004 }), 0.06));
    D.add(x, D.burst(x.length / D.SR, { a: 0.001, d: 99, type: 'hp', f: 3000 }), 0, 0.12);
    return D.loopify(x, 0.3);
  },
  storm: (D) => {
    const x = D.arr(5.4);
    for (let i = 0; i < x.length; i++) x[i] = D.rnd();
    D.filt(x, 'lp', 220); D.filt(x, 'lp', 260);
    D.gain(x, 3);
    D.add(x, D.gain(D.tone(5.4, 55, 55, { d: 99, shape: 'saw', vib: 0.01 }), 0.08));
    for (let i = 0; i < 25; i++) D.add(x, D.burst(0.06, { d: 0.012, type: 'bp', f: D.r(2000, 5000), q: 2, gr: 1, gd: 0.9 }), D.r(0, 5), D.r(0.05, 0.25));
    return D.loopify(x, 0.4);
  },
  chuteOpen: (D) => {
    const x = D.arr(0.9);
    D.add(x, D.burst(0.8, { a: 0.08, d: 0.12, type: 'bp', f: (t) => 300 + 1600 * Math.exp(-t * 6), q: 0.7 }), 0, 1);
    D.add(x, D.thud(0.4, 120, 50, 0.08), 0.1, 0.9);
    D.add(x, D.burst(0.05, { d: 0.01, type: 'bp', f: 900, q: 1 }), 0.1, 0.6);
    return D.sat(x, 1.6);
  },
  jumpOut: (D) => D.add(D.arr(0.9), D.burst(0.8, { a: 0.25, d: 0.2, type: 'bp', f: (t) => 400 + 1400 * t, q: 0.8 }), 0, 1),

  // аптечка
  medOpen: (D) => {
    const x = D.arr(0.55);
    D.add(x, D.click(1900, 0.01), 0, 0.8); D.add(x, D.click(2100, 0.01), 0.06, 0.7);
    let t = 0.12;
    for (let i = 0; i < 26; i++) { D.add(x, D.burst(0.008, { d: 0.0025, type: 'bp', f: 2600, q: 1.5 }), t, 0.5); t += 0.016 - i * 0.0003; }   // молния
    return x;
  },
  bandage: (D) => D.add(D.arr(0.35), D.burst(0.3, { a: 0.05, d: 0.08, type: 'bp', f: D.r(1600, 2300), q: 0.9, gr: 2.5, gd: 0.85 }), 0, 1),
  spray: (D) => D.add(D.arr(0.7), D.burst(0.65, { a: 0.03, d: 0.25, type: 'hp', f: 3800 }), 0, 1),
  medTape: (D) => D.add(D.arr(0.25), D.burst(0.18, { a: 0.02, d: 0.05, type: 'bp', f: (t) => 1500 + 14000 * t, q: 1.2, gr: 1.5, gd: 0.9 }), 0, 1),
  healDone: (D) => { const x = D.arr(1.4); D.bells(x, [784, 988, 1175, 1568], 0.065, 0.35, 0.8); D.add(x, D.burst(1, { a: 0.05, d: 0.3, type: 'hp', f: 6000 }), 0.1, 0.15); return x; },

  // подбор лута
  pickAmmo: (D) => { const x = D.arr(0.25); for (let i = 0; i < 6; i++) D.add(x, D.modes(0.06, [D.r(3800, 5600), 7200], 0.012), D.r(0, 0.11), D.r(0.3, 0.7)); D.add(x, D.cloth(0.12, 1500), 0, 0.4); return x; },
  pickWeapon: (D) => { const x = D.arr(0.35); D.add(x, D.cloth(0.15, 1000), 0, 0.6); D.add(x, D.click(1800, 0.016), 0.08, 1); D.add(x, D.thud(0.07, 230, 150, 0.02), 0.08, 0.7); D.add(x, D.click(3200, 0.008), 0.16, 0.6); return D.sat(x, 1.3); },
  pickArmor: (D) => {
    const x = D.arr(0.9);
    const s = D.tone(0.5, 300, 1300, { a: 0.03, d: 0.18, gt: 0.2 });
    for (let i = 0; i < s.length; i++) s[i] *= 0.6 + 0.4 * Math.sin(PI2 * 32 * i / D.SR);
    D.add(x, s, 0, 0.6);
    D.bells(x, [1319, 1976], 0.06, 0.25, 0.6, 0.2);
    D.add(x, D.burst(0.5, { a: 0.05, d: 0.15, type: 'hp', f: 5000 }), 0.1, 0.2);
    return x;
  },
  pickMed: (D) => { const x = D.arr(0.3); D.add(x, D.thud(0.06, 480, 280, 0.012), 0, 0.8); D.add(x, D.thud(0.06, 420, 260, 0.012), 0.06, 0.5); D.add(x, D.burst(0.1, { a: 0.01, d: 0.03, type: 'bp', f: 2500, q: 1.5, gr: 1.2, gd: 0.9 }), 0.1, 0.4); return x; },
  chest: (D) => {
    const x = D.arr(1.6);
    const cr = D.arr(0.45);                                         // скрип петель: прерывистое трение
    let ph = 0;
    for (let i = 0; i < cr.length; i++) { const t = i / D.SR; ph += PI2 * (170 + 70 * Math.sin(t * 9)) / D.SR; cr[i] = ((ph / PI2) % 1 * 2 - 1) * D.env(t, 0.06, 0.2); }
    D.grain(cr, 7, 0.9); D.filt(cr, 'bp', 1100, 2);
    D.add(x, cr, 0, 0.8);
    D.add(x, D.thud(0.2, 140, 80, 0.05), 0.4, 0.8);
    D.bells(x, [1047, 1319, 1568, 2093], 0.07, 0.3, 0.55, 0.42);
    D.add(x, D.burst(0.8, { a: 0.1, d: 0.2, type: 'hp', f: 6500 }), 0.4, 0.2);
    return x;
  },

  // попадания, убийство, урон
  hit: (D) => { const x = D.arr(0.15); D.add(x, D.modes(0.05, [3900, 5300], 0.008), 0, 0.9); D.add(x, D.burst(0.06, { a: 0.001, d: 0.015, type: 'lp', f: 1000 }), 0, 0.7); D.add(x, D.thud(0.06, 190, 95, 0.015), 0, 0.5); return x; },
  hitShield: (D) => { const x = D.arr(0.35); D.add(x, D.modes(0.3, [2650, 3970, 5300], 0.07), 0, 1); D.add(x, D.modes(0.05, [4400], 0.008), 0, 0.4); return x; },
  hitBig: (D) => { const x = D.arr(0.3); D.add(x, D.modes(0.08, [3200, 4700], 0.015), 0, 0.8); D.add(x, D.thud(0.2, 160, 60, 0.05), 0, 1); D.add(x, D.burst(0.1, { d: 0.025, type: 'lp', f: 1400 }), 0, 0.7); return D.sat(x, 1.5); },
  // хедшот: звонкий «дзынь» поверх удара — сразу слышно, что попал в голову
  hitHead: (D) => { const x = D.arr(0.5); D.add(x, D.modes(0.45, [2637, 3951, 5274], 0.12), 0, 1); D.add(x, D.tone(0.35, 3520, 3520, { d: 0.1 }), 0, 0.35); D.add(x, D.thud(0.12, 200, 90, 0.025), 0, 0.6); D.add(x, D.burst(0.05, { d: 0.01, type: 'hp', f: 3000 }), 0, 0.5); return D.sat(x, 1.3); },
  // серия убийств: быстрый восходящий арпеджио-аккорд с «искрами»
  streak: (D) => {
    const x = D.arr(1.6);
    [[784, 0], [988, 0.07], [1175, 0.14], [1568, 0.21]].forEach(([f, t]) => { const h = D.add(D.tone(1, f, f, { a: 0.004, d: 0.35, shape: 'saw' }), D.tone(1, f * 1.005, f * 1.005, { a: 0.004, d: 0.35, shape: 'sq' }), 0, 0.5); D.filt(h, 'lp', 4200); D.add(x, h, t, 0.32); });
    D.add(x, D.thud(0.5, 180, 60, 0.12), 0, 0.7);
    D.bells(x, [3136, 3951, 4699], 0.05, 0.3, 0.25, 0.25);
    D.add(x, D.burst(1, { a: 0.02, d: 0.3, type: 'hp', f: 7000 }), 0.2, 0.2);
    return D.sat(x, 1.3);
  },
  // монетки PR рассыпаются (убийство)
  coins: (D) => { const x = D.arr(1.1); for (let i = 0; i < 12; i++) { const t = D.r(0, 0.7) ** 1.4, f = D.r(3200, 5200); D.add(x, D.modes(0.3, [f, f * 1.48, f * 2.3], D.r(0.04, 0.09)), t, D.r(0.2, 0.55) * (1 - t * 0.8)); } return x; },
  kill: (D) => {
    const x = D.arr(1.2);
    D.add(x, D.thud(0.4, 130, 48, 0.1), 0, 1);
    D.add(x, D.burst(0.12, { a: 0.08, d: 0.01, type: 'bp', f: 2200, q: 0.8 }), 0, 0.35);
    D.bells(x, [1568, 2349], 0.075, 0.35, 0.9, 0.02);
    return D.sat(x, 1.4);
  },
  hurt: (D) => { const x = D.arr(0.35); D.add(x, D.thud(0.25, 105, 42, 0.06), 0, 1); D.add(x, D.burst(0.12, { d: 0.035, type: 'lp', f: 750 }), 0, 0.8); D.add(x, D.burst(0.04, { d: 0.01, type: 'bp', f: 1300, q: 1 }), 0, 0.4); return D.sat(x, 1.8); },
  shieldHurt: (D) => { const x = D.arr(0.35); D.add(x, D.burst(0.2, { a: 0.002, d: 0.06, type: 'bp', f: 3000, q: 1.4, gr: 1, gd: 0.9 }), 0, 0.8); D.add(x, D.modes(0.3, [2200, 3300], 0.06), 0, 0.6); D.add(x, D.thud(0.1, 140, 70, 0.03), 0, 0.5); return x; },
  shieldBreak: (D) => {
    const x = D.arr(0.9);
    D.add(x, D.burst(0.3, { d: 0.07, type: 'hp', f: 2500 }), 0, 0.7);
    D.add(x, D.thud(0.3, 150, 50, 0.08), 0, 0.8);
    for (let i = 0; i < 22; i++) { const t = D.r(0, 0.3) ** 1.3; const f = D.r(2500, 7000); D.add(x, D.modes(0.25, [f, f * 1.37], D.r(0.03, 0.08)), t, D.r(0.15, 0.5) * (1 - t)); }
    return x;
  },
  stormZap: (D) => { const x = D.arr(0.3); const b = D.tone(0.25, 120, 110, { a: 0.005, d: 0.08, shape: 'saw' }); D.grain(b, 4, 0.9); D.filt(b, 'lp', 2200); D.add(x, b, 0, 1); D.add(x, D.burst(0.15, { d: 0.04, type: 'bp', f: 3500, q: 2, gr: 1, gd: 0.9 }), 0, 0.5); return x; },
  heart: (D) => { const x = D.arr(0.45); D.add(x, D.thud(0.15, 65, 42, 0.04), 0, 1); D.add(x, D.thud(0.15, 58, 40, 0.045), 0.17, 0.7); return x; },
  death: (D) => { const x = D.arr(1.6); const t = D.tone(1.5, 260, 50, { d: 0.5, gt: 0.5, shape: 'saw' }); D.filt(t, 'lp', 900); D.add(x, t, 0, 0.6); D.add(x, D.thud(0.8, 90, 30, 0.25), 0, 1); return D.sat(x, 1.5); },

  // интерфейс и раунд
  uiClick: (D) => { const x = D.arr(0.12); D.add(x, D.tone(0.1, 1250, 850, { d: 0.03, gt: 0.02 }), 0, 0.6); D.add(x, D.click(3500, 0.003), 0, 0.3); return x; },
  uiHover: (D) => D.add(D.arr(0.05), D.modes(0.04, [2400, 3600], 0.006), 0, 1),
  beep: (D) => D.add(D.arr(0.25), D.tone(0.22, 880, 880, { a: 0.003, d: 0.07 }), 0, 1),
  beepGo: (D) => { const x = D.arr(0.6); D.add(x, D.tone(0.55, 1320, 1320, { a: 0.003, d: 0.2 }), 0, 0.8); D.add(x, D.tone(0.55, 660, 660, { a: 0.003, d: 0.2 }), 0, 0.4); return x; },
  roundStart: (D) => {
    const x = D.arr(1.6);
    for (const [f, g] of [[220, 0.6], [330, 0.45], [440, 0.3]]) { const h = D.tone(1.4, f * 0.98, f, { a: 0.06, d: 0.5, gt: 0.08, shape: 'saw' }); D.filt(h, 'lp', 1400); D.add(x, h, 0, g); }
    D.add(x, D.burst(1, { a: 0.4, d: 0.2, type: 'bp', f: (t) => 500 + 2500 * t, q: 0.8 }), 0, 0.3);
    return D.sat(x, 1.3);
  },
  victory: (D) => {
    const x = D.arr(3.2);
    const brass = (f, t0, len, g) => { const h = D.add(D.tone(len + 0.5, f, f, { a: 0.03, d: len * 0.9, shape: 'saw', vib: 0.004 }), D.tone(len + 0.5, f * 1.004, f * 1.004, { a: 0.03, d: len * 0.9, shape: 'saw' }), 0, 0.7); D.filt(h, 'lp', 2400); D.add(x, h, t0, g); };
    [[523, 0, 0.14], [659, 0.15, 0.14], [784, 0.3, 0.14], [1047, 0.45, 1.6]].forEach(([f, t, l]) => brass(f, t, l, 0.5));
    [262, 330, 392].forEach((f) => brass(f, 0.45, 1.6, 0.3));
    D.add(x, D.burst(2, { a: 0.005, d: 0.6, type: 'hp', f: 6000 }), 0.45, 0.25);
    D.bells(x, [2093, 2637, 3136], 0.08, 0.4, 0.3, 0.5);
    return D.sat(x, 1.2);
  },
  lose: (D) => { const x = D.arr(1.8); [[523, 0], [440, 0.22], [349, 0.44]].forEach(([f, t]) => D.add(x, D.tone(1.2, f, f, { a: 0.01, d: t === 0.44 ? 0.5 : 0.2, shape: 'tri', vib: 0.006 }), t, 0.6)); return x; },
  caseTick: (D) => D.add(D.arr(0.05), D.click(2800, 0.004), 0, 1),

  // кирка, стройка, попадания по миру
  swing: (D) => D.add(D.arr(0.3), D.burst(0.28, { a: 0.08, d: 0.06, type: 'bp', f: (t) => 600 + 7000 * t, q: 1.1 }), 0, 1),
  chop: (D) => { const x = D.arr(0.3); D.add(x, D.thud(0.12, 230, 130, 0.03), 0, 0.9); D.add(x, D.modes(0.25, [340, 590, 910], 0.05), 0, 0.7); D.add(x, D.burst(0.05, { d: 0.012, type: 'bp', f: 1600, q: 1 }), 0, 0.6); return D.sat(x, 1.4); },
  build_wood: (D) => { const x = D.arr(0.4); D.add(x, D.thud(0.2, 160, 90, 0.05), 0, 1); D.add(x, D.modes(0.35, [210, 340, 570], 0.07), 0, 0.7); D.add(x, D.burst(0.04, { d: 0.01, type: 'bp', f: 1300 }), 0, 0.4); return D.sat(x, 1.3); },
  build_brick: (D) => { const x = D.arr(0.4); D.add(x, D.thud(0.2, 130, 70, 0.05), 0, 1); D.add(x, D.burst(0.25, { a: 0.002, d: 0.06, type: 'lp', f: 1600, gr: 3, gd: 0.6 }), 0, 0.7); return D.sat(x, 1.3); },
  build_metal: (D) => { const x = D.arr(0.8); D.add(x, D.modes(0.8, [420, 690, 1130, 1810], 0.22), 0, 0.8); D.add(x, D.thud(0.15, 150, 90, 0.04), 0, 0.8); return D.sat(x, 1.2); },
  break_wood: (D) => { const x = D.arr(1); for (let i = 0; i < 14; i++) { const t = D.r(0, 0.4); D.add(x, D.thud(0.1, D.r(180, 320), 110, 0.025), t, D.r(0.2, 0.6)); D.add(x, D.modes(0.15, [D.r(300, 600), 900], 0.03), t, 0.3); } D.add(x, D.burst(0.6, { d: 0.15, type: 'lp', f: 1200 }), 0, 0.5); return D.sat(x, 1.5); },
  break_brick: (D) => { const x = D.arr(1); for (let i = 0; i < 18; i++) D.add(x, D.burst(0.05, { d: 0.012, type: 'bp', f: D.r(600, 2500), q: 1 }), D.r(0, 0.5), D.r(0.2, 0.6)); D.add(x, D.thud(0.4, 110, 45, 0.1), 0, 0.9); D.add(x, D.burst(0.8, { d: 0.2, type: 'lp', f: 900 }), 0, 0.6); return D.sat(x, 1.6); },
  break_metal: (D) => { const x = D.arr(1.2); for (let i = 0; i < 8; i++) D.add(x, D.modes(0.5, [D.r(400, 1500), D.r(1600, 3000)], 0.12), D.r(0, 0.35), D.r(0.2, 0.5)); D.add(x, D.thud(0.3, 140, 60, 0.08), 0, 0.8); return D.sat(x, 1.4); },
  impact_dirt: (D) => { const x = D.arr(0.15); D.add(x, D.burst(0.1, { d: 0.02, type: 'lp', f: 1700 }), 0, 1); D.add(x, D.thud(0.05, 150, 90, 0.012), 0, 0.5); return x; },
  impact_wood: (D) => { const x = D.arr(0.2); D.add(x, D.thud(0.08, 300, 180, 0.02), 0, 0.8); D.add(x, D.modes(0.12, [D.r(450, 600), 950], 0.025), 0, 0.6); D.add(x, D.burst(0.02, { d: 0.004, type: 'hp', f: 2000 }), 0, 0.5); return x; },
  impact_brick: (D) => { const x = D.arr(0.15); D.add(x, D.burst(0.03, { d: 0.006, type: 'hp', f: 1600 }), 0, 1); D.add(x, D.burst(0.1, { d: 0.02, type: 'bp', f: 1100, gr: 2, gd: 0.6 }), 0, 0.5); return x; },
  impact_metal: (D) => {
    const x = D.arr(0.6);
    D.add(x, D.modes(0.4, [D.r(1700, 2100), 2900, 4300], 0.08), 0, 0.9);
    if (D.r01() < 0.5) D.add(x, D.tone(0.45, D.r(3200, 4200), 1500, { a: 0.01, d: 0.15, gt: 0.25 }), 0.01, 0.2);    // рикошет
    return x;
  },
  dash: (D) => D.add(D.arr(0.45), D.burst(0.4, { a: 0.05, d: 0.12, type: 'bp', f: (t) => 400 + 4000 * t, q: 0.9 }), 0, 1),
  launch: (D) => { const x = D.arr(0.6); D.add(x, D.tone(0.5, 180, 620, { a: 0.005, d: 0.2, gt: 0.15 }), 0, 0.6); D.add(x, D.burst(0.5, { a: 0.03, d: 0.15, type: 'bp', f: (t) => 500 + 3000 * t, q: 0.9 }), 0, 0.8); return x; },
};
// почти одинаковые
SFX.impact_rock = SFX.impact_brick;
SFX.step_rock = SFX.step_brick;

// Громкость и вариантов на звук (остальные: 1.0 и 1 вариант).
const GAIN = {
  pistol: 0.6, smg: 0.5, ar: 0.64, shotgun: 0.76, sniper: 0.8, bazooka: 0.64, boom: 0.8, whiz: 0.5, dry: 0.63,
  magRelease: 0.54, magOut: 0.72, magIn: 0.9, chargeBack: 0.76, chargeFwd: 0.9, slideBack: 0.76, slideFwd: 0.9, boltUp: 0.72, boltBack: 0.76, boltFwd: 0.9, boltDown: 0.81,
  shellIn: 0.76, pumpBack: 0.99, pumpFwd: 1, rocketSlide: 0.72, rocketLock: 0.9, casing: 0.25, shellDrop: 0.36,
  equip: 0.63, equipPick: 0.63, equipMed: 0.63, adsIn: 0.4, adsOut: 0.29,
  step_grass: 0.35, step_dirt: 0.38, step_sand: 0.32, step_wood: 0.48, step_brick: 0.42, step_rock: 0.42, step_metal: 0.35, step_water: 0.48, gear: 0.16, jump: 0.32, land: 0.45,
  wind: 0.6, canopy: 0.35, rotor: 0.7, storm: 0.6, chuteOpen: 0.7, jumpOut: 0.5,
  medOpen: 0.8, bandage: 0.6, spray: 0.44, medTape: 0.6, healDone: 0.8,
  pickAmmo: 0.52, pickWeapon: 0.59, pickArmor: 0.52, pickMed: 0.52, chest: 0.6,
  hit: 0.5, hitShield: 0.42, hitBig: 0.6, hitHead: 0.55, streak: 0.55, coins: 0.32, kill: 0.7, hurt: 0.6, shieldHurt: 0.5, shieldBreak: 0.6, stormZap: 0.3, heart: 0.6, death: 0.6,
  uiClick: 0.25, uiHover: 0.08, beep: 0.35, beepGo: 0.4, roundStart: 0.45, victory: 0.55, lose: 0.4, caseTick: 0.25,
  swing: 0.3, chop: 0.55, build_wood: 0.45, build_brick: 0.45, build_metal: 0.4, break_wood: 0.6, break_brick: 0.6, break_metal: 0.55,
  impact_dirt: 0.25, impact_wood: 0.3, impact_brick: 0.3, impact_rock: 0.3, impact_metal: 0.28, dash: 0.4, launch: 0.5,
};
const VARIANTS = { pistol: 3, smg: 4, ar: 4, shotgun: 2, sniper: 2, casing: 4, step_grass: 5, step_dirt: 4, step_sand: 4, step_wood: 4, step_brick: 4, step_rock: 4, step_metal: 3, step_water: 3, gear: 3, hit: 2, impact_metal: 3, impact_wood: 2, bandage: 3 };
// Слышимость на расстоянии: [опорная дистанция (м), предел (м), доля в ревербератор]
const SPACE = {
  pistol: [10, 170, 0.18], smg: [10, 170, 0.18], ar: [12, 230, 0.2], shotgun: [12, 180, 0.22], sniper: [16, 360, 0.25], bazooka: [12, 200, 0.2], boom: [18, 320, 0.3],
  default: [4, 45, 0.1],
};
const GUNS = new Set(['pistol', 'smg', 'ar', 'shotgun', 'sniper', 'bazooka', 'boom']);

// Фазы перезарядки (доля от всего времени) — совпадают с анимацией рук в viewmodel.js.
const RELOAD = {
  mag: [[0.03, 'adsIn'], [0.14, 'magRelease'], [0.2, 'magOut'], [0.6, 'magIn'], [0.75, 'chargeBack'], [0.83, 'chargeFwd']],
  pistol: [[0.03, 'adsIn'], [0.14, 'magRelease'], [0.2, 'magOut'], [0.6, 'magIn'], [0.76, 'slideBack'], [0.82, 'slideFwd']],
  sniper: [[0.05, 'boltUp'], [0.1, 'boltBack'], [0.2, 'magOut'], [0.6, 'magIn'], [0.75, 'boltFwd'], [0.82, 'boltDown']],
  shotgun: [[0.04, 'adsIn'], [0.2, 'shellIn'], [0.375, 'shellIn'], [0.55, 'shellIn'], [0.725, 'shellIn'], [0.88, 'pumpBack'], [0.95, 'pumpFwd']],
  bazooka: [[0.08, 'adsIn'], [0.56, 'rocketSlide'], [0.78, 'rocketLock']],
};
const HEAL = [[0, 'medOpen'], [0.18, 'bandage'], [0.36, 'bandage'], [0.52, 'spray'], [0.7, 'bandage'], [0.86, 'medTape']];

// ---------- Музыка лобби ----------
// 100 BPM, ля минор: вступление (пэд + арпеджио под фильтром) → основная часть (бочка «на четыре», бас с
// «накачкой», хлопки, хэты) → припев с мелодией. Считается своим DSP (только звучащие ноты; эхо и реверб —
// линии задержки), всё пишется по модулю длины — петля без шва. Между тактами отдаём управление (без фриза).
// Уступить кадр (MessageChannel: в фоновой вкладке не тормозится, как setTimeout).
const yieldNow = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
async function musicData(SR) {
  const BPM = 100, beat = 60 / BPM, bar = beat * 4, BARS = 16, N = Math.round(bar * BARS * SR);
  const D = makeDsp(SR);
  D.seed(77);
  const bus = () => [new Float32Array(N), new Float32Array(N)];
  const dry = bus(), duck = bus(), arp = new Float32Array(N), rev = new Float32Array(N);
  const put = (b, x, t, g, pan = 0, send = 0) => {
    const o = Math.round(t * SR), gl = g * Math.cos((pan + 1) * Math.PI / 4), gr = g * Math.sin((pan + 1) * Math.PI / 4);
    for (let i = 0; i < x.length; i++) {
      const j = (o + i) % N, v = x[i];
      if (b) { b[0][j] += v * gl; b[1][j] += v * gr; }
      if (send) rev[j] += v * g * send;
    }
  };
  // нота синтезатора: несколько расстроенных генераторов → фильтр с огибающей → громкость
  const voice = (m, len, o) => {
    const rel = o.r ?? 0.05, x = D.arr(len + rel * 4), dets = o.det || [0], a = o.a ?? 0.005, sus = o.s ?? 1, vib = o.vib || 0, ty = o.type;
    const n = x.length, nl = Math.round(len * SR), na = Math.max(1, Math.round(a * SR));
    for (const det of dets) {
      const inc = mtof(m) * 2 ** (det / 1200) / SR, w = 1 / dets.length;
      let ph = D.r01();
      for (let i = 0; i < n; i++) {
        ph += vib ? inc * (1 + vib * Math.sin(PI2 * 5.2 * i / SR) * Math.min(1, i / SR * 3)) : inc;
        if (ph >= 1) ph -= 1;
        x[i] += (ty === 'saw' ? 2 * ph - 1 : ty === 'sq' ? (ph < 0.5 ? 1 : -1) : ty === 'tri' ? 1 - 4 * Math.abs(ph - 0.5) : Math.sin(PI2 * ph)) * w;
      }
    }
    if (o.f0) D.filt(x, 'lp', o.f0 === o.f1 ? o.f0 : (t) => o.f1 + (o.f0 - o.f1) * Math.exp(-t / (o.ft ?? 0.08)), o.q ?? 0.9);
    // огибающая: атака, спад к sus (множитель на сэмпл), затухание после отпускания
    const kd = o.d ? Math.exp(-1 / (o.d * SR)) : 1, kr = Math.exp(-1 / (rel * SR));
    let dec = 1, env = 0;
    for (let i = 0; i < n; i++) {
      if (i < na) env = i / na;
      else if (i < nl) { dec *= kd; env = o.d ? sus + (1 - sus) * dec : 1; }
      else env *= kr;
      x[i] *= env * o.g;
    }
    return x;
  };
  const kick = (t) => { put(dry, D.thud(0.45, 160, 44, 0.12), t, 1.0); put(dry, D.burst(0.02, { d: 0.003, type: 'hp', f: 3000 }), t, 0.2); };
  const clap = (t) => {
    const x = D.arr(0.4);
    for (const k of [0, 0.011, 0.022]) D.add(x, D.burst(0.05, { d: 0.005, type: 'bp', f: 1600, q: 1.1 }), k, 0.6);
    D.add(x, D.burst(0.35, { a: 0.001, d: 0.06, type: 'bp', f: 1400, q: 0.9 }), 0.03, 0.55);
    put(dry, x, t, 0.5, 0, 0.5);
  };
  const hat = (t, g, open, pan) => put(dry, D.burst(open ? 0.35 : 0.06, { d: open ? 0.08 : 0.016, type: 'hp', f: 7500, steep: true }), t, g, pan);

  const CH = [
    { root: 33, v: [57, 60, 64, 67] },      // Am7
    { root: 29, v: [57, 60, 64, 65] },      // Fmaj7
    { root: 36, v: [55, 60, 64, 67] },      // C
    { root: 31, v: [55, 59, 62, 67] },      // G
  ];
  const CH2 = [CH[1], CH[3], { root: 28, v: [55, 59, 62, 64] }, CH[0]];   // F G Em Am — вторая половина припева
  const chordAt = (b) => (b >= 12 ? CH2 : CH)[b % 4];
  const MEL = [
    [[0, 76, 3], [3, 74, 1], [4, 76, 2], [6, 79, 2]], [[0, 81, 2], [2, 79, 2], [4, 76, 2], [6, 74, 2]],
    [[0, 76, 3], [3, 72, 1], [4, 74, 2], [6, 76, 2]], [[0, 74, 3], [3, 71, 1], [4, 74, 2], [6, 67, 2]],
    [[0, 81, 2], [2, 79, 2], [4, 81, 1], [5, 84, 3]], [[0, 83, 2], [2, 81, 2], [4, 79, 2], [6, 74, 2]],
    [[0, 76, 2], [2, 79, 2], [4, 83, 2], [6, 81, 1], [7, 79, 1]], [[0, 81, 4], [4, 76, 4]],
  ];

  for (let b = 0; b < BARS; b++) {
    const t0 = b * bar, ch = chordAt(b), intro = b < 4, chorus = b >= 8;
    // пэд: по голосу на ноту аккорда, разведены по панораме
    ch.v.forEach((m, k) => put(intro ? dry : duck, voice(m, bar - 0.05, { type: 'saw', det: [-9, 8], g: 0.06, a: 0.35, r: 0.4, q: 0.6, f0: intro ? 500 + b * 380 : 1900, f1: intro ? 600 + b * 400 : 2000, ft: 1 }), t0, 1, (k - 1.5) * 0.35, 0.5));
    // арпеджио 16-ми
    const ar = [ch.v[0], ch.v[1], ch.v[2], ch.v[3], ch.v[2] + 12, ch.v[3], ch.v[1] + 12, ch.v[2]];
    for (let k = 0; k < 16; k++) {
      const open = intro ? 900 + (b * 16 + k) * 40 : chorus ? 3600 : 2800;
      const x = voice(ar[k % 8] + 12, beat / 4 * 0.6, { type: 'sq', g: (k % 4 === 0 ? 0.075 : 0.055) * (intro ? 0.8 : 1), a: 0.003, d: 0.08, s: 0, r: 0.04, f0: open, f1: 500, ft: 0.05, q: 2 });
      const o = Math.round((t0 + k * beat / 4) * SR);
      for (let i = 0; i < x.length; i++) arp[(o + i) % N] += x[i];
    }
    // ударные
    if (b >= 2 && b < 4) { kick(t0); if (b === 3) kick(t0 + beat * 2); }
    if (!intro) { for (let k = 0; k < 4; k++) kick(t0 + k * beat); clap(t0 + beat); clap(t0 + beat * 3); }
    if (b >= 2) for (let k = 0; k < 8; k++) hat(t0 + k * beat / 2, k % 2 ? 0.2 : 0.11, false, 0.25);
    if (chorus) for (let k = 0; k < 4; k++) hat(t0 + k * beat + beat / 2, 0.1, true, -0.25);
    if (b === 3 || b === 7 || b === 11) put(dry, D.burst(bar, { a: bar * 0.95, d: 0.05, type: 'bp', f: (t) => 600 * (12 ** (t / bar)), q: 1.5 }), t0, 0.16, 0, 0.4);   // подъём
    if (b === 4 || b === 8 || b === 12) put(dry, D.burst(2, { a: 0.002, d: 0.5, type: 'hp', f: 5000 }), t0, 0.22, 0, 0.6);                                    // тарелка
    // бас: восьмые с октавой и квинтой + синус-саб на весь такт
    if (!intro) {
      for (const [bt, iv] of [[0, 0], [0.5, 0], [1.5, 12], [2, 0], [2.5, 0], [3, 7], [3.5, 12]]) put(duck, voice(ch.root + 12 + iv, beat * 0.42, { type: 'saw', det: [0, 6], g: 0.18, a: 0.005, d: 0.18, s: 0.5, r: 0.04, f0: 900, f1: 260, ft: 0.06, q: 2.5 }), t0 + bt * beat, 1);
      put(duck, voice(ch.root, bar * 0.95, { type: 'sin', g: 0.26, a: 0.01, r: 0.1 }), t0, 1);
    }
    // мелодия припева
    if (chorus) for (const [e, m, l] of MEL[b - 8]) {
      const len = l * beat / 2 * 0.92, t = t0 + e * beat / 2;
      const o = { g: 0.1, a: 0.012, d: 0.4, s: 0.6, r: 0.12, f0: 3000, f1: 2200, ft: 0.2, vib: 0.006 };
      const x = D.add(voice(m, len, { ...o, type: 'tri' }), voice(m + 12, len, { ...o, type: 'sin', g: 0.04 }));
      put(dry, x, t, 1, 0, 0.45);
      for (let i = 0; i < x.length; i++) arp[(Math.round(t * SR) + i) % N] += x[i] * 0.5;
    }
    await yieldNow();
  }

  // «накачка»: пэд и бас приседают на каждую долю бочки (с 5-го такта)
  const bs = Math.round(beat * SR);
  for (let i = 0; i < N; i++) {
    if (i < 16 * bs) continue;
    const k = (i % bs) / bs, g = k < 0.55 ? 0.4 + 0.6 * (k / 0.55) : 1;
    duck[0][i] *= g; duck[1][i] *= g;
  }
  // эхо арпеджио: пинг-понг 3/16, два прохода по кругу — у петли установившийся хвост
  const dn = Math.round(beat * 0.75 * SR), dl = new Float32Array(dn), dr = new Float32Array(dn), out = bus();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const j = (pass * N + i) % dn, yl = dl[j], yr = dr[j];
      dl[j] = arp[i] + yr * 0.38; dr[j] = yl;
      if (pass) { out[0][i] += arp[i] * 0.85 + yl * 0.55 + yr * 0.2; out[1][i] += arp[i] * 0.85 + yr * 0.55 + yl * 0.2; rev[i] += arp[i] * 0.25; }
    }
  }
  await yieldNow();
  // реверб: 4 гребенчатых + 2 всепропускающих фильтра на канал (Freeverb-подобный), тоже по кругу
  const sc = SR / 44100;
  for (let c = 0; c < 2; c++) {
    const cl = [1116, 1188, 1277, 1356].map((l) => Math.round((l + c * 23) * sc)), al = [556, 441].map((l) => Math.round((l + c * 23) * sc));
    const c0 = new Float32Array(cl[0]), c1 = new Float32Array(cl[1]), c2 = new Float32Array(cl[2]), c3 = new Float32Array(cl[3]), a0 = new Float32Array(al[0]), a1 = new Float32Array(al[1]);
    let i0 = 0, i1 = 0, i2 = 0, i3 = 0, j0 = 0, j1 = 0, f0 = 0, f1 = 0, f2 = 0, f3 = 0;
    const oc = out[c];
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        const x = rev[i] * 0.3;
        let v, y;
        v = c0[i0]; f0 = v * 0.75 + f0 * 0.25; c0[i0] = x + f0 * 0.86; if (++i0 === c0.length) i0 = 0; y = v;
        v = c1[i1]; f1 = v * 0.75 + f1 * 0.25; c1[i1] = x + f1 * 0.86; if (++i1 === c1.length) i1 = 0; y += v;
        v = c2[i2]; f2 = v * 0.75 + f2 * 0.25; c2[i2] = x + f2 * 0.86; if (++i2 === c2.length) i2 = 0; y += v;
        v = c3[i3]; f3 = v * 0.75 + f3 * 0.25; c3[i3] = x + f3 * 0.86; if (++i3 === c3.length) i3 = 0; y += v;
        v = a0[j0]; a0[j0] = y + v * 0.5; if (++j0 === a0.length) j0 = 0; y = v - y * 0.5;
        v = a1[j1]; a1[j1] = y + v * 0.5; if (++j1 === a1.length) j1 = 0; y = v - y * 0.5;
        if (pass) oc[i] += y * 0.5;
      }
    }
    await yieldNow();
  }
  // сведение: всё вместе, мягкое насыщение, нормировка
  let peak = 0;
  for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) { const v = Math.tanh((out[c][i] + dry[c][i] + duck[c][i]) * 1.2); out[c][i] = v; peak = Math.max(peak, Math.abs(v)); }
  for (let c = 0; c < 2; c++) if (peak > 0) D.gain(out[c], 0.9 / peak);
  return out;
}

// Музыка считается в отдельном потоке (Worker из исходников этих же функций) — лобби не подвисает.
// Нет Worker'а — считаем здесь же, по тактам.
const MUSIC_SR = 32000;                 // хватает для хэтов; браузер сам пересчитает в частоту вывода
async function renderMusic() {
  let data;
  try {
    const src = `const PI2 = ${PI2}; const mtof = ${mtof}; const yieldNow = async () => {}; const makeDsp = ${makeDsp}; const musicData = ${musicData};
      onmessage = async (e) => { const d = await musicData(e.data); postMessage(d, [d[0].buffer, d[1].buffer]); };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    data = await new Promise((res, rej) => { w.onmessage = (e) => res(e.data); w.onerror = rej; w.postMessage(MUSIC_SR); });
    w.terminate(); URL.revokeObjectURL(url);
  } catch (e) { data = await musicData(MUSIC_SR); }
  const buf = new AudioBuffer({ numberOfChannels: 2, length: data[0].length, sampleRate: MUSIC_SR });
  buf.copyToChannel(data[0], 0); buf.copyToChannel(data[1], 1);
  return buf;
}

// ---------- Движок ----------

export function createAudio({ camera, volume = () => 1, music = () => 0.5 }) {
  let ac = null, D = null, master, comp, sfxBus, musicBus, revSend;
  const cache = new Map();
  let voices = 0;
  const MAXV = 64;
  const L = new THREE.Vector3(), R = new THREE.Vector3(), F = new THREE.Vector3(), V = new THREE.Vector3();

  function init() {
    if (ac) return ac;
    try { ac = new AudioContext({ latencyHint: 'interactive' }); } catch (e) { return null; }
    D = makeDsp(ac.sampleRate);
    buses(ac, volume());
    return ac;
  }
  // Шины: эффекты → компрессор → общая громкость; музыка → громкость; общий ревербератор.
  let irBuf = null;
  function buses(cx, vol) {
    comp = cx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.15;
    master = cx.createGain();
    master.gain.value = vol;
    comp.connect(master).connect(cx.destination);
    sfxBus = cx.createGain(); sfxBus.connect(comp);
    musicBus = cx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);       // музыка — мимо компрессора
    // общий ревербератор: стерео-шум с экспоненциальным спадом, верх темнее к концу
    if (!irBuf) {
      const n = Math.ceil(cx.sampleRate * 2.2);
      irBuf = cx.createBuffer(2, n, cx.sampleRate);
      D.seed(991);
      for (let c = 0; c < 2; c++) {
        const d = irBuf.getChannelData(c);
        let lp = 0;
        for (let i = 0; i < n; i++) { const t = i / cx.sampleRate, k = Math.min(0.95, 0.2 + t * 0.5); lp = lp * k + D.rnd() * (1 - k); d[i] = lp * Math.exp(-t * 2.8) * 2.5 * (t < 0.008 ? t / 0.008 : 1); }
      }
    }
    const conv = cx.createConvolver(); conv.buffer = irBuf;
    revSend = cx.createGain(); revSend.connect(conv).connect(comp);
  }

  function buffer(name, v) {
    const key = `${name}#${v}`;
    let b = cache.get(key);
    if (b) return b;
    const gen = SFX[name];
    if (!gen) return null;
    let h = 7;
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
    D.seed(h + v * 7919);
    const x = D.norm(gen(D));
    b = ac.createBuffer(1, x.length, ac.sampleRate);
    b.copyToChannel(x, 0);
    cache.set(key, b);
    return b;
  }

  // Слушатель: где камера и куда смотрит (для панорамы и «за спиной» — глуше).
  function listener() {
    camera.getWorldPosition(L);
    camera.getWorldDirection(F);
    R.set(-F.z, 0, F.x).normalize();
  }

  // Проиграть звук. pos — точка в мире (нет — «у себя в голове»). o: vol, rate, at (задержка, с), jit (разброс высоты).
  function play(name, pos, o = {}) {
    if (!ac || ac.state !== 'running' || (voices >= MAXV && !rec)) return null;
    const vars = VARIANTS[name] || 1;
    const b = buffer(name, (Math.random() * vars) | 0);
    if (!b) return null;
    let g = (o.vol ?? 1) * (GAIN[name] ?? 1), pan = 0, cut = 0, at = o.at || 0;
    const sp = SPACE[name] || SPACE.default;
    let rv = o.rev ?? sp[2] * (pos ? 1 : 0.6);
    if (pos) {
      listener();
      V.copy(pos).sub(L);
      const d = V.length();
      const range = o.range ?? sp[1], ref = o.ref ?? sp[0];
      if (d > range) return null;
      g *= 1 / (1 + (d / ref) ** 1.4) * (1 - THREE.MathUtils.smoothstep(d, range * 0.75, range));
      if (d > 0.5) {
        V.multiplyScalar(1 / d);
        pan = THREE.MathUtils.clamp(V.dot(R), -1, 1) * Math.min(1, d / 3) * 0.85;
        const behind = V.dot(F) < -0.2 ? 0.55 : 1;
        cut = Math.max(500, 20000 * Math.exp(-d / (GUNS.has(name) ? 70 : 30)) * behind);
        rv = Math.min(0.9, rv + d / (GUNS.has(name) ? 160 : 80));
        if (GUNS.has(name) && d > 40) at += d / 343;               // звук далёкого выстрела приходит позже
      }
    }
    if (g < 0.002) return null;
    const src = ac.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = o.rate ?? 1 + (Math.random() - 0.5) * (o.jit ?? 0.08);
    let node = src;
    if (cut && cut < 18000) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; node = node.connect(f); }
    const gn = ac.createGain();
    gn.gain.value = g;
    node = node.connect(gn);
    if (pan) { const p = ac.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
    node.connect(sfxBus);
    if (rv > 0.01) { const s = ac.createGain(); s.gain.value = rv; gn.connect(s).connect(revSend); }
    src.start(ac.currentTime + at);
    voices++;
    src.onended = () => { voices--; src.disconnect(); };
    return src;
  }

  // Последовательность звуков по фазам (перезарядка, лечение): можно прервать.
  let seq = [];
  function sequence(list, total) {
    stopSeq();
    seq = list.map(([k, n]) => play(n, null, { at: k * total, jit: 0.05 })).filter(Boolean);
  }
  // время — явно: stop() без аргумента = «в момент 0», а при записи ролика это обрывает звуки, ещё не начавшиеся
  function stopSeq() { for (const s of seq) try { s.stop(ac.currentTime); } catch (e) { /* уже закончился */ } seq = []; }

  // ---------- Петли (ветер, купол, вертолёт, шторм) ----------
  let loops = {};
  function loop(name) {
    if (loops[name]) return loops[name];
    const src = ac.createBufferSource();
    src.buffer = buffer(name, 0);
    src.loop = true;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 20000;
    const g = ac.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(sfxBus);
    src.start(ac.currentTime, Math.random() * src.buffer.duration);
    return (loops[name] = { g, f, level: 0 });
  }
  function setLoop(name, level, cutoff = 20000, tc = 0.15) {
    if (!loops[name] && level < 0.003) return;
    const l = loop(name);
    if (Math.abs(l.level - level) > 0.002) { l.g.gain.setTargetAtTime(level * (GAIN[name] ?? 1), ac.currentTime, tc); l.level = level; }
    l.f.frequency.setTargetAtTime(cutoff, ac.currentTime, 0.1);
  }

  // ---------- Музыка ----------
  let musicBuf = null, musicSrc = null, musicWant = false, rendering = false;
  function startMusic() {
    if (!musicBuf || musicSrc) return;
    musicSrc = ac.createBufferSource();
    musicSrc.buffer = musicBuf;
    musicSrc.loop = true;
    musicSrc.connect(musicBus);
    musicSrc.start();
  }
  function wantMusic(on) {
    if (on === musicWant && (musicSrc || !on)) return;
    musicWant = on;
    if (!ac || ac.state !== 'running') return;
    if (on) {
      if (!musicBuf && !rendering) {
        rendering = true;
        renderMusic().then((b) => { musicBuf = b; rendering = false; if (musicWant) startMusic(); }).catch(() => { rendering = false; });
      }
      startMusic();
    }
    musicBus.gain.setTargetAtTime(on ? music() * 0.55 : 0, ac.currentTime, on ? 0.8 : 0.4);
    lastMus = on ? music() : -1;
    if (!on && musicSrc) { const s = musicSrc; musicSrc = null; setTimeout(() => { if (!musicWant) try { s.stop(); } catch (e) { /* уже */ } else musicSrc = musicSrc || s; }, 2500); }
  }

  // Первый жест пользователя: браузер разрешает звук только после него.
  const PREWARM = ['pistol', 'smg', 'ar', 'shotgun', 'sniper', 'step_grass', 'step_wood', 'hit', 'kill', 'casing', 'magOut', 'magIn', 'chargeBack', 'chargeFwd', 'pickAmmo', 'pickWeapon', 'uiClick', 'uiHover'];
  function unlock() {
    if (!init()) return;
    if (ac.state !== 'running') ac.resume().then(() => { if (musicWant) { musicWant = false; wantMusic(true); } });
    // прогреть частые звуки в паузах, чтобы первый выстрел не считался в кадре
    let i = 0;
    const warm = () => { if (i >= PREWARM.length) return; const n = PREWARM[i++]; for (let v = 0; v < (VARIANTS[n] || 1); v++) buffer(n, v); (self.requestIdleCallback || setTimeout)(warm); };
    if (!cache.size) warm();
  }
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlock, { capture: true, passive: true });

  let heartT = 0, lastVol = -1, lastMus = -1;

  // ---------- Запись звука для ролика ----------
  // Всё, что игра проигрывает, пишется в OfflineAudioContext по виртуальным часам ролика (clock() → секунды),
  // поэтому звук совпадает с кадрами, даже если кадры считаются медленнее реального времени.
  // music: [[t, уровень], …] — музыка лобби под ролик.
  let rec = null;
  async function capture(seconds, clock, music = []) {
    init();
    const real = { ac, comp, master, sfxBus, musicBus, revSend, loops, voices };
    const mb = musicBuf || (musicBuf = await renderMusic());
    const oc = new OfflineAudioContext(2, Math.ceil(seconds * real.ac.sampleRate), real.ac.sampleRate);
    Object.defineProperty(oc, 'currentTime', { get: () => Math.max(0, clock()) });
    Object.defineProperty(oc, 'state', { get: () => 'running' });
    ac = oc; loops = {}; voices = 0;
    buses(oc, 1);
    if (music.length) {
      const src = oc.createBufferSource(); src.buffer = mb; src.loop = true; src.connect(musicBus); src.start(0);
      for (const [t, v] of music) musicBus.gain.linearRampToValueAtTime(v, t);
    }
    rec = { real, oc };
    return async () => {
      seq = [];
      const out = await oc.startRendering();
      ({ ac, comp, master, sfxBus, musicBus, revSend, loops, voices } = real);
      rec = null; lastVol = -1;
      return out;
    };
  }
  const running = () => ac && ac.state === 'running';

  return {
    play,
    get ctx() { return ac; },
    // Выстрел: свой (pos = null) — со звуком механики и гильзами; чужой — в точке, с расстоянием.
    shot(type, pos) {
      const own = !pos;
      play(type === 'rocket' ? 'bazooka' : type, pos, { jit: 0.06 });
      if (!own) return;
      if (type === 'shotgun') { play('pumpBack', null, { at: 0.2 }); play('pumpFwd', null, { at: 0.42 }); play('shellDrop', null, { at: 0.75, vol: 0.8 }); }
      else if (type === 'sniper') { play('boltUp', null, { at: 0.28 }); play('boltBack', null, { at: 0.38 }); play('casing', null, { at: 0.85 }); play('boltFwd', null, { at: 0.52 }); play('boltDown', null, { at: 0.68 }); }
      else if (type !== 'bazooka' && (type !== 'smg' || Math.random() < 0.5)) play('casing', null, { at: 0.35 + Math.random() * 0.15, vol: 0.6 + Math.random() * 0.4 });
    },
    // Пуля чужого прошла рядом: свист в ближайшей точке траектории.
    whiz(a, b) {
      if (!running()) return;
      listener();
      const ab = V.copy(b).sub(a), len = ab.length();
      if (len < 1) return;
      ab.multiplyScalar(1 / len);
      const t = THREE.MathUtils.clamp(L.clone().sub(a).dot(ab), 0, len);
      if (t < 6) return;                                             // стрелок вплотную — свиста нет
      const p = a.clone().addScaledVector(ab, t), d = p.distanceTo(L);
      if (d < 4) play('whiz', p, { vol: 1.2 - d / 4, ref: 3, range: 6, rev: 0 });
    },
    reload(type, total) { sequence(RELOAD[type] || RELOAD.mag, total); },
    heal(total) { sequence(HEAL, total); },
    stop: stopSeq,
    step(surface, pos, vol = 1) { play(`step_${surface}`, pos, { vol, jit: 0.12, range: pos ? 40 : 45, ref: 3 }); },
    land(speed, surface) {
      const k = THREE.MathUtils.clamp((speed - 4) / 20, 0.2, 1);
      play('land', null, { vol: k });
      play(`step_${surface}`, null, { vol: 1.2 });
      if (k > 0.5) play('gear', null, { vol: 1.5 });
    },
    // Каждый кадр: громкость, музыка, петли окружения, сердцебиение.
    frame(dt, s) {
      if (!ac) return;
      const vol = volume(), mus = music();
      if (!rec && vol !== lastVol) { master.gain.setTargetAtTime(vol, ac.currentTime, 0.05); lastVol = vol; }
      if (!rec) wantMusic(!!s.lobby);
      if (!rec && musicWant && mus !== lastMus) { musicBus.gain.setTargetAtTime(mus * 0.55, ac.currentTime, 0.3); lastMus = mus; }
      if (!running()) return;
      const fall = s.fall ? THREE.MathUtils.clamp(s.speed / 30, 0.25, 1) : 0;
      setLoop('wind', s.chute ? 0.35 : fall, s.chute ? 700 : 500 + 2500 * fall, 0.25);
      setLoop('canopy', s.chute ? 1 : 0, 20000, 0.2);
      setLoop('rotor', s.heli || 0, s.riding ? 900 : 4000, 0.3);
      setLoop('storm', s.storm || 0, 1200 + 6000 * (s.storm || 0), 0.5);
      // сердце при малом здоровье
      if (s.hp > 0 && s.hp <= 30) {
        heartT -= dt;
        if (heartT <= 0) { play('heart', null, { vol: 0.6 + (30 - s.hp) / 75, rev: 0 }); heartT = 0.62 + s.hp / 60; }
      } else heartT = 0;
    },
    unlock,
    capture,
    // для проверки: все имена звуков и их буферы
    names: () => Object.keys(SFX),
    buffer: (n, v = 0) => (init() ? buffer(n, v) : null),
    renderMusic: () => renderMusic(),
    get debug() { return { voices, music: !!musicSrc, musicGain: musicBus?.gain.value, loops: Object.fromEntries(Object.entries(loops).map(([k, l]) => [k, +l.g.gain.value.toFixed(3)])) }; },
  };
}
