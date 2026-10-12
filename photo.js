// 修圖模式
const PV = $('#pv');
const PHOTO_MAX = 4096;      // 匯入時長邊上限
const PREVIEW_MAX = 1600;    // 畫面預覽用的長邊
const HIST_MAX = 12;

const ADJ = [
  ['brightness', '亮度', -100, 100], ['contrast', '對比', -100, 100], ['saturation', '飽和度', -100, 100], ['vibrance', '自然飽和', -100, 100],
  ['exposure', '曝光', -100, 100], ['temp', '色溫', -100, 100], ['tint', '色調', -100, 100],
  ['hue', '色相', -180, 180], ['highlights', '高光', -100, 100], ['shadows', '陰影', -100, 100],
  ['fade', '褪色', 0, 100], ['clarity', '清晰度', -100, 100], ['sharpen', '銳利', 0, 100], ['blur', '柔焦', 0, 100],
  ['vignette', '暗角', 0, 100], ['grain', '顆粒', 0, 100], ['denoise', '降噪', 0, 100]
];
// 調整面板的分類，每一類都可以用箭頭收合
const ADJ_GROUPS = [
  ['light', '光線', ['brightness', 'contrast', 'exposure', 'highlights', 'shadows']],
  ['color', '色彩', ['saturation', 'vibrance', 'temp', 'tint', 'hue']],
  ['quality', '畫質', ['denoise', 'sharpen', 'clarity']],
  ['fx', '效果', ['fade', 'blur', 'vignette', 'grain']]
];
const UPSCALE_MAX = 6000;   // 放大解析度後的長邊上限
const PRESETS = [
  ['none', '原圖', {}],
  ['fresh', '清新', { brightness: .12, contrast: -.05, saturation: .15, temp: -.12, fade: .15 }],
  ['warm', '暖陽', { temp: .35, saturation: .1, brightness: .05, contrast: .05 }],
  ['cool', '冷調', { temp: -.35, contrast: .1, saturation: -.05 }],
  ['japan', '日系', { exposure: .15, contrast: -.15, saturation: -.15, fade: .3, tint: -.08, temp: -.05 }],
  ['film', '膠片', { contrast: .15, fade: .25, saturation: -.1, temp: .12 }],
  ['vintage', '復古', { sepia: .55, contrast: .05, fade: .2 }],
  ['bw', '黑白', { mono: 1, contrast: .15 }],
  ['drama', '戲劇', { contrast: .4, saturation: -.2, shadows: -.2, highlights: .1 }],
  ['vivid', '鮮豔', { saturation: .45, contrast: .15 }],
  ['sweet', '甜美', { tint: .18, brightness: .1, saturation: .1, fade: .12, temp: .08 }],
  ['night', '夜景', { temp: -.2, contrast: .25, shadows: .2, saturation: .15 }],
  ['mocha', '摩卡', { sepia: .25, contrast: .1, saturation: -.15, temp: .1 }],
  ['mint', '薄荷', { tint: -.2, temp: -.1, fade: .15, brightness: .05 }],
  ['sunset', '夕陽', { temp: .3, tint: .15, saturation: .2, contrast: .1 }],
  ['neon', '霓虹', { hue: -18, saturation: .4, contrast: .2, tint: .2, temp: -.2 }],
  ['grey', '灰調', { saturation: -.4, fade: .35, contrast: -.05 }],
  ['hdr', 'HDR', { shadows: .5, highlights: -.4, contrast: .2, saturation: .2 }]
];
const FONTS = {
  hei: ['黑體', '"Noto Sans TC","Microsoft JhengHei","PingFang TC",sans-serif'],
  ming: ['明體', '"Noto Serif TC","PMingLiU","Songti TC",serif'],
  kai: ['楷體', '"LXGW WenKai TC","DFKai-SB","BiauKai","Kaiti TC",serif']
};
const STICKERS = ['❤️', '⭐', '✨', '🔥', '🌸', '🎀', '👑', '😎', '😍', '🥰', '😂', '🤩', '🎉', '🎈', '🌈', '☀️', '🌙', '☁️', '🍀', '🐱', '🐶', '🦋', '💬', '💯', '👍', '✌️', '🎂', '☕', '🍓', '📍', '🎵', '💡'];
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
const PHOTO_TOOLS = [['adjust', '調整'], ['filter', '濾鏡'], ['beauty', '美顏'], ['retouch', '細修'], ['cutout', '去背'], ['remove', '清除'], ['crop', '裁切'], ['text', '文字'], ['sticker', '貼圖'], ['brush', '畫筆'], ['frame', '邊框']];

const P = {
  base: null, paint: null, objects: [], sel: null,
  adj: {}, preset: 'none', presetAmt: 100,
  beauty: { smooth: 0, whiten: 0, rosy: 0 },
  frame: { type: 'none', color: '#ffffff', color2: '#ff5d8f', size: 5 },
  tool: 'adjust', hist: [], redo: [], open: { light: true, color: true, quality: true, fx: true, hsl: false },
  crop: { x: 0, y: 0, w: 1, h: 1 }, cropRatio: 0,
  brushMode: 'doodle', brushColor: '#ff5d8f', brushSize: { doodle: 30, mosaic: 40, erase: 40, liquify: 45, retouch: 35, mask: 30, mark: 35 },
  cut: null, cutModel: 'Xenova/modnet', maskBrush: '', mark: null,
  hsl: {}, hslBand: 'red', fx: { type: 'none', amt: 60 }, zoom: 1,
  liqOn: false, liqStrength: 50, compare: false
};
function resetAdj() { for (const [k] of ADJ) P.adj[k] = 0; }
resetAdj();

// ── 歷史紀錄。base 與 paint 一律「寫入前先複製」，所以快照只要留參照 ──
function snapshot() {
  return {
    base: P.base, paint: P.paint, objects: P.objects.map(o => ({ ...o })),
    adj: { ...P.adj }, preset: P.preset, presetAmt: P.presetAmt, beauty: { ...P.beauty }, frame: { ...P.frame },
    cut: P.cut ? { ...P.cut, bg: { ...P.cut.bg } } : null,
    hsl: JSON.parse(JSON.stringify(P.hsl)), fx: { ...P.fx }
  };
}
function restore(s) {
  P.base = s.base; P.paint = s.paint; P.objects = s.objects.map(o => ({ ...o }));
  P.adj = { ...s.adj }; P.preset = s.preset; P.presetAmt = s.presetAmt; P.beauty = { ...s.beauty }; P.frame = { ...s.frame };
  P.cut = s.cut ? { ...s.cut, bg: { ...s.cut.bg } } : null; P.mark = null;
  P.hsl = JSON.parse(JSON.stringify(s.hsl || {})); P.fx = { ...(s.fx || { type: 'none', amt: 60 }) };
  P.sel = null; P.crop = { x: 0, y: 0, w: 1, h: 1 };
  showTool(P.tool);
  requestRender();
}
function pushHistory() {
  P.hist.push(snapshot());
  // 大圖每一步都很佔記憶體，保留的步數少一點
  const cap = P.base.width * P.base.height > 9e6 ? 6 : HIST_MAX;
  while (P.hist.length > cap) P.hist.shift();
  P.redo = [];
  syncHistButtons();
}
function undo() {
  if (!P.hist.length) return;
  P.redo.push(snapshot());
  restore(P.hist.pop());
  syncHistButtons();
}
function redo() {
  if (!P.redo.length) return;
  P.hist.push(snapshot());
  restore(P.redo.pop());
  syncHistButtons();
}
function syncHistButtons() {
  const v = MODE === 'video';
  $('#undoBtn').disabled = v ? !VH.undo.length : !P.hist.length;
  $('#redoBtn').disabled = v ? !VH.redo.length : !P.redo.length;
}

function setPhotoImage(src) {
  const s = Math.min(1, PHOTO_MAX / Math.max(src.width, src.height));
  const base = mk(src.width * s, src.height * s);
  const ctx = base.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, base.width, base.height);
  P.base = base;
  P.paint = mk(base.width, base.height);
  P.objects = []; P.sel = null;
  resetAdj(); P.preset = 'none'; P.presetAmt = 100;
  P.beauty = { smooth: 0, whiten: 0, rosy: 0 };
  P.frame = { type: 'none', color: '#ffffff', color2: '#ff5d8f', size: 5 };
  P.crop = { x: 0, y: 0, w: 1, h: 1 };
  P.cut = null; P.mark = null; P.maskBrush = '';
  P.hsl = {}; P.hslBand = ''; P.hslPick = false; P.fx = { type: 'none', amt: 60 }; P.zoom = 1;   // hslBand 留空：開新照片時自動選佔最多的顏色
  P.hist = []; P.redo = [];
  syncHistButtons();
  syncPhotoEmpty();
  $('#zoomLabel').textContent = '100%';
  showTool(P.tool);
  requestRender();
}

// ── 色彩運算 ──
function mul3(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const lerpM = (m, t) => m.map((v, i) => IDENT[i] + (v - IDENT[i]) * t);
// 把一組參數（-1..1）變成每個色版的查表 + 一個 3x3 矩陣
function buildStage(a) {
  const g = k => a[k] || 0;
  const lr = new Uint8ClampedArray(256), lg = new Uint8ClampedArray(256), lb = new Uint8ClampedArray(256);
  const ex = Math.pow(2, g('exposure') * 1.2), b = g('brightness') * 0.35;
  const c = g('contrast') >= 0 ? 1 + g('contrast') * 1.5 : 1 + g('contrast') * 0.8;
  const hl = g('highlights') * 0.3, sh = g('shadows') * 0.3, fd = g('fade');
  const kr = 1 + g('temp') * 0.18 + g('tint') * 0.06, kg = 1 - g('tint') * 0.12, kb = 1 - g('temp') * 0.18 + g('tint') * 0.06;
  for (let i = 0; i < 256; i++) {
    let v = i / 255 * ex + b;
    v = (v - 0.5) * c + 0.5;
    const vc = clamp(v, 0, 1);
    v += sh * (1 - vc) * (1 - vc) + hl * vc * vc;
    v = v * (1 - 0.25 * fd) + 0.12 * fd;
    lr[i] = v * kr * 255; lg[i] = v * kg * 255; lb[i] = v * kb * 255;
  }
  let m = IDENT;
  const s = g('saturation') >= 0 ? 1 + g('saturation') : 1 + g('saturation');
  if (s !== 1) {
    const w = [0.299, 0.587, 0.114], sm = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) sm.push(w[j] * (1 - s) + (i === j ? s : 0));
    m = mul3(sm, m);
  }
  if (g('hue')) {
    const rad = g('hue') * Math.PI / 180, co = Math.cos(rad), si = Math.sin(rad);
    m = mul3([
      .213 + co * .787 - si * .213, .715 - co * .715 - si * .715, .072 - co * .072 + si * .928,
      .213 - co * .213 + si * .143, .715 + co * .285 + si * .140, .072 - co * .072 - si * .283,
      .213 - co * .213 - si * .787, .715 - co * .715 + si * .715, .072 + co * .928 + si * .072
    ], m);
  }
  if (g('mono')) m = mul3(lerpM([.299, .587, .114, .299, .587, .114, .299, .587, .114], g('mono')), m);
  if (g('sepia')) m = mul3(lerpM([.393, .769, .189, .349, .686, .168, .272, .534, .131], g('sepia')), m);
  return { lr, lg, lb, m: m === IDENT ? null : m };
}
function applyStage(d, st) {
  const { lr, lg, lb, m } = st;
  if (!m) {
    for (let i = 0; i < d.length; i += 4) { d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]]; }
    return;
  }
  const [a, b, c, e, f, g, p, q, r] = m;
  for (let i = 0; i < d.length; i += 4) {
    const R = lr[d[i]], G = lg[d[i + 1]], B = lb[d[i + 2]];
    d[i] = a * R + b * G + c * B; d[i + 1] = e * R + f * G + g * B; d[i + 2] = p * R + q * G + r * B;
  }
}
function applyVibrance(d, v) {
  // 只加強原本不鮮豔的顏色，膚色和已經很飽和的地方不會過頭
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const k = v * (1 - (Math.max(r, g, b) - Math.min(r, g, b)) / 255) * 1.2, gray = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i] = r + (r - gray) * k; d[i + 1] = g + (g - gray) * k; d[i + 2] = b + (b - gray) * k;
  }
}
// ── 選色：只調某一種顏色（例如只讓天空更藍、只把草地調綠）──
const HSL_BANDS = [['red', '紅', 0, '#e5484d'], ['orange', '橙', 30, '#f08c2e'], ['yellow', '黃', 58, '#f2d13c'], ['green', '綠', 120, '#46a758'],
  ['cyan', '青', 180, '#34b8c4'], ['blue', '藍', 225, '#3e63dd'], ['purple', '紫', 275, '#8e4ec6'], ['pink', '粉', 320, '#e93d82']];
// 把一個顏色歸到最接近的色系；太接近黑白灰（沒有明確色相）時回傳 null
function hslBandOf(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), df = mx - mn;
  if (df < 28) return null;
  let hue = mx === r ? ((g - b) / df) % 6 : mx === g ? (b - r) / df + 2 : (r - g) / df + 4;
  hue *= 60; if (hue < 0) hue += 360;
  let best = null, bestDist = 999;
  for (const band of HSL_BANDS) {
    let dist = Math.abs(hue - band[2]); if (dist > 180) dist = 360 - dist;
    if (dist < bestDist) { bestDist = dist; best = band[0]; }
  }
  return best;
}
// 統計這張照片實際出現哪些色系：回傳 [{ key, name, share（佔畫面比例）, color（照片裡這個色系的平均色） }]，依比例由多到少
const hslSeen = new WeakMap();
function hslPresent() {
  if (hslSeen.has(P.base)) return hslSeen.get(P.base);
  const k = Math.min(1, 160 / Math.max(P.base.width, P.base.height));
  const c = mk(P.base.width * k, P.base.height * k), x = c.getContext('2d');
  x.drawImage(P.base, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data, total = d.length / 4, acc = {};
  for (let i = 0; i < d.length; i += 4) {
    const key = hslBandOf(d[i], d[i + 1], d[i + 2]);
    if (!key) continue;
    const a = acc[key] || (acc[key] = { n: 0, r: 0, g: 0, b: 0 });
    a.n++; a.r += d[i]; a.g += d[i + 1]; a.b += d[i + 2];
  }
  const list = HSL_BANDS.filter(b => acc[b[0]] && acc[b[0]].n / total >= 0.015).map(b => {
    const a = acc[b[0]];
    return { key: b[0], name: b[1], share: a.n / total, color: 'rgb(' + Math.round(a.r / a.n) + ',' + Math.round(a.g / a.n) + ',' + Math.round(a.b / a.n) + ')' };
  }).sort((p, q) => q.share - p.share);
  hslSeen.set(P.base, list);
  return list;
}
function hslActive() {
  return HSL_BANDS.filter(b => { const v = P.hsl[b[0]]; return v && (v.h || v.s || v.l); });
}
function applyHsl(d) {
  const act = hslActive().map(b => ({ c: b[2], ...P.hsl[b[0]] })), RANGE = 38;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), df = mx - mn;
    if (df < 10) continue;   // 接近灰色的像素沒有明確色相，不動
    let hue = mx === r ? ((g - b) / df) % 6 : mx === g ? (b - r) / df + 2 : (r - g) / df + 4;
    hue *= 60; if (hue < 0) hue += 360;
    let dh = 0, ds = 0, dl = 0, tw = 0;
    for (const a of act) {
      let dist = Math.abs(hue - a.c); if (dist > 180) dist = 360 - dist;
      if (dist < RANGE) { const w = 1 - dist / RANGE; dh += a.h * w; ds += a.s * w; dl += a.l * w; tw += w; }
    }
    if (!tw) continue;
    const k = Math.min(1, df / 60), l = (mx + mn) / 510, den = 1 - Math.abs(2 * l - 1), sat = den > 0.001 ? df / 255 / den : 0;
    const nh = ((hue + dh * 0.6 * k) % 360 + 360) % 360, ns = clamp(sat * (1 + ds / 100 * k), 0, 1), nl = clamp(l + dl / 100 * 0.3 * k, 0, 1);
    const c = (1 - Math.abs(2 * nl - 1)) * ns, hp = nh / 60, x = c * (1 - Math.abs(hp % 2 - 1)), m = nl - c / 2;
    let R, G, B;
    if (hp < 1) { R = c; G = x; B = 0; } else if (hp < 2) { R = x; G = c; B = 0; } else if (hp < 3) { R = 0; G = c; B = x; }
    else if (hp < 4) { R = 0; G = x; B = c; } else if (hp < 5) { R = x; G = 0; B = c; } else { R = c; G = 0; B = x; }
    d[i] = (R + m) * 255; d[i + 1] = (G + m) * 255; d[i + 2] = (B + m) * 255;
  }
}

// ── 特效：整張照片套用的風格化效果 ──
const PHOTO_FX = [['none', '無'], ['sketch', '素描'], ['glow', '柔光暈'], ['glitch', '故障'], ['pixel', '像素'], ['tilt', '移軸'], ['mirror', '鏡像對稱']];
function applyFx(src, iw, ih) {
  const t = P.fx.type, a = P.fx.amt / 100, M = Math.max(iw, ih), out = cloneCanvas(src), o = out.getContext('2d');
  if (t === 'glow') {
    o.globalCompositeOperation = 'screen'; o.globalAlpha = 0.3 + a * 0.55;
    o.drawImage(blurCanvas(src, M / 60 * (0.5 + a)), 0, 0);
  } else if (t === 'pixel') {
    const block = Math.max(2, Math.round(M / (170 - a * 140))), small = mk(iw / block, ih / block);
    small.getContext('2d').drawImage(src, 0, 0, small.width, small.height);
    o.imageSmoothingEnabled = false;
    o.drawImage(small, 0, 0, iw, ih);
  } else if (t === 'tilt') {
    // 上下模糊、中間清楚，看起來像模型場景
    const bl = blurCanvas(src, M / 110 * (0.5 + a * 1.5)), bx = bl.getContext('2d'), g = bx.createLinearGradient(0, 0, 0, ih);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.36, 'rgba(0,0,0,0)'); g.addColorStop(0.64, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    bx.globalCompositeOperation = 'destination-in'; bx.fillStyle = g; bx.fillRect(0, 0, iw, ih);
    o.drawImage(bl, 0, 0);
  } else if (t === 'mirror') {
    o.translate(iw, 0); o.scale(-1, 1);
    o.drawImage(src, 0, 0, iw / 2, ih, 0, 0, iw / 2, ih);
  } else if (t === 'sketch') {
    const id = o.getImageData(0, 0, iw, ih), d = id.data;
    const bd = blurCanvas(src, M / 220 * (1 + a * 2)).getContext('2d').getImageData(0, 0, iw, ih).data, dark = 1 + a * 2;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2], bg = 0.299 * bd[i] + 0.587 * bd[i + 1] + 0.114 * bd[i + 2];
      const v = 255 - (255 - Math.min(255, g * 255 / Math.max(1, bg))) * dark;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    o.putImageData(id, 0, 0);
  } else if (t === 'glitch') {
    const id = o.getImageData(0, 0, iw, ih), d = id.data, s = new Uint8ClampedArray(d), off = Math.max(1, Math.round(iw * (0.004 + a * 0.02)));
    // 固定的亂數種子，預覽和匯出才會長一樣
    let seed = 20261012; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const shift = new Int32Array(ih);
    for (let k = 0; k < 7; k++) {
      const y0 = Math.floor(rnd() * ih), hh = Math.floor(rnd() * ih * 0.07) + 1, sx = Math.round((rnd() - 0.5) * iw * 0.14 * a);
      for (let y = y0; y < Math.min(ih, y0 + hh); y++) shift[y] = sx;
    }
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
      const bx = clamp(x + shift[y], 0, iw - 1), i = (y * iw + x) * 4, row = y * iw;
      d[i] = s[(row + clamp(bx + off, 0, iw - 1)) * 4];
      d[i + 1] = s[(row + bx) * 4 + 1];
      d[i + 2] = s[(row + clamp(bx - off, 0, iw - 1)) * 4 + 2];
    }
    o.putImageData(id, 0, 0);
  }
  return out;
}
const TEXT_STYLES = [
  ['白字黑邊', { color: '#ffffff', stroke: true, strokeColor: '#1a1a1a', shadow: false, bold: true, font: 'hei' }],
  ['綜藝黃', { color: '#ffd24a', stroke: true, strokeColor: '#1a1a1a', shadow: true, bold: true, font: 'hei' }],
  ['黑字白邊', { color: '#1a1a1a', stroke: true, strokeColor: '#ffffff', shadow: false, bold: true, font: 'hei' }],
  ['粉紅甜美', { color: '#ff5d8f', stroke: true, strokeColor: '#ffffff', shadow: true, bold: true, font: 'hei' }],
  ['青綠活力', { color: '#62d2c6', stroke: true, strokeColor: '#05221f', shadow: false, bold: true, font: 'hei' }],
  ['簡約白', { color: '#ffffff', stroke: false, shadow: true, bold: false, font: 'hei' }],
  ['文青明體', { color: '#ffffff', stroke: false, shadow: true, bold: false, font: 'ming' }],
  ['手寫楷體', { color: '#1a1a1a', stroke: true, strokeColor: '#ffffff', shadow: false, bold: false, font: 'kai' }]
];
function setZoom(z) {
  P.zoom = clamp(Math.round(z * 2) / 2, 1, 4);
  $('#zoomLabel').textContent = Math.round(P.zoom * 100) + '%';
  requestRender();
}
function presetStage(key, amt) {
  const def = PRESETS.find(p => p[0] === key);
  if (!def || key === 'none' || amt <= 0) return null;
  const a = {};
  for (const k in def[2]) a[k] = def[2][k] * amt;
  return buildStage(a);
}
function userStage() {
  const a = {};
  let any = false;
  for (const k of ['brightness', 'contrast', 'saturation', 'exposure', 'temp', 'tint', 'highlights', 'shadows', 'fade']) {
    a[k] = P.adj[k] / 100;
    if (P.adj[k]) any = true;
  }
  a.hue = P.adj.hue;
  return any || a.hue ? buildStage(a) : null;
}

// 美顏：磨皮只作用在膚色、且避開邊緣，才不會整張糊掉
function beautyPass(cv) {
  const { smooth, whiten, rosy } = P.beauty;
  if (!smooth && !whiten && !rosy) return;
  const w = cv.width, hh = cv.height, ctx = cv.getContext('2d');
  const id = ctx.getImageData(0, 0, w, hh), d = id.data;
  let bd = null;
  if (smooth) bd = blurCanvas(cv, Math.max(1.5, Math.max(w, hh) / 1280 * (3 + smooth * 0.06))).getContext('2d').getImageData(0, 0, w, hh).data;
  const ks = smooth / 100, kw = whiten / 100, kr = rosy / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    let m = 1 - Math.max(Math.abs(cb - 102) / 28, Math.abs(cr - 153) / 24);
    m = m <= 0 ? 0 : Math.min(1, m * 3);
    if (bd && m > 0) {
      const diff = Math.abs(r - bd[i]) + Math.abs(g - bd[i + 1]) + Math.abs(b - bd[i + 2]);
      const k = ks * m * Math.max(0, 1 - diff / 90);
      r += (bd[i] - r) * k; g += (bd[i + 1] - g) * k; b += (bd[i + 2] - b) * k;
    }
    if (kw) {
      const k = kw * (0.3 + 0.7 * m) * 0.24;
      r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k;
    }
    if (kr && m > 0) { r += 20 * kr * m; g -= 4 * kr * m; b += 8 * kr * m; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(id, 0, 0);
}

// 降噪：平滑的區域往模糊版靠攏，邊緣和細節差異大的地方保留原樣
function denoisePass(cv, amt) {
  const w = cv.width, hh = cv.height, ctx = cv.getContext('2d');
  const id = ctx.getImageData(0, 0, w, hh), d = id.data;
  const bd = blurCanvas(cv, Math.max(1, Math.max(w, hh) / 1600 * (1 + amt * 2.5))).getContext('2d').getImageData(0, 0, w, hh).data;
  const edge = 60 + amt * 140;
  for (let i = 0; i < d.length; i += 4) {
    const diff = Math.abs(d[i] - bd[i]) + Math.abs(d[i + 1] - bd[i + 1]) + Math.abs(d[i + 2] - bd[i + 2]);
    const k = amt * Math.max(0, 1 - diff / edge);
    d[i] += (bd[i] - d[i]) * k; d[i + 1] += (bd[i + 1] - d[i + 1]) * k; d[i + 2] += (bd[i + 2] - d[i + 2]) * k;
  }
  ctx.putImageData(id, 0, 0);
}
// 去背後的合成：主體照遮罩留下來，背景換成透明、顏色、圖片，或原背景的模糊／黑白版
function composeCut(src, iw, ih) {
  const c = P.cut, bg = c.bg, out = mk(iw, ih), o = out.getContext('2d');
  const sub = cloneCanvas(src), sx = sub.getContext('2d');
  sx.globalCompositeOperation = 'destination-in';
  sx.imageSmoothingQuality = 'high';
  if (c.feather && HAS_FILTER) sx.filter = 'blur(' + (c.feather * Math.max(iw, ih) / 1500).toFixed(2) + 'px)';
  sx.drawImage(c.mask, 0, 0, iw, ih);
  if (bg.type === 'color') { o.fillStyle = bg.color; o.fillRect(0, 0, iw, ih); }
  else if (bg.type === 'gradient') {
    const g = o.createLinearGradient(0, 0, 0, ih);
    g.addColorStop(0, bg.color); g.addColorStop(1, bg.color2);
    o.fillStyle = g; o.fillRect(0, 0, iw, ih);
  } else if (bg.type === 'image' && bg.img) {
    const k = Math.max(iw / bg.img.width, ih / bg.img.height), dw = bg.img.width * k, dh = bg.img.height * k;
    o.imageSmoothingQuality = 'high';
    o.drawImage(bg.img, (iw - dw) / 2, (ih - dh) / 2, dw, dh);
  } else if (bg.type === 'blur') {
    o.drawImage(src, 0, 0);
    o.drawImage(blurCanvas(src, Math.max(1, Math.max(iw, ih) * bg.blur / 100 * 0.05)), 0, 0);
  } else if (bg.type === 'gray') {
    o.drawImage(src, 0, 0);
    o.globalCompositeOperation = 'saturation'; o.fillStyle = '#808080'; o.fillRect(0, 0, iw, ih);
    o.globalCompositeOperation = 'source-over';
  }
  o.drawImage(sub, 0, 0);
  return out;
}
async function runCutout() {
  const base = P.base;
  try {
    const mask = await aiMatte(base, P.cutModel);
    if (P.base !== base) return;   // 等待期間照片被換掉或改過了
    pushHistory();
    const old = P.cut && P.cut.bg;
    P.cut = { mask, feather: 1, bg: old ? { ...old } : { type: 'transparent', color: '#ffffff', color2: '#62d2c6', img: null, blur: 50 } };
    showTool('cutout'); requestRender();
    toast('去背完成，可以在右邊換背景');
  } catch (e) { aiErrorToast(e); }
}
async function runRemove() {
  const base = P.base;
  if (!P.mark) { toast('先在照片上塗抹要清除的人或物品'); return; }
  try {
    const out = await aiInpaint(base, P.mark);
    if (!out) { toast('先在照片上塗抹要清除的人或物品'); return; }
    if (P.base !== base) return;
    pushHistory();
    P.base = out; P.mark = null;
    requestRender();
    toast('清除完成。不滿意可以按「復原」，或再塗一次殘留的地方');
  } catch (e) { aiErrorToast(e); }
}
let noiseTile = null;
function getNoise() {
  if (noiseTile) return noiseTile;
  noiseTile = mk(160, 160);
  const x = noiseTile.getContext('2d'), id = x.createImageData(160, 160);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = Math.random() * 255;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  return noiseTile;
}

function frameInsets(final) {
  const f = P.frame;
  if (f.type === 'none' || (!final && P.tool === 'crop')) return { l: 0, t: 0, r: 0, b: 0 };
  const s = Math.round(Math.min(P.base.width, P.base.height) * f.size / 100);
  if (f.type === 'polaroid') return { l: s, t: s, r: s, b: Math.round(s * 3.6) };
  if (f.type === 'film') { const band = Math.round(s * 2.2); return { l: s, t: band, r: s, b: band }; }
  return { l: s, t: s, r: s, b: s };
}

// 邊框上的線條、齒孔用跟底色相反的深淺，才看得見
function contrastOf(hex) {
  const n = parseInt(hex.slice(1), 16), lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 140 ? '#1a1a1a' : '#ffffff';
}
// 畫出邊框和照片。b 是左右邊框寬度、bt 是上方邊框高度（都已換算成輸出像素）
function drawFramed(ctx, wc, W, H, ix, iy, iw, ih, b, bt) {
  const f = P.frame, ink = contrastOf(f.color);
  if (f.type === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, f.color); g.addColorStop(1, f.color2 || '#ff5d8f');
    ctx.fillStyle = g;
  } else ctx.fillStyle = f.color;
  ctx.fillRect(0, 0, W, H);
  if (f.type === 'round' || f.type === 'circle') {
    ctx.save();
    if (f.type === 'round') roundRectPath(ctx, ix, iy, iw, ih, Math.min(iw, ih) * 0.08);
    else { ctx.beginPath(); ctx.ellipse(ix + iw / 2, iy + ih / 2, iw / 2, ih / 2, 0, 0, Math.PI * 2); }
    ctx.clip();
    ctx.drawImage(wc, ix, iy);
    ctx.restore();
    return;
  }
  if (f.type === 'shadow') {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = b * 0.7; ctx.shadowOffsetY = b * 0.25;
    ctx.fillStyle = '#000000'; ctx.fillRect(ix, iy, iw, ih);
    ctx.restore();
  }
  ctx.drawImage(wc, ix, iy);
  if (f.type === 'double') {
    const lw = Math.max(1, b * 0.1), inset = b * 0.45;
    ctx.lineWidth = lw; ctx.strokeStyle = ink;
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
  } else if (f.type === 'line') {
    const lw = Math.max(1, b * 0.08);
    ctx.lineWidth = lw; ctx.strokeStyle = ink;
    ctx.strokeRect(ix - lw / 2, iy - lw / 2, iw + lw, ih + lw);
  } else if (f.type === 'film') {
    // 底片：上下兩排齒孔
    const hw = bt * 0.38, hh = bt * 0.46, gap = hw * 0.9, n = Math.max(3, Math.floor((W - gap) / (hw + gap))), start = (W - (n * hw + (n - 1) * gap)) / 2;
    ctx.fillStyle = ink;
    for (let i = 0; i < n; i++) {
      const x = start + i * (hw + gap);
      roundRectPath(ctx, x, (bt - hh) / 2, hw, hh, hw * 0.2); ctx.fill();
      roundRectPath(ctx, x, H - bt + (bt - hh) / 2, hw, hh, hw * 0.2); ctx.fill();
    }
  } else if (f.type === 'corner') {
    // 相角：四個角落各一個 L 形
    const len = b * 1.6, lw = Math.max(2, b * 0.14), o = b * 0.45;
    ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.lineCap = 'square';
    for (const [cx, cy, sx, sy] of [[o, o, 1, 1], [W - o, o, -1, 1], [o, H - o, 1, -1], [W - o, H - o, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx + sx * len, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * len); ctx.stroke();
    }
  }
}

// ── 物件（文字、貼圖）──
const measureCtx = mk(4, 4).getContext('2d');
function objFont(o) {
  if (o.type === 'sticker') return o.size + 'px ' + EMOJI_FONT;
  return (o.bold ? '700 ' : '500 ') + o.size + 'px ' + FONTS[o.font][1];
}
function objBox(o) {
  if (o.type === 'image') return { w: o.size, h: o.size * o.cv.height / o.cv.width };
  measureCtx.font = objFont(o);
  const lines = String(o.text).split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, measureCtx.measureText(l || ' ').width);
  return { w: w + o.size * 0.3, h: lines.length * o.size * 1.25 + o.size * 0.1 };
}
// s 是目前畫布的縮放比例：陰影不受座標變換影響，要自己乘
function drawObject(ctx, o, s) {
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.rot * Math.PI / 180);
  ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
  if (o.type === 'image') {
    const b = objBox(o);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(o.cv, -b.w / 2, -b.h / 2, b.w, b.h);
    ctx.restore();
    return;
  }
  ctx.font = objFont(o);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = String(o.text).split('\n'), lh = o.size * 1.25;
  lines.forEach((l, i) => {
    const y = (i - (lines.length - 1) / 2) * lh;
    if (o.shadow) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = o.size * 0.2 * s; ctx.shadowOffsetY = o.size * 0.07 * s; }
    if (o.type === 'text' && o.stroke) {
      ctx.lineJoin = 'round'; ctx.lineWidth = o.size * 0.14; ctx.strokeStyle = o.strokeColor;
      ctx.strokeText(l, 0, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = o.color || '#000000';
    ctx.fillText(l, 0, y);
    ctx.shadowColor = 'transparent';
  });
  ctx.restore();
}
function hitObject(p) {
  for (let i = P.objects.length - 1; i >= 0; i--) {
    const o = P.objects[i], b = objBox(o), a = -o.rot * Math.PI / 180;
    const dx = p.x - o.x, dy = p.y - o.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) return o;
  }
  return null;
}
function loadFontFor(o) {
  if (o.type !== 'text' || !document.fonts || !document.fonts.load) return;
  document.fonts.load(objFont(o), o.text).then(requestRender, () => {});
}

// ── 算圖：預覽和匯出走同一條路，只差在縮放比例 ──
function renderPhoto(target, maxSide, opts) {
  opts = opts || {};
  const ins = frameInsets(opts.final);
  const fullW = P.base.width + ins.l + ins.r, fullH = P.base.height + ins.t + ins.b;
  const s = opts.scale || (maxSide ? Math.min(1, maxSide / Math.max(fullW, fullH)) : 1);
  const W = Math.max(1, Math.round(fullW * s)), H = Math.max(1, Math.round(fullH * s));
  if (target.width !== W || target.height !== H) { target.width = W; target.height = H; }
  const iw = Math.max(1, Math.round(P.base.width * s)), ih = Math.max(1, Math.round(P.base.height * s));

  let wc = mk(iw, ih), wx = wc.getContext('2d');
  wx.imageSmoothingQuality = 'high';
  wx.drawImage(P.base, 0, 0, iw, ih);
  if (!opts.raw) {
    beautyPass(wc);
    if (P.adj.denoise) denoisePass(wc, P.adj.denoise / 100);
    const st1 = presetStage(P.preset, P.presetAmt / 100), st2 = userStage();
    const sharp = P.adj.sharpen / 100, clar = P.adj.clarity / 100, vib = P.adj.vibrance / 100, hslOn = hslActive().length > 0;
    if (st1 || st2 || sharp || clar || vib || hslOn) {
      const id = wx.getImageData(0, 0, iw, ih), d = id.data;
      if (st1) applyStage(d, st1);
      if (st2) applyStage(d, st2);
      if (vib) applyVibrance(d, vib);
      if (hslOn) applyHsl(d);
      // 清晰度看大範圍的明暗落差，銳利看細小邊緣；做法相同，只差模糊半徑
      for (const [k, radius] of [[clar * 0.7, Math.max(iw, ih) / 45], [sharp * 1.6, Math.max(0.7, Math.max(iw, ih) / 1000)]]) {
        if (!k) continue;
        wx.putImageData(id, 0, 0);
        const bd = blurCanvas(wc, radius).getContext('2d').getImageData(0, 0, iw, ih).data;
        for (let i = 0; i < d.length; i += 4) {
          d[i] += (d[i] - bd[i]) * k; d[i + 1] += (d[i + 1] - bd[i + 1]) * k; d[i + 2] += (d[i + 2] - bd[i + 2]) * k;
        }
      }
      wx.putImageData(id, 0, 0);
    }
    if (P.adj.blur) {
      const bl = blurCanvas(wc, P.adj.blur / 100 * Math.max(iw, ih) / 90);
      // 模糊後邊緣會變半透明，直接疊在原圖上就不會露出底色
      wx.drawImage(bl, 0, 0);
    }
    if (P.cut) { wc = composeCut(wc, iw, ih); wx = wc.getContext('2d'); }
    if (P.fx.type !== 'none') { wc = applyFx(wc, iw, ih); wx = wc.getContext('2d'); }
    if (P.adj.vignette) {
      const diag = Math.hypot(iw, ih) / 2, vg = wx.createRadialGradient(iw / 2, ih / 2, diag * 0.45, iw / 2, ih / 2, diag);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,' + (P.adj.vignette / 100 * 0.8) + ')');
      wx.fillStyle = vg; wx.fillRect(0, 0, iw, ih);
    }
    if (P.adj.grain) {
      wx.save();
      wx.globalCompositeOperation = 'overlay'; wx.globalAlpha = P.adj.grain / 100 * 0.55;
      wx.fillStyle = wx.createPattern(getNoise(), 'repeat'); wx.fillRect(0, 0, iw, ih);
      wx.restore();
    }
    wx.drawImage(P.paint, 0, 0, iw, ih);
  }

  const ctx = target.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const ix = Math.round(ins.l * s), iy = Math.round(ins.t * s);
  if (ins.l > 0) drawFramed(ctx, wc, W, H, ix, iy, iw, ih, Math.round(ins.l * s), Math.round(ins.t * s));
  else ctx.drawImage(wc, ix, iy);
  if (opts.raw) return;
  if (!opts.final && P.mark && P.tool === 'remove') {
    ctx.save(); ctx.globalAlpha = 0.55; ctx.drawImage(P.mark, ix, iy, iw, ih); ctx.restore();
  }

  ctx.save();
  ctx.translate(ix, iy); ctx.scale(s, s);
  for (const o of P.objects) drawObject(ctx, o, s);
  if (!opts.final && P.sel) {
    const o = P.sel, b = objBox(o);
    ctx.translate(o.x, o.y); ctx.rotate(o.rot * Math.PI / 180);
    ctx.lineWidth = 2 / s; ctx.setLineDash([8 / s, 6 / s]);
    ctx.strokeStyle = '#ffffff'; ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.lineDashOffset = 7 / s; ctx.strokeStyle = '#ff5d8f'; ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
  }
  ctx.restore();
}

let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!P.base) return;
    // 放大檢視時預覽也算細一點，才看得清楚細節
    renderPhoto(PV, Math.min(2400, PREVIEW_MAX * P.zoom), { raw: P.compare });
    fit(PV, P.zoom);
    $('#photoInfo').textContent = P.base.width + ' × ' + P.base.height + ' 像素';
  });
}

// ── 幾何：裁切、旋轉、翻轉 ──
function transformAll(nw, nh, draw, mapPoint, rotDelta) {
  pushHistory();
  const apply = src => { const c = mk(nw, nh), x = c.getContext('2d'); draw(x); x.drawImage(src, 0, 0); return c; };
  P.base = apply(P.base);
  P.paint = apply(P.paint);
  if (P.cut) P.cut.mask = apply(P.cut.mask);
  P.mark = null;
  for (const o of P.objects) { const p = mapPoint(o.x, o.y); o.x = p[0]; o.y = p[1]; o.rot += rotDelta || 0; }
  P.crop = { x: 0, y: 0, w: 1, h: 1 };
  syncCropBox();
  requestRender();
}
function rotate90(cw) {
  const w = P.base.width, hh = P.base.height;
  if (cw) transformAll(hh, w, x => { x.translate(hh, 0); x.rotate(Math.PI / 2); }, (px, py) => [hh - py, px], 90);
  else transformAll(hh, w, x => { x.translate(0, w); x.rotate(-Math.PI / 2); }, (px, py) => [py, w - px], -90);
}
function flip(horizontal) {
  const w = P.base.width, hh = P.base.height;
  if (horizontal) transformAll(w, hh, x => { x.translate(w, 0); x.scale(-1, 1); }, (px, py) => [w - px, py]);
  else transformAll(w, hh, x => { x.translate(0, hh); x.scale(1, -1); }, (px, py) => [px, hh - py]);
}
// 轉一個小角度並放大到剛好沒有空白角落
function rotatedFill(src, deg) {
  const w = src.width, hh = src.height, a = deg * Math.PI / 180;
  const z = Math.cos(Math.abs(a)) + Math.max(w / hh, hh / w) * Math.sin(Math.abs(a));
  const c = mk(w, hh), x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.translate(w / 2, hh / 2); x.rotate(a); x.scale(z, z);
  x.drawImage(src, -w / 2, -hh / 2);
  return c;
}
// 把解析度放大（像素變多，方便之後放大輸出或裁切），文字、貼圖跟著等比例放大
function upscalePhoto() {
  const w = P.base.width, hh = P.base.height, k = Math.min(2, UPSCALE_MAX / Math.max(w, hh));
  if (k < 1.05) { toast('已經是可處理的最大解析度了'); return; }
  transformAll(Math.round(w * k), Math.round(hh * k), x => { x.imageSmoothingQuality = 'high'; x.scale(k, k); }, (px, py) => [px * k, py * k]);
  for (const o of P.objects) o.size *= k;
  showTool('adjust');
  toast('解析度已放大到 ' + P.base.width + ' × ' + P.base.height + '，可以再加一點「銳利」');
}
function applyCrop() {
  const c = P.crop, w = P.base.width, hh = P.base.height;
  const cx = Math.round(c.x * w), cy = Math.round(c.y * hh), cw = Math.max(8, Math.round(c.w * w)), ch = Math.max(8, Math.round(c.h * hh));
  if (cw >= w && ch >= hh) { toast('先拖曳裁切框選出要保留的範圍'); return; }
  transformAll(cw, ch, x => x.translate(-cx, -cy), (px, py) => [px - cx, py - cy]);
  toast('已裁切');
}
function setCropRatio(r) {
  P.cropRatio = r;
  if (!r) { P.crop = { x: 0, y: 0, w: 1, h: 1 }; syncCropBox(); return; }
  const w = P.base.width, hh = P.base.height;
  let cw = w, ch = w / r;
  if (ch > hh) { ch = hh; cw = hh * r; }
  P.crop = { x: (w - cw) / 2 / w, y: (hh - ch) / 2 / hh, w: cw / w, h: ch / hh };
  syncCropBox();
}
function syncCropBox() {
  const box = $('#cropBox');
  box.hidden = P.tool !== 'crop';
  const c = P.crop;
  box.style.left = c.x * 100 + '%'; box.style.top = c.y * 100 + '%';
  box.style.width = c.w * 100 + '%'; box.style.height = c.h * 100 + '%';
}
$('#cropBox').addEventListener('pointerdown', e0 => {
  e0.preventDefault();
  const kind = e0.target.dataset.h || 'move', start = { ...P.crop }, rect = PV.getBoundingClientRect();
  const bw = P.base.width, bh = P.base.height, ratio = P.cropRatio, MIN = 0.05;
  const move = e => {
    const dx = (e.clientX - e0.clientX) / rect.width, dy = (e.clientY - e0.clientY) / rect.height;
    if (kind === 'move') {
      P.crop = { ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) };
    } else {
      let x0 = start.x, y0 = start.y, x1 = start.x + start.w, y1 = start.y + start.h;
      const west = kind.includes('w'), north = kind.includes('n');
      if (west) x0 = clamp(x0 + dx, 0, x1 - MIN); else x1 = clamp(x1 + dx, x0 + MIN, 1);
      if (north) y0 = clamp(y0 + dy, 0, y1 - MIN); else y1 = clamp(y1 + dy, y0 + MIN, 1);
      if (ratio) {
        let hf = (x1 - x0) * bw / ratio / bh;
        const room = north ? y1 : 1 - y0;
        if (hf > room) {
          hf = room;
          const wf = hf * bh * ratio / bw;
          if (west) x0 = x1 - wf; else x1 = x0 + wf;
        }
        if (north) y0 = y1 - hf; else y1 = y0 + hf;
      }
      P.crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    syncCropBox();
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

// ── 筆刷：塗鴉、馬賽克、橡皮擦、瘦臉推移 ──
function activeBrush() {
  if (P.tool === 'brush') return P.brushMode;
  if (P.tool === 'retouch') return 'retouch';
  if (P.tool === 'remove') return 'mark';
  if (P.tool === 'cutout' && P.cut && P.maskBrush) return P.maskBrush;
  if (P.tool === 'beauty' && P.liqOn) return 'liquify';
  return null;
}
const BRUSH_RANGE = { doodle: [.004, .06], mosaic: [.015, .18], erase: [.015, .18], liquify: [.05, .4], retouch: [.02, .32], mask: [.01, .2], mark: [.015, .25] };
function brushPx(br) {
  const key = br === 'maskAdd' || br === 'maskErase' ? 'mask' : br;
  const [a, b] = BRUSH_RANGE[key], m = Math.min(P.base.width, P.base.height);
  return m * (a + (b - a) * P.brushSize[key] / 100);
}
function pixelate(src) {
  const block = Math.max(6, Math.round(Math.max(src.width, src.height) / 80));
  const small = mk(src.width / block, src.height / block);
  small.getContext('2d').drawImage(src, 0, 0, small.width, small.height);
  const out = mk(src.width, src.height), x = out.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(small, 0, 0, out.width, out.height);
  return out;
}
let mosaicSrc = null;
function startStroke(br, p) {
  if (br === 'retouch') { retouchStart(p); return; }
  if (br === 'mark') {
    // 標記不算一步編輯，不進復原紀錄
    if (!P.mark || P.mark.width !== P.base.width || P.mark.height !== P.base.height) P.mark = mk(P.base.width, P.base.height);
    stroke(br, p, p);
    return;
  }
  if (br === 'maskAdd' || br === 'maskErase') {
    pushHistory();
    P.cut.mask = cloneCanvas(P.cut.mask);
    stroke(br, p, p);
    return;
  }
  pushHistory();
  if (br === 'doodle' || br === 'erase') P.paint = cloneCanvas(P.paint);
  else {
    if (br === 'mosaic') mosaicSrc = pixelate(P.base);
    P.base = cloneCanvas(P.base);
  }
  stroke(br, p, p);
}
function stroke(br, a, b) {
  if (br === 'retouch') { retouchDab(a, b); return; }
  const d = brushPx(br);
  if (br === 'mark' || br === 'maskAdd' || br === 'maskErase') {
    const x = (br === 'mark' ? P.mark : P.cut.mask).getContext('2d');
    x.save();
    x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = d;
    if (br === 'maskErase') x.globalCompositeOperation = 'destination-out';
    x.strokeStyle = br === 'mark' ? '#ff3c5a' : '#ffffff';
    x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x + 0.01, b.y + 0.01); x.stroke();
    x.restore();
    return;
  }
  if (br === 'liquify') { warp(P.base, a, b, d / 2, P.liqStrength / 100); return; }
  const ctx = (br === 'mosaic' ? P.base : P.paint).getContext('2d');
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = d;
  if (br === 'erase') ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = br === 'mosaic' ? ctx.createPattern(mosaicSrc, 'no-repeat') : P.brushColor;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x + 0.01, b.y + 0.01); ctx.stroke();
  ctx.restore();
}
// 把半徑 R 內的像素沿拖曳方向推移，越靠中心推得越多
function warp(cv, from, to, R, k) {
  let dx = (to.x - from.x) * k, dy = (to.y - from.y) * k;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return;
  if (len > R * 0.5) { dx *= R * 0.5 / len; dy *= R * 0.5 / len; }
  const x0 = Math.max(0, Math.floor(to.x - R)), y0 = Math.max(0, Math.floor(to.y - R));
  const x1 = Math.min(cv.width, Math.ceil(to.x + R)), y1 = Math.min(cv.height, Math.ceil(to.y + R));
  const rw = x1 - x0, rh = y1 - y0;
  if (rw < 2 || rh < 2) return;
  const ctx = cv.getContext('2d'), src = ctx.getImageData(x0, y0, rw, rh), dst = ctx.createImageData(rw, rh);
  const s = src.data, o = dst.data, R2 = R * R;
  o.set(s);
  for (let y = 0; y < rh; y++) {
    const py = y + y0 - to.y;
    for (let x = 0; x < rw; x++) {
      const px = x + x0 - to.x, d2 = px * px + py * py;
      if (d2 >= R2) continue;
      let f = 1 - d2 / R2; f *= f;
      const sx = clamp(x - dx * f, 0, rw - 1.001), sy = clamp(y - dy * f, 0, rh - 1.001);
      const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy;
      const i00 = (iy * rw + ix) * 4, i10 = i00 + 4, i01 = i00 + rw * 4, i11 = i01 + 4, oi = (y * rw + x) * 4;
      for (let c = 0; c < 4; c++) {
        o[oi + c] = (s[i00 + c] * (1 - fx) + s[i10 + c] * fx) * (1 - fy) + (s[i01 + c] * (1 - fx) + s[i11 + c] * fx) * fy;
      }
    }
  }
  ctx.putImageData(dst, x0, y0);
}

// ── 細修：用筆刷塗到哪裡，效果就只作用在哪裡 ──
// 做法：下筆時先把整張圖算出「套用效果後」的版本，再依塗抹的範圍（遮罩）把它疊回原圖
const RETOUCH_FX = [
  ['brighten', '提亮', { exposure: .45 }], ['darken', '壓暗', { exposure: -.45 }],
  ['vivid', '增豔', { saturation: .7 }], ['mute', '淡色', { saturation: -.85 }],
  ['warm', '暖色', { temp: .9, tint: .1 }], ['cool', '冷色', { temp: -.9 }],
  ['contrast', '加對比', { contrast: .5 }],
  ['whiten', '牙齒美白', { saturation: -.75, exposure: .3 }], ['eyes', '亮眼', { contrast: .45, exposure: .22, saturation: .25 }], ['blur', '模糊', null], ['sharpen', '銳化', null],
  ['heal', '柔膚去斑', null], ['clone', '仿製（蓋掉雜物）', null]
];
const RT = { fx: 'brighten', strength: 60, src: null, picking: false, orig: null, fxCv: null, mask: null, tmp: null, box: null };
function makeRetouchFx(src, p) {
  const s = RT.strength / 100, w = src.width, hh = src.height, d = brushPx('retouch');
  const onTop = layer => { const c = cloneCanvas(src); c.getContext('2d').drawImage(layer, 0, 0); return c; };
  if (RT.fx === 'clone') {
    const c = mk(w, hh), x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    x.drawImage(src, p.x - RT.src.x, p.y - RT.src.y);
    return c;
  }
  if (RT.fx === 'blur') return onTop(blurCanvas(src, Math.max(2, d * 0.15 * (0.3 + s))));
  if (RT.fx === 'heal') return onTop(blurCanvas(src, Math.max(2, d * 0.3)));
  const c = cloneCanvas(src), x = c.getContext('2d'), id = x.getImageData(0, 0, w, hh), px = id.data;
  if (RT.fx === 'sharpen') {
    const bd = blurCanvas(src, Math.max(0.8, Math.max(w, hh) / 1200)).getContext('2d').getImageData(0, 0, w, hh).data, k = 0.6 + s * 2.4;
    for (let i = 0; i < px.length; i += 4) {
      px[i] += (px[i] - bd[i]) * k; px[i + 1] += (px[i + 1] - bd[i + 1]) * k; px[i + 2] += (px[i + 2] - bd[i + 2]) * k;
    }
  } else {
    const def = RETOUCH_FX.find(f => f[0] === RT.fx)[2], a = {};
    for (const key in def) a[key] = def[key] * (0.25 + s * 0.75);
    applyStage(px, buildStage(a));
  }
  x.putImageData(id, 0, 0);
  return c;
}
function retouchStart(p) {
  RT.orig = P.base;
  pushHistory();
  P.base = cloneCanvas(RT.orig);
  RT.mask = mk(RT.orig.width, RT.orig.height);
  RT.tmp = mk(RT.orig.width, RT.orig.height);
  RT.fxCv = makeRetouchFx(RT.orig, p);
  RT.box = null;
  retouchDab(p, p);
}
function retouchDab(a, b) {
  if (!RT.mask) return;
  const r = brushPx('retouch') / 2, m = RT.mask.getContext('2d');
  const solid = RT.fx === 'clone' || RT.fx === 'heal', flow = solid ? 0.9 : 0.45;
  const dist = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(dist / (r * 0.3)));
  for (let i = 0; i <= steps; i++) {
    const x = a.x + (b.x - a.x) * i / steps, y = a.y + (b.y - a.y) * i / steps;
    const g = m.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,' + flow + ')');
    g.addColorStop(solid ? 0.6 : 0.3, 'rgba(255,255,255,' + flow + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    m.fillStyle = g;
    m.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // 只重畫塗過的範圍，大圖才不會卡
  const W = RT.mask.width, H = RT.mask.height, bx = RT.box || { x0: W, y0: H, x1: 0, y1: 0 };
  bx.x0 = Math.max(0, Math.floor(Math.min(bx.x0, a.x - r, b.x - r))); bx.y0 = Math.max(0, Math.floor(Math.min(bx.y0, a.y - r, b.y - r)));
  bx.x1 = Math.min(W, Math.ceil(Math.max(bx.x1, a.x + r, b.x + r))); bx.y1 = Math.min(H, Math.ceil(Math.max(bx.y1, a.y + r, b.y + r)));
  RT.box = bx;
  const bw = bx.x1 - bx.x0, bh = bx.y1 - bx.y0;
  if (bw <= 0 || bh <= 0) return;
  const t = RT.tmp.getContext('2d');
  t.globalCompositeOperation = 'source-over';
  t.clearRect(bx.x0, bx.y0, bw, bh);
  t.drawImage(RT.fxCv, bx.x0, bx.y0, bw, bh, bx.x0, bx.y0, bw, bh);
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(RT.mask, bx.x0, bx.y0, bw, bh, bx.x0, bx.y0, bw, bh);
  t.globalCompositeOperation = 'source-over';
  const o = P.base.getContext('2d');
  o.drawImage(RT.orig, bx.x0, bx.y0, bw, bh, bx.x0, bx.y0, bw, bh);
  o.drawImage(RT.tmp, bx.x0, bx.y0, bw, bh, bx.x0, bx.y0, bw, bh);
}
function retouchEnd() {
  RT.orig = RT.fxCv = RT.mask = RT.tmp = RT.box = null;
}

// ── 畫布上的指標操作 ──
function toBase(e) {
  const r = PV.getBoundingClientRect(), ins = frameInsets();
  const k = (P.base.width + ins.l + ins.r) / r.width;
  return { x: (e.clientX - r.left) * k - ins.l, y: (e.clientY - r.top) * k - ins.t, k };
}
let drag = null;
PV.addEventListener('pointerdown', e => {
  if (!P.base || P.tool === 'crop') return;
  const p = toBase(e), br = activeBrush();
  PV.setPointerCapture(e.pointerId);
  if (P.tool === 'adjust' && P.hslPick) {
    // 選色的吸管：點哪裡就選那個位置的色系
    const x = clamp(Math.round(p.x), 0, P.base.width - 1), y = clamp(Math.round(p.y), 0, P.base.height - 1);
    const d = P.base.getContext('2d').getImageData(x, y, 1, 1).data, key = hslBandOf(d[0], d[1], d[2]);
    P.hslPick = false;
    if (key) { P.hslBand = key; P.open.hsl = true; toast('已選「' + HSL_BANDS.find(b => b[0] === key)[1] + '色」，用下面的滑桿調整'); }
    else toast('這個位置接近黑白灰，沒有顏色可以調。換一個顏色明顯的地方再點');
    showTool('adjust');
    return;
  }
  if (br === 'retouch' && RT.fx === 'clone' && (RT.picking || !RT.src)) {
    // 仿製筆：這一下是在指定「從哪裡複製」
    RT.src = { x: p.x, y: p.y }; RT.picking = false;
    showTool('retouch');
    toast('取樣點設好了，現在到要蓋掉的地方塗抹');
    return;
  }
  if (br) { startStroke(br, p); drag = { type: 'brush', br, last: p }; requestRender(); return; }
  const o = hitObject(p);
  if (o) {
    drag = { type: 'obj', o, dx: p.x - o.x, dy: p.y - o.y, moved: false };
    if (P.sel !== o) { P.sel = o; showTool(o.type === 'text' ? 'text' : 'sticker'); }
  } else {
    drag = null;
    if (P.sel) { P.sel = null; showTool(P.tool); }
  }
  requestRender();
});
PV.addEventListener('pointermove', e => {
  if (!P.base) return;
  const p = toBase(e), br = activeBrush(), ring = $('#brushRing');
  if (br) {
    const wr = PV.parentElement.getBoundingClientRect(), d = brushPx(br) / p.k;
    ring.hidden = false;
    ring.style.left = e.clientX - wr.left + 'px'; ring.style.top = e.clientY - wr.top + 'px';
    ring.style.width = ring.style.height = d + 'px';
  } else ring.hidden = true;
  if (!drag) return;
  if (drag.type === 'brush') { stroke(drag.br, drag.last, p); drag.last = p; }
  else {
    if (!drag.moved) { pushHistory(); drag.moved = true; }
    drag.o.x = p.x - drag.dx; drag.o.y = p.y - drag.dy;
  }
  requestRender();
});
const endDrag = () => { drag = null; retouchEnd(); };
PV.addEventListener('pointerup', endDrag);
PV.addEventListener('pointercancel', endDrag);
PV.addEventListener('pointerleave', () => { $('#brushRing').hidden = true; });

const cmp = $('#compareBtn');
const setCompare = on => { if (P.compare !== on) { P.compare = on; requestRender(); } };
cmp.addEventListener('pointerdown', () => setCompare(true));
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => cmp.addEventListener(ev, () => setCompare(false)));

// ── 右側設定面板 ──
function addObject(o) {
  pushHistory();
  P.objects.push(o);
  P.sel = o;
  loadFontFor(o);
  showTool(o.type === 'text' ? 'text' : 'sticker');
  requestRender();
  if (o.type === 'text') selectAllIn('#textEdit');
}
function deleteSelected() {
  if (!P.sel) return;
  pushHistory();
  P.objects = P.objects.filter(o => o !== P.sel);
  P.sel = null;
  showTool(P.tool);
  requestRender();
}
function objSliders(el, o) {
  const m = Math.min(P.base.width, P.base.height), name = { text: '文字', sticker: '貼圖', image: '圖片' }[o.type];
  slider(el, { label: '大小', min: 2, max: o.type === 'image' ? 150 : 60, value: Math.round(o.size / m * 100), onStart: pushHistory, onInput: v => { o.size = m * v / 100; requestRender(); } });
  slider(el, { label: '旋轉', min: -180, max: 180, value: Math.round(((o.rot + 180) % 360 + 360) % 360 - 180), def: 0, fmt: v => v + '°', onStart: pushHistory, onInput: v => { o.rot = v; requestRender(); } });
  slider(el, { label: '不透明度', min: 10, max: 100, value: Math.round((o.alpha == null ? 1 : o.alpha) * 100), def: 100, fmt: v => v + '%', onStart: pushHistory, onInput: v => { o.alpha = v / 100; requestRender(); } });
  el.append(h('button', { class: 'btn danger wide', text: '刪除這個' + name, onclick: deleteSelected }));
}
// 自動調整：量照片的明暗分布和色偏，換算成滑桿數值（只動滑桿，不改原圖）
function autoAdjust() {
  const s = Math.min(1, 200 / Math.max(P.base.width, P.base.height));
  const c = mk(P.base.width * s, P.base.height * s), x = c.getContext('2d');
  x.drawImage(P.base, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data, n = d.length / 4, hist = new Uint32Array(256);
  let sr = 0, sg = 0, sb = 0, sl = 0, ssat = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], l = 0.299 * r + 0.587 * g + 0.114 * b, mx = Math.max(r, g, b);
    hist[l | 0]++; sr += r; sg += g; sb += b; sl += l;
    ssat += mx ? (mx - Math.min(r, g, b)) / mx : 0;
  }
  const pct = p => { let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * p) return i / 255; } return 1; };
  const lo = pct(0.01), hi = pct(0.99), mean = sl / n / 255, sat = ssat / n;
  const lim = (v, a) => Math.round(clamp(v, -a, a));
  pushHistory();
  resetAdj();
  // 明暗：把最暗到最亮的範圍拉開（最多 1.7 倍），中間調往正中間靠六成。
  // 換算成滑桿：對比負責拉開的倍率，亮度負責平移
  const m = 1 + (Math.min(0.96 / Math.max(0.05, hi - lo), 1.8) - 1) * 0.85;
  const mid = (lo + hi) / 2, tmid = mid + (0.5 - mid) * 0.6;
  P.adj.contrast = lim((m - 1) / 1.5 * 100, 60);
  P.adj.brightness = lim(((tmid - m * mid - 0.5) / m + 0.5) / 0.35 * 100, 100);
  const newMean = m * (mean - mid) + tmid;
  if (newMean < 0.42) P.adj.shadows = lim((0.45 - newMean) * 220, 45);
  if (hi > 0.97 && newMean > 0.6) P.adj.highlights = -20;
  // 色偏：只在紅藍明顯失衡時修，而且只拉回四分之一，免得把夕陽、藍天這類本來就偏色的照片修壞。
  // 拉開對比會連帶放大色偏，所以直接用縮圖試算，找出能達到目標紅藍比的色溫
  if (sr > 0 && sb > 0 && Math.abs(Math.log(sr / sb)) > 0.25) {
    const target = Math.pow(sr / sb, 0.75), tmp = new Uint8ClampedArray(d.length);
    const ratioAt = temp => {
      tmp.set(d);
      applyStage(tmp, buildStage({ brightness: P.adj.brightness / 100, contrast: P.adj.contrast / 100, shadows: P.adj.shadows / 100, highlights: P.adj.highlights / 100, temp: temp / 100 }));
      let r = 0, bl = 0;
      for (let i = 0; i < tmp.length; i += 4) { r += tmp[i]; bl += tmp[i + 2]; }
      return r / Math.max(1, bl);
    };
    let low = -40, high = 40;
    for (let i = 0; i < 8; i++) { const t = (low + high) / 2; if (ratioAt(t) < target) low = t; else high = t; }
    P.adj.temp = Math.round((low + high) / 2);
  }
  if (sat < 0.35) P.adj.vibrance = 20;
  P.adj.clarity = 10;
  showTool('adjust');
  requestRender();
  toast('已自動調整，可以再用滑桿微調');
}
const PANELS = {
  adjust(el) {
    el.append(h('h2', { text: '調整' }));
    el.append(h('button', { class: 'btn primary wide', text: '自動調整', onclick: autoAdjust }));
    el.append(h('p', { text: '自動調整會依照片的明暗和色偏設定下面的滑桿，之後可以再微調。在滑桿上點兩下可以歸零。' }));
    for (const [gid, title, keys] of ADJ_GROUPS) {
      const body = h('div', { class: 'group-body' });
      for (const k of keys) {
        const [, label, min, max] = ADJ.find(a => a[0] === k);
        slider(body, { label, min, max, value: P.adj[k], def: 0, onStart: pushHistory, onInput: v => { P.adj[k] = v; requestRender(); } });
      }
      if (gid === 'quality') {
        body.append(h('h3', { text: '匯出畫質（JPG、WebP）' }));
        chips(body, QUALITY_PRESETS, EXP.photo.q, v => { EXP.photo.q = v; saveExp(); });
        body.append(h('button', { class: 'btn wide', text: '解析度放大 2 倍', onclick: upscalePhoto }));
        body.append(h('p', { text: '目前 ' + P.base.width + ' × ' + P.base.height + ' 像素。放大能讓輸出尺寸變大，但不會多出原圖沒有的細節。' }));
      }
      const box = h('details', { class: 'group', open: P.open[gid] }, h('summary', { text: title }), body);
      box.addEventListener('toggle', () => { P.open[gid] = box.open; });
      el.append(box);
    }
    {
      const body = h('div', { class: 'group-body' });
      // 只列出這張照片裡真的有的顏色（加上已經調過的），色塊用照片裡那個色系的平均色
      const seen = hslPresent(), list = seen.slice();
      for (const b of hslActive()) if (!list.some(it => it.key === b[0])) list.push({ key: b[0], name: b[1], share: 0, color: b[3] });
      if (!list.some(it => it.key === P.hslBand) && list.length) P.hslBand = list[0].key;
      const band = P.hslBand;
      const cur = () => P.hsl[P.hslBand] || (P.hsl[P.hslBand] = { h: 0, s: 0, l: 0 });
      if (!list.length) body.append(h('p', { text: '這張照片幾乎是黑白灰，沒有明顯的顏色可以單獨調整。' }));
      else {
        body.append(h('div', { class: 'inline' }, list.map(it => h('button', {
          class: 'swatch big', style: 'background:' + it.color, 'aria-pressed': String(it.key === band),
          'aria-label': it.name + '色', title: it.name + '色' + (it.share ? '，約佔畫面 ' + Math.max(1, Math.round(it.share * 100)) + '%' : ''),
          onclick: () => { P.hslBand = it.key; showTool('adjust'); }
        }))));
        body.append(h('button', {
          class: 'btn wide', 'aria-pressed': String(!!P.hslPick), text: P.hslPick ? '請在照片上點要調的顏色' : '在照片上點一下選顏色',
          onclick: () => { P.hslPick = !P.hslPick; showTool('adjust'); }
        }));
        const v = P.hsl[band] || { h: 0, s: 0, l: 0 }, name = HSL_BANDS.find(b => b[0] === band)[1];
        for (const [key, label] of [['h', '色相'], ['s', '飽和度'], ['l', '明度']]) {
          slider(body, { label: name + '色的' + label, min: -100, max: 100, value: v[key], def: 0, onStart: pushHistory, onInput: n => { cur()[key] = n; requestRender(); } });
        }
        body.append(h('p', { text: '色塊是這張照片裡實際出現的顏色，越前面佔的面積越大。選一個再調它的色相、飽和度、明度，其他顏色不會變。' }));
      }
      const box = h('details', { class: 'group', open: P.open.hsl }, h('summary', { text: '選色（只調某一種顏色）' }), body);
      box.addEventListener('toggle', () => { P.open.hsl = box.open; });
      el.append(box);
    }
    el.append(h('button', { class: 'btn wide', text: '恢復預設', onclick: () => { pushHistory(); resetAdj(); P.hsl = {}; showTool('adjust'); requestRender(); } }));
  },
  filter(el) {
    el.append(h('h2', { text: '濾鏡' }));
    const grid = h('div', { class: 'thumbs' });
    const side = Math.min(P.base.width, P.base.height), tsrc = mk(96, 96);
    tsrc.getContext('2d').drawImage(P.base, (P.base.width - side) / 2, (P.base.height - side) / 2, side, side, 0, 0, 96, 96);
    for (const [key, label] of PRESETS) {
      const c = cloneCanvas(tsrc), st = presetStage(key, 1);
      if (st) { const x = c.getContext('2d'), id = x.getImageData(0, 0, 96, 96); applyStage(id.data, st); x.putImageData(id, 0, 0); }
      grid.append(h('button', {
        'aria-pressed': String(P.preset === key),
        onclick: () => { pushHistory(); P.preset = key; showTool('filter'); requestRender(); }
      }, c, h('span', { text: label })));
    }
    el.append(grid);
    if (P.preset !== 'none') slider(el, { label: '濾鏡強度', min: 0, max: 100, value: P.presetAmt, def: 100, onStart: pushHistory, onInput: v => { P.presetAmt = v; requestRender(); } });
    el.append(h('hr'), h('h3', { text: '特效' }));
    chips(el, PHOTO_FX, P.fx.type, v => { pushHistory(); P.fx.type = v; showTool('filter'); requestRender(); });
    if (P.fx.type !== 'none' && P.fx.type !== 'mirror') slider(el, { label: '特效強度', min: 0, max: 100, value: P.fx.amt, def: 60, onStart: pushHistory, onInput: v => { P.fx.amt = v; requestRender(); } });
  },
  beauty(el) {
    el.append(h('h2', { text: '美顏' }));
    for (const [k, label] of [['smooth', '磨皮'], ['whiten', '美白'], ['rosy', '紅潤']]) {
      slider(el, { label, min: 0, max: 100, value: P.beauty[k], def: 0, onStart: pushHistory, onInput: v => { P.beauty[k] = v; requestRender(); } });
    }
    el.append(h('hr'), h('h3', { text: '瘦臉、修身' }));
    el.append(h('button', {
      class: 'btn wide', 'aria-pressed': String(P.liqOn), text: P.liqOn ? '推移筆：使用中' : '開啟推移筆',
      onclick: () => { P.liqOn = !P.liqOn; showTool('beauty'); }
    }));
    if (P.liqOn) {
      el.append(h('p', { text: '在臉頰或腰線外側按住，往內慢慢拖。推過頭可以按「復原」。' }));
      slider(el, { label: '筆刷大小', min: 1, max: 100, value: P.brushSize.liquify, onInput: v => { P.brushSize.liquify = v; } });
      slider(el, { label: '力道', min: 5, max: 100, value: P.liqStrength, onInput: v => { P.liqStrength = v; } });
    }
  },
  retouch(el) {
    el.append(h('h2', { text: '細修' }), h('p', { text: '選一種效果，在照片上塗抹：人物、物品、天空、背景，塗到哪裡就只改哪裡。' }));
    chips(el, RETOUCH_FX.map(f => [f[0], f[1]]), RT.fx, v => { RT.fx = v; RT.picking = false; showTool('retouch'); });
    slider(el, { label: '筆刷大小', min: 1, max: 100, value: P.brushSize.retouch, onInput: v => { P.brushSize.retouch = v; } });
    if (RT.fx === 'clone') {
      el.append(h('p', { text: RT.src && !RT.picking ? '取樣點已設定。在要蓋掉的地方塗抹，會把取樣點附近的畫面複製過去。' : '先在照片上點一下「要複製的乾淨區域」（例如雜物旁邊的牆面或草地）。' }));
      if (RT.src) el.append(h('button', { class: 'btn wide', 'aria-pressed': String(RT.picking), text: RT.picking ? '請在照片上點新的取樣點' : '重新選取樣點', onclick: () => { RT.picking = !RT.picking; showTool('retouch'); } }));
    } else if (RT.fx === 'heal') {
      el.append(h('p', { text: '在痘痘、斑點、細紋上輕點或塗抹。筆刷調到比斑點大一點效果最好。' }));
    } else {
      slider(el, { label: '強度', min: 5, max: 100, value: RT.strength, onInput: v => { RT.strength = v; } });
      el.append(h('p', { text: '同一個地方多塗幾次效果會加重。塗過頭可以按「復原」。' }));
    }
  },
  cutout(el) {
    el.append(h('h2', { text: '去背與換背景' }));
    if (!P.cut) {
      el.append(h('p', { text: '自動找出照片的主體，把背景去掉。之後可以換成純色、漸層、其他照片，或把原背景模糊。' }));
      el.append(h('h3', { text: '照片的主體是' }));
      chips(el, AI_MATTE_MODELS, P.cutModel, v => { P.cutModel = v; });
      el.append(h('button', { class: 'btn primary wide', text: '一鍵去背', onclick: runCutout }));
      el.append(h('p', { text: '第一次使用要下載 AI 模型，之後就不用了。照片只在你的裝置上處理。' }));
      return;
    }
    const c = P.cut, bg = c.bg, redraw = () => requestRender();
    el.append(h('h3', { text: '背景' }));
    chips(el, [['transparent', '透明'], ['color', '純色'], ['gradient', '漸層'], ['image', '換成照片'], ['blur', '模糊原背景'], ['gray', '背景變黑白']], bg.type, v => { pushHistory(); bg.type = v; showTool('cutout'); redraw(); });
    if (bg.type === 'transparent') el.append(h('p', { text: '匯出時選 PNG 才能保留透明背景。' }));
    if (bg.type === 'color' || bg.type === 'gradient') {
      el.append(h('h3', { text: bg.type === 'color' ? '背景顏色（白、藍、紅是證件照常用底色）' : '上方顏色' }));
      swatches(el, ['#ffffff', '#438edb', '#d9363e', '#1a1a1a', '#f3e9dc', '#ffd9e4'], bg.color, v => { bg.color = v; redraw(); });
    }
    if (bg.type === 'gradient') {
      el.append(h('h3', { text: '下方顏色' }));
      swatches(el, ['#62d2c6', '#ff5d8f', '#ffd24a', '#6b8cff', '#ffffff', '#1a1a1a'], bg.color2, v => { bg.color2 = v; redraw(); });
    }
    if (bg.type === 'image') {
      el.append(h('button', {
        class: 'btn wide', text: bg.img ? '換一張背景照片' : '選背景照片', onclick: async () => {
          const [f] = await pickFiles($('#fileImg'));
          if (!f) return;
          try { pushHistory(); bg.img = await fileToCanvas(f, 3000); showTool('cutout'); redraw(); } catch (e) { toast('無法讀取 ' + f.name); }
        }
      }));
    }
    if (bg.type === 'blur') slider(el, { label: '模糊程度', min: 5, max: 100, value: bg.blur, def: 50, onStart: pushHistory, onInput: v => { bg.blur = v; redraw(); } });
    slider(el, { label: '邊緣柔化', min: 0, max: 10, step: 0.5, value: c.feather, def: 1, onStart: pushHistory, onInput: v => { c.feather = v; redraw(); } });
    el.append(h('hr'), h('h3', { text: '修邊（去得不乾淨時用）' }));
    chips(el, [['', '不修'], ['maskAdd', '塗回主體'], ['maskErase', '擦掉多餘']], P.maskBrush, v => { P.maskBrush = v; showTool('cutout'); });
    if (P.maskBrush) slider(el, { label: '筆刷大小', min: 1, max: 100, value: P.brushSize.mask, onInput: v => { P.brushSize.mask = v; } });
    el.append(h('hr'));
    el.append(h('div', { class: 'chips' },
      h('button', { class: 'btn', text: '重新去背', onclick: runCutout }),
      h('button', { class: 'btn danger', text: '取消去背', onclick: () => { pushHistory(); P.cut = null; P.maskBrush = ''; showTool('cutout'); redraw(); } })));
    chips(el, AI_MATTE_MODELS, P.cutModel, v => { P.cutModel = v; });
  },
  remove(el) {
    el.append(h('h2', { text: '清除物件' }));
    el.append(h('p', { text: '把不要的路人、雜物、電線塗成紅色，再按下面的按鈕，會自動補上背景。塗的時候把整個東西連同影子都蓋住，效果最好。' }));
    slider(el, { label: '筆刷大小', min: 1, max: 100, value: P.brushSize.mark, onInput: v => { P.brushSize.mark = v; } });
    el.append(h('button', { class: 'btn primary wide', text: '清除塗紅的地方', onclick: runRemove }));
    el.append(h('button', { class: 'btn wide', text: '重新塗（清掉紅色標記）', onclick: () => { P.mark = null; requestRender(); } }));
    el.append(h('p', { text: '第一次使用要下載約 208MB 的 AI 模型；每次清除大約需要半分鐘。一次清一樣東西，結果會比一次清很多樣好。' }));
  },
  crop(el) {
    el.append(h('h2', { text: '裁切與旋轉' }), h('h3', { text: '比例' }));
    chips(el, [[0, '自由'], [1, '1:1'], [4 / 3, '4:3'], [3 / 4, '3:4'], [16 / 9, '16:9'], [9 / 16, '9:16']], P.cropRatio, setCropRatio);
    el.append(h('button', { class: 'btn primary wide', text: '套用裁切', onclick: applyCrop }));
    el.append(h('hr'), h('h3', { text: '旋轉、翻轉' }));
    el.append(h('div', { class: 'chips' },
      h('button', { class: 'btn', text: '向左轉', onclick: () => rotate90(false) }),
      h('button', { class: 'btn', text: '向右轉', onclick: () => rotate90(true) }),
      h('button', { class: 'btn', text: '左右翻', onclick: () => flip(true) }),
      h('button', { class: 'btn', text: '上下翻', onclick: () => flip(false) })));
    let from = null;
    slider(el, {
      label: '拉正（微調角度）', min: -30, max: 30, step: 0.5, value: 0, def: 0, fmt: v => v + '°',
      onStart: () => { pushHistory(); from = { base: P.base, paint: P.paint, mask: P.cut && P.cut.mask }; },
      onInput: v => { if (!from) return; P.base = rotatedFill(from.base, v); P.paint = rotatedFill(from.paint, v); if (from.mask) P.cut.mask = rotatedFill(from.mask, v); requestRender(); },
      onEnd: () => { from = null; showTool('crop'); }
    });
    el.append(h('p', { text: '地平線歪掉時用。放開滑桿就會套用，可以再拉一次繼續微調。' }));
  },
  text(el) {
    el.append(h('h2', { text: '文字' }));
    el.append(h('button', {
      class: 'btn primary wide', text: '加一段文字',
      onclick: () => addObject({
        type: 'text', text: '輸入文字', x: P.base.width / 2, y: P.base.height / 2, size: Math.min(P.base.width, P.base.height) * 0.1,
        rot: 0, color: '#ffffff', stroke: true, strokeColor: '#1a1a1a', font: 'hei', bold: true
      })
    }));
    const o = P.sel && P.sel.type === 'text' ? P.sel : null;
    if (!o) { el.append(h('p', { text: '點一下圖上的文字就能編輯，按住可以拖曳。' })); return; }
    let dirty = false;
    const ta = h('textarea', { id: 'textEdit', rows: 3 });
    ta.value = o.text;
    ta.addEventListener('input', () => {
      if (!dirty) { pushHistory(); dirty = true; }
      o.text = ta.value; loadFontFor(o); requestRender();
    });
    ta.addEventListener('blur', () => { dirty = false; });
    el.append(h('label', { class: 'field', for: 'textEdit' }, '內容', ta));
    el.append(h('h3', { text: '樣式範本（點一下直接套用）' }));
    el.append(h('div', { class: 'chips' }, TEXT_STYLES.map(([name, st]) => h('button', {
      class: 'btn', text: name, onclick: () => { pushHistory(); Object.assign(o, st); loadFontFor(o); showTool('text'); requestRender(); }
    }))));
    el.append(h('h3', { text: '字體' }));
    chips(el, Object.entries(FONTS).map(([k, v]) => [k, v[0]]), o.font, v => { pushHistory(); o.font = v; loadFontFor(o); requestRender(); });
    el.append(h('div', { class: 'chips' },
      h('button', { class: 'btn', 'aria-pressed': String(o.bold), text: '粗體', onclick: () => { pushHistory(); o.bold = !o.bold; loadFontFor(o); showTool('text'); requestRender(); } }),
      h('button', { class: 'btn', 'aria-pressed': String(o.stroke), text: '描邊', onclick: () => { pushHistory(); o.stroke = !o.stroke; showTool('text'); requestRender(); } }),
      h('button', { class: 'btn', 'aria-pressed': String(!!o.shadow), text: '陰影', onclick: () => { pushHistory(); o.shadow = !o.shadow; showTool('text'); requestRender(); } })));
    el.append(h('h3', { text: '文字顏色' }));
    swatches(el, ['#ffffff', '#1a1a1a', '#ff5d8f', '#ffd24a', '#62d2c6', '#6b8cff'], o.color, c => { o.color = c; requestRender(); });
    if (o.stroke) {
      el.append(h('h3', { text: '描邊顏色' }));
      swatches(el, ['#1a1a1a', '#ffffff', '#ff5d8f', '#6b3f7d'], o.strokeColor, c => { o.strokeColor = c; requestRender(); });
    }
    objSliders(el, o);
  },
  sticker(el) {
    el.append(h('h2', { text: '貼圖' }));
    const grid = h('div', { class: 'stickers' });
    for (const s of STICKERS) {
      grid.append(h('button', {
        text: s, 'aria-label': '加入貼圖 ' + s,
        onclick: () => addObject({ type: 'sticker', text: s, x: P.base.width / 2, y: P.base.height / 2, size: Math.min(P.base.width, P.base.height) * 0.18, rot: 0 })
      }));
    }
    el.append(grid);
    el.append(h('button', {
      class: 'btn wide', text: '加入自己的圖片（Logo、浮水印）',
      onclick: async () => {
        const [f] = await pickFiles($('#fileImg'));
        if (!f) return;
        try {
          const cv = await fileToCanvas(f, 2000);
          addObject({ type: 'image', cv, x: P.base.width / 2, y: P.base.height / 2, size: Math.min(P.base.width, P.base.height) * 0.35, rot: 0, alpha: 1 });
        } catch (e) { toast('無法讀取 ' + f.name); }
      }
    }));
    const o = P.sel && P.sel.type !== 'text' ? P.sel : null;
    if (o) { el.append(h('hr')); objSliders(el, o); }
    else el.append(h('p', { text: '點一個貼圖放到圖上，再拖到想要的位置。' }));
  },
  brush(el) {
    el.append(h('h2', { text: '畫筆' }));
    chips(el, [['doodle', '塗鴉'], ['mosaic', '馬賽克'], ['erase', '擦掉塗鴉']], P.brushMode, v => { P.brushMode = v; showTool('brush'); });
    if (P.brushMode === 'doodle') {
      el.append(h('h3', { text: '顏色' }));
      swatches(el, ['#ff5d8f', '#ffffff', '#1a1a1a', '#ffd24a', '#62d2c6', '#6b8cff'], P.brushColor, c => { P.brushColor = c; });
    }
    slider(el, { label: '筆刷大小', min: 1, max: 100, value: P.brushSize[P.brushMode], onInput: v => { P.brushSize[P.brushMode] = v; } });
    el.append(h('p', { text: P.brushMode === 'mosaic' ? '在想遮住的地方塗抹，例如車牌或路人的臉。' : '直接在圖上畫。' }));
  },
  frame(el) {
    el.append(h('h2', { text: '邊框' }));
    chips(el, [['none', '無'], ['solid', '純色邊'], ['line', '細線'], ['double', '雙線'], ['corner', '相角'], ['shadow', '立體陰影'], ['polaroid', '拍立得'], ['film', '底片'], ['round', '圓角'], ['circle', '圓形'], ['gradient', '漸層']], P.frame.type, v => {
      pushHistory();
      P.frame.type = v;
      if (v === 'film' && P.frame.color === '#ffffff') P.frame.color = '#1a1a1a';
      showTool('frame'); requestRender();
    });
    if (P.frame.type === 'none') return;
    el.append(h('h3', { text: P.frame.type === 'gradient' ? '漸層起點顏色' : '邊框顏色' }));
    swatches(el, ['#ffffff', '#1a1a1a', '#f3e9dc', '#ffd9e4', '#d9f2ee'], P.frame.color, c => { P.frame.color = c; requestRender(); });
    if (P.frame.type === 'gradient') {
      el.append(h('h3', { text: '漸層終點顏色' }));
      swatches(el, ['#ff5d8f', '#62d2c6', '#ffd24a', '#6b8cff', '#1a1a1a'], P.frame.color2 || '#ff5d8f', c => { P.frame.color2 = c; requestRender(); });
    }
    slider(el, { label: '邊框寬度', min: 1, max: 20, value: P.frame.size, def: 5, onStart: pushHistory, onInput: v => { P.frame.size = v; requestRender(); } });
  }
};
function showTool(tool) {
  const wasCrop = P.tool === 'crop';
  P.tool = tool;
  if (tool !== 'beauty') P.liqOn = false;
  if (tool !== 'cutout') P.maskBrush = '';
  $$('#photoTools button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  const el = $('#photoPanel');
  el.replaceChildren();
  if (P.base) PANELS[tool](el);
  else el.append(h('h2', { text: PHOTO_TOOLS.find(t => t[0] === tool)[1] }), h('p', { text: '先開啟一張圖片，這裡才會出現可以調整的項目。' }));
  syncCropBox();
  $('#brushRing').hidden = true;
  if (tool !== 'adjust') P.hslPick = false;
  PV.style.cursor = activeBrush() || P.hslPick ? 'crosshair' : 'default';
  if (wasCrop !== (tool === 'crop')) requestRender();
}
function initPhoto() {
  const nav = $('#photoTools');
  for (const [key, label] of PHOTO_TOOLS) {
    nav.append(h('button', { 'data-tool': key, 'aria-pressed': 'false', text: label, onclick: () => { P.sel = null; setPanelOff('photo', false); showTool(key); requestRender(); } }));
  }
  $('#photoEmptyBtn').addEventListener('click', () => openForMode());
  $('#zoomIn').addEventListener('click', () => setZoom(P.zoom + 0.5));
  $('#zoomOut').addEventListener('click', () => setZoom(P.zoom - 0.5));
  // Ctrl + 滾輪也能縮放；放大後用捲軸移動畫面
  $('#photo .fitbox').addEventListener('wheel', e => {
    if (!e.ctrlKey || !P.base) return;
    e.preventDefault();
    setZoom(P.zoom + (e.deltaY < 0 ? 0.5 : -0.5));
  }, { passive: false });
  showTool('adjust');
  syncPhotoEmpty();
}
// 還沒開圖時顯示引導，藏起畫布
function syncPhotoEmpty() {
  const empty = !P.base;
  $('#photoEmpty').hidden = !empty;
  PV.parentElement.hidden = empty;
  $('#compareBtn').hidden = $('#zoomCtl').hidden = empty;
  // 還沒開圖時跟拼圖一樣：左邊工具和右邊面板都先收起來
  $('#photoTools').hidden = $('#photoPanel').hidden = empty;
  $('#photo').classList.toggle('is-empty', empty);
  if (empty) $('#photoInfo').textContent = '';
}

// 匯出尺寸：EXP.photo.size 是 '0'（原始）、'x2'（放大兩倍）或指定的長邊像素
function photoExportScale() {
  const ins = frameInsets(true);
  const L = Math.max(P.base.width + ins.l + ins.r, P.base.height + ins.t + ins.b), v = EXP.photo.size;
  if (v === '0') return 1;
  if (v === 'x2') return Math.min(2, 8192 / L);
  return Math.min(+v, 8192) / L;
}
function photoExportSize() {
  const ins = frameInsets(true), s = photoExportScale();
  return [Math.round((P.base.width + ins.l + ins.r) * s), Math.round((P.base.height + ins.t + ins.b) * s)];
}
function exportPhoto() {
  if (!P.base) { toast('先開啟一張圖片'); return; }
  const c = mk(4, 4);
  renderPhoto(c, 0, { final: true, scale: photoExportScale() });
  // 透明背景只有 PNG、WebP 存得住，JPG 會變成黑底
  const opt = P.cut && P.cut.bg.type === 'transparent' && EXP.photo.fmt === 'jpg' ? { ...EXP.photo, fmt: 'png' } : EXP.photo;
  if (opt !== EXP.photo) toast('透明背景已自動改存成 PNG', 3500);
  saveCanvas(c, '修圖作品', opt);
}
