// 進階修圖：五官微調、化妝、美體（長腿、增高、瘦身）、換天空、換色、證件照、AI 修復（畫質、人臉、黑白上色）、一次修很多張
// 臉、身形、頭髮衣服的位置用 MediaPipe 在主執行緒找；需要大模型的（天空、修復、上色）丟到 ai.js 的背景執行緒
const MODEL_DIR = new URL('models/', location.href).href;
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const PRO = { vision: null, files: null, faceLm: null, poseLm: null, seg: null, faces: null, facesFor: null, facesJob: null, facesJobFor: null };

async function mpVision() {
  if (!PRO.vision) {
    PRO.vision = await import(VISION_URL + '/+esm');
    PRO.files = await PRO.vision.FilesetResolver.forVisionTasks(VISION_URL + '/wasm');
  }
  return PRO.vision;
}
// MediaPipe 看的圖不用太大，先縮到長邊 1280（臉、身形的位置都換算回原圖座標）
function smallCopy(cv, L) {
  const s = Math.min(1, L / Math.max(cv.width, cv.height));
  if (s >= 1) return { c: cv, s: 1 };
  const c = mk(cv.width * s, cv.height * s), x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(cv, 0, 0, c.width, c.height);
  return { c, s };
}
// 找出照片裡所有的臉（最多 6 張），每張回傳 478 個定位點（原圖像素座標），由大到小排
async function detectFaces(cv) {
  const v = await mpVision();
  if (!PRO.faceLm) PRO.faceLm = await v.FaceLandmarker.createFromOptions(PRO.files, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 6, minFaceDetectionConfidence: 0.35, minFacePresenceConfidence: 0.35 });
  const { c } = smallCopy(cv, 1280), res = PRO.faceLm.detect(c);
  const faces = (res.faceLandmarks || []).map(lm => lm.map(p => ({ x: p.x * cv.width, y: p.y * cv.height })));
  return faces.sort((a, b) => dist(b[234], b[454]) - dist(a[234], a[454]));
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// 畫面算圖時同步取臉的位置：還沒找過就在背景開始找，找到後自動重畫
function facesFor(base) {
  if (PRO.facesFor === base) return PRO.faces;
  if (PRO.facesJobFor !== base) {
    PRO.facesJobFor = base;
    PRO.facesJob = detectFaces(base).then(f => {
      if (PRO.facesJobFor !== base) return f;
      PRO.faces = f; PRO.facesFor = base;
      if (P.base === base) { requestRender(); if (MODE === 'photo' && P.tool === 'beauty') showTool('beauty'); }
      return f;
    }, e => {
      // 載入不了（例如在 Claude 頁面裡）：當作沒有臉，提示一次就好
      if (PRO.facesJobFor === base) { PRO.faces = []; PRO.facesFor = base; }
      aiErrorToast(e);
      return [];
    });
  }
  return null;
}
async function ensureFaces(base) {
  if (PRO.facesFor === base) return PRO.faces;
  facesFor(base);
  return PRO.facesJob;
}

// ── 五官微調（大眼、瘦臉、瘦鼻、微笑、下巴）：算圖時依臉的定位點把像素推移，原圖不動 ──
const SHAPE_KEYS = [['eye', '大眼', 0, 100], ['slim', '瘦臉', 0, 100], ['nose', '瘦鼻', 0, 100], ['smile', '微笑', 0, 100], ['chin', '下巴（往左短、往右長）', -100, 100]];
const MAKEUP_PRESETS = [
  ['none', '素顏', { lip: 0, blush: 0, shadow: 0 }],
  ['natural', '自然', { lip: 35, lipColor: '#c46a6a', blush: 25, blushColor: '#f29b9b', shadow: 20, shadowColor: '#9c6b5a' }],
  ['sweet', '甜美', { lip: 50, lipColor: '#e8607a', blush: 45, blushColor: '#ff8fa8', shadow: 30, shadowColor: '#c98a9a' }],
  ['fresh', '好氣色', { lip: 45, lipColor: '#e0605a', blush: 35, blushColor: '#ff9e80', shadow: 0, shadowColor: '#9c6b5a' }],
  ['red', '正紅', { lip: 75, lipColor: '#c4122f', blush: 20, blushColor: '#f29b9b', shadow: 35, shadowColor: '#6e4a3d' }]
];
const LIP_COLORS = ['#c46a6a', '#e8607a', '#e0605a', '#c4122f', '#8e2a4f', '#c98b7d'];
const LIP_OUT = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const LIP_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
const LID_L = [33, 246, 161, 160, 159, 158, 157, 173, 133], LID_R = [362, 398, 384, 385, 386, 387, 388, 466, 263];
const BROW_L = [46, 53, 52, 65, 55], BROW_R = [285, 295, 282, 283, 276];
function shapeActive() { return SHAPE_KEYS.some(([k]) => P.shape[k]); }
function makeupActive() { return P.makeup.lip > 0 || P.makeup.blush > 0 || P.makeup.shadow > 0; }

// 把一張臉的五官參數換成一串「推移」：bulge 是以圓心放大，move 是把一點附近的像素往某個方向推
function faceOps(f, s) {
  const p = i => ({ x: f[i].x * s, y: f[i].y * s });
  const fw = dist(p(234), p(454)), top = p(10), chin = p(152), fh = dist(top, chin);
  const ax = { x: (chin.x - top.x) / fh, y: (chin.y - top.y) / fh };   // 臉的直軸（往下）
  const ops = [], k = P.shape;
  if (k.eye) {
    for (const [c, a, b] of [[468, 33, 133], [473, 362, 263]]) {
      const ew = dist(p(a), p(b));
      ops.push({ t: 'bulge', c: p(c), R: ew * 1.05, a: k.eye / 100 * 0.2 });
    }
  }
  // 臉的中線：鼻樑到下巴那條線，在某一點的高度對應的水平位置
  const mid = q => { const t = ((q.x - top.x) * ax.x + (q.y - top.y) * ax.y); return { x: top.x + ax.x * t, y: top.y + ax.y * t }; };
  if (k.slim) {
    // 腮幫子收最多，越靠近下巴收越少，下巴才不會變尖
    const JAW = [[93, 0.5], [132, 1], [58, 1], [172, 0.9], [136, 0.55], [150, 0.3], [149, 0.12], [323, 0.5], [361, 1], [288, 1], [397, 0.9], [365, 0.55], [379, 0.3], [378, 0.12]];
    for (const [i, wgt] of JAW) {
      const q = p(i), m = mid(q), d = dist(q, m) || 1, amt = fw * 0.05 * wgt * k.slim / 100;
      ops.push({ t: 'move', p: q, v: { x: (m.x - q.x) / d * amt, y: (m.y - q.y) / d * amt }, sig: fw * 0.13 });
    }
  }
  if (k.nose) {
    const nw = dist(p(129), p(358));
    for (const i of [129, 358, 98, 327, 64, 294]) {
      const q = p(i), m = mid(q), d = dist(q, m) || 1, amt = nw * 0.11 * k.nose / 100;
      ops.push({ t: 'move', p: q, v: { x: (m.x - q.x) / d * amt, y: (m.y - q.y) / d * amt }, sig: nw * 0.28 });
    }
  }
  if (k.smile) {
    const mw = dist(p(61), p(291));
    for (const i of [61, 291]) {
      const q = p(i), m = mid(q), d = dist(q, m) || 1, up = mw * 0.06 * k.smile / 100, out = mw * 0.02 * k.smile / 100;
      ops.push({ t: 'move', p: q, v: { x: -ax.x * up + (q.x - m.x) / d * out, y: -ax.y * up + (q.y - m.y) / d * out }, sig: mw * 0.22 });
    }
  }
  if (k.chin) {
    const amt = fh * 0.06 * k.chin / 100;
    for (const i of [152, 148, 377]) ops.push({ t: 'move', p: p(i), v: { x: ax.x * amt, y: ax.y * amt }, sig: fw * 0.17 });
  }
  return { ops, box: { x0: Math.min(p(234).x, p(454).x) - fw * 0.35, x1: Math.max(p(234).x, p(454).x) + fw * 0.35, y0: top.y - fh * 0.3, y1: chin.y + fh * 0.4 } };
}
// 對一塊範圍做反向取樣：每個輸出像素去原圖找它該來自哪裡，再做雙線性內插
function warpRegion(cv, box, mapFn) {
  const W = cv.width, H = cv.height, x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(W, Math.ceil(box.x1)), y1 = Math.min(H, Math.ceil(box.y1));
  if (x1 - x0 < 2 || y1 - y0 < 2) return;
  const ctx = cv.getContext('2d'), src = ctx.getImageData(0, 0, W, H), sd = src.data;
  const out = ctx.getImageData(x0, y0, x1 - x0, y1 - y0), od = out.data, ow = x1 - x0;
  const q = { x: 0, y: 0 };
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    q.x = x; q.y = y;
    mapFn(q);
    const sx = Math.min(W - 1.001, Math.max(0, q.x)), sy = Math.min(H - 1.001, Math.max(0, q.y));
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy, i0 = (iy * W + ix) * 4, i1 = i0 + W * 4, o = ((y - y0) * ow + (x - x0)) * 4;
    for (let c = 0; c < 4; c++) od[o + c] = (sd[i0 + c] * (1 - fx) + sd[i0 + 4 + c] * fx) * (1 - fy) + (sd[i1 + c] * (1 - fx) + sd[i1 + 4 + c] * fx) * fy;
  }
  ctx.putImageData(out, x0, y0);
}
function applyFaceOps(cv, ops, box) {
  warpRegion(cv, box, q => {
    let dx = 0, dy = 0;
    for (const o of ops) {
      if (o.t === 'bulge') {
        const ex = q.x - o.c.x, ey = q.y - o.c.y, r2 = ex * ex + ey * ey, R2 = o.R * o.R;
        if (r2 < R2) { const t = 1 - r2 / R2, f = -o.a * t * t; dx += ex * f; dy += ey * f; }
      } else {
        const ex = q.x - o.p.x - o.v.x, ey = q.y - o.p.y - o.v.y, w = Math.exp(-(ex * ex + ey * ey) / (2 * o.sig * o.sig));
        if (w > 0.002) { dx -= o.v.x * w; dy -= o.v.y * w; }
      }
    }
    q.x += dx; q.y += dy;
  });
}
// 化妝：口紅、腮紅、眼影都只在臉的那一小塊畫，邊緣柔化
function applyMakeup(cv, f, s) {
  const m = P.makeup, p = i => ({ x: f[i].x * s, y: f[i].y * s }), fw = dist(p(234), p(454)), ctx = cv.getContext('2d');
  const poly = (x, ids) => { x.beginPath(); ids.forEach((i, n) => { const q = p(i); n ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y); }); x.closePath(); };
  const layer = (draw, blur, mode, alpha, color) => {
    const L = mk(cv.width, cv.height), lx = L.getContext('2d');
    if (HAS_FILTER && blur) lx.filter = 'blur(' + blur.toFixed(1) + 'px)';
    lx.fillStyle = '#ffffff'; draw(lx);
    lx.filter = 'none';
    lx.globalCompositeOperation = 'source-in'; lx.fillStyle = color; lx.fillRect(0, 0, L.width, L.height);
    ctx.save(); ctx.globalCompositeOperation = mode; ctx.globalAlpha = alpha; ctx.drawImage(L, 0, 0); ctx.restore();
  };
  if (m.shadow > 0) {
    for (const [lid, brow] of [[LID_L, BROW_L], [LID_R, BROW_R]]) {
      const lidPts = lid.map(p), up = lidPts.map((q, i) => { const b = p(brow[Math.round(i / (lid.length - 1) * (brow.length - 1))]); return { x: q.x + (b.x - q.x) * 0.45, y: q.y + (b.y - q.y) * 0.45 }; });
      layer(x => { x.beginPath(); lidPts.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y))); for (let i = up.length - 1; i >= 0; i--) x.lineTo(up[i].x, up[i].y); x.closePath(); x.fill(); }, fw * 0.025, 'multiply', m.shadow / 100 * 0.7, m.shadowColor);
    }
  }
  if (m.blush > 0) {
    for (const i of [205, 425]) {
      const c = p(i), r = fw * 0.13;
      layer(x => { x.beginPath(); x.ellipse(c.x, c.y, r, r * 0.75, 0, 0, Math.PI * 2); x.fill(); }, r * 0.55, 'source-over', m.blush / 100 * 0.38, m.blushColor);
    }
  }
  if (m.lip > 0) {
    const mw = dist(p(61), p(291)), draw = x => { poly(x, LIP_OUT); x.fill(); x.globalCompositeOperation = 'destination-out'; poly(x, LIP_IN); x.fill(); x.globalCompositeOperation = 'source-over'; };
    layer(draw, mw * 0.025, 'color', m.lip / 100 * 0.6, m.lipColor);
    layer(draw, mw * 0.025, 'soft-light', m.lip / 100 * 0.6, m.lipColor);
  }
}

// ── 換天空、換色：遮罩跟原圖一樣大，算圖時才合成上去（可以隨時換、隨時取消） ──
const SKY_TYPES = [['clouds', '藍天白雲'], ['clear', '晴空'], ['sunset', '夕陽晚霞'], ['dusk', '粉紫黃昏'], ['night', '星空'], ['image', '自己的照片']];
const SKY_CACHE = { key: '', cv: null };
function seeded(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
// 平滑的雜訊（雲用）：幾層不同大小的隨機格子疊起來
function noiseCanvas(w, hh, seed, scaleX, scaleY) {
  const c = mk(w, hh), x = c.getContext('2d'), rnd = seeded(seed);
  x.fillStyle = '#808080'; x.fillRect(0, 0, w, hh);
  for (let o = 0; o < 5; o++) {
    const gw = Math.max(2, Math.round(3 * scaleX * 2 ** o)), gh = Math.max(2, Math.round(2 * scaleY * 2 ** o)), g = mk(gw, gh), gx = g.getContext('2d'), id = gx.createImageData(gw, gh);
    for (let i = 0; i < gw * gh; i++) { const v = rnd() * 255; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    gx.putImageData(id, 0, 0);
    x.globalAlpha = 0.5 / (o + 1); x.imageSmoothingQuality = 'high'; x.drawImage(g, 0, 0, w, hh);
  }
  x.globalAlpha = 1;
  return c;
}
function makeSky(type, w, hh) {
  const key = type + w + 'x' + hh + (type === 'image' && P.sky && P.sky.img ? P.sky.imgId : '');
  if (SKY_CACHE.key === key) return SKY_CACHE.cv;
  const c = mk(w, hh), x = c.getContext('2d'), rnd = seeded(97);
  const grad = stops => { const g = x.createLinearGradient(0, 0, 0, hh); stops.forEach(([t, col]) => g.addColorStop(t, col)); x.fillStyle = g; x.fillRect(0, 0, w, hh); };
  const clouds = (alpha, tint, seed, low) => {
    const n = noiseCanvas(Math.max(64, Math.round(w / 4)), Math.max(32, Math.round(hh / 4)), seed, 1.6, 1), nx = n.getContext('2d'), d = nx.getImageData(0, 0, n.width, n.height);
    let lo = 255, hi = 0;
    for (let i = 0; i < d.data.length; i += 4) { lo = Math.min(lo, d.data[i]); hi = Math.max(hi, d.data[i]); }
    for (let i = 0; i < d.data.length; i += 4) {
      const yy = Math.floor(i / 4 / n.width) / n.height, v = (d.data[i] - lo) / Math.max(1, hi - lo), a = Math.min(1, Math.max(0, (v - 0.5) * 2.6)) * (low ? 0.55 + yy * 0.45 : 1);
      d.data[i] = tint[0]; d.data[i + 1] = tint[1]; d.data[i + 2] = tint[2]; d.data[i + 3] = a * 255 * alpha;
    }
    nx.putImageData(d, 0, 0);
    x.imageSmoothingQuality = 'high'; x.drawImage(n, 0, 0, w, hh);
  };
  if (type === 'image' && P.sky && P.sky.img) {
    const im = P.sky.img, k = Math.max(w / im.width, hh / im.height);
    x.drawImage(im, (w - im.width * k) / 2, 0, im.width * k, im.height * k);
  } else if (type === 'clear') grad([[0, '#2a6fc9'], [0.55, '#6aa9e8'], [1, '#d7ecfb']]);
  else if (type === 'clouds') { grad([[0, '#2c74cf'], [0.6, '#7db6ec'], [1, '#dff0fc']]); clouds(0.95, [255, 255, 255], 11, true); clouds(0.35, [190, 205, 225], 23, true); }
  else if (type === 'sunset') {
    grad([[0, '#28356e'], [0.35, '#8a4f8f'], [0.65, '#ec7a5c'], [0.88, '#ffbf6b'], [1, '#ffe6a8']]);
    const g = x.createRadialGradient(w * 0.62, hh * 0.98, 0, w * 0.62, hh * 0.98, hh * 0.7);
    g.addColorStop(0, 'rgba(255,240,200,.95)'); g.addColorStop(0.15, 'rgba(255,200,120,.6)'); g.addColorStop(1, 'rgba(255,160,90,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, hh);
    clouds(0.55, [255, 150, 110], 31, true);
  } else if (type === 'dusk') { grad([[0, '#2f2a66'], [0.5, '#a25a9e'], [0.85, '#f09a85'], [1, '#ffd0a0']]); clouds(0.35, [255, 190, 200], 41, true); }
  else {
    grad([[0, '#03051a'], [0.6, '#101b45'], [1, '#2b3c70']]);
    for (let i = 0; i < w * hh / 900; i++) { x.globalAlpha = 0.3 + rnd() * 0.7; x.fillStyle = '#ffffff'; const r = rnd() < 0.08 ? 1.6 : 0.8; x.beginPath(); x.arc(rnd() * w, rnd() * hh * 0.95, r * Math.max(1, w / 1200), 0, 7); x.fill(); }
    x.globalAlpha = 1;
    const mx = w * 0.78, my = hh * 0.22, mr = Math.max(8, w * 0.025), g = x.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 5);
    g.addColorStop(0, 'rgba(255,250,230,.5)'); g.addColorStop(1, 'rgba(255,250,230,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, hh); x.fillStyle = '#fff8e0'; x.beginPath(); x.arc(mx, my, mr, 0, 7); x.fill();
  }
  SKY_CACHE.key = key; SKY_CACHE.cv = c;
  return c;
}
function maskBox(mask) {
  if (mask._box) return mask._box;
  const s = Math.min(1, 256 / Math.max(mask.width, mask.height)), c = mk(mask.width * s, mask.height * s), x = c.getContext('2d');
  x.drawImage(mask, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1, n = 0, sum = 0;
  for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) {
    const a = d[(y * c.width + xx) * 4 + 3];
    sum += a;
    if (a > 30) { n++; if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  mask._box = x1 < 0 ? null : { x0: x0 / s, y0: y0 / s, x1: (x1 + 1) / s, y1: (y1 + 1) / s, frac: sum / 255 / (c.width * c.height) };
  return mask._box;
}
function applySky(wc) {
  const sk = P.sky, iw = wc.width, ih = wc.height, b = maskBox(sk.mask);
  if (!b) return;
  const k = iw / P.base.width, horizon = Math.min(ih, b.y1 * k * 1.08 + 2);
  const sky = makeSky(sk.type, Math.max(16, Math.round(iw)), Math.max(16, Math.round(horizon)));
  const L = mk(iw, ih), lx = L.getContext('2d');
  lx.drawImage(sky, 0, 0, iw, horizon);
  if (horizon < ih) lx.drawImage(sky, 0, horizon - 1, iw, 1, 0, horizon, iw, ih - horizon);
  const M = mk(iw, ih), mx = M.getContext('2d');
  mx.imageSmoothingQuality = 'high'; mx.drawImage(sk.mask, 0, 0, iw, ih);
  const x = wc.getContext('2d'), md = mx.getImageData(0, 0, iw, ih).data;
  // 原本天空的平均顏色：邊緣半透明的像素要先把它扣掉，否則屋頂、樹梢旁會留一圈舊天空的顏色
  const orig = x.getImageData(0, 0, iw, ih), od = orig.data, old = [0, 0, 0];
  let on = 0;
  for (let i = 0; i < md.length; i += 28) if (md[i + 3] > 240) { old[0] += od[i]; old[1] += od[i + 1]; old[2] += od[i + 2]; on++; }
  if (on) { old[0] /= on; old[1] /= on; old[2] /= on; }
  // 前景跟著新天空調色：夕陽偏暖、星空變暗，強度由「融合」控制
  const tone = { clouds: ['#d8e8ff', 0.25], clear: ['#d8e8ff', 0.25], sunset: ['#ff9a5c', 0.8], dusk: ['#c27ab0', 0.7], night: ['#26305c', 1.9], image: [null, 0.35] }[sk.type];
  if (sk.harmon > 0) {
    let col = tone[0];
    if (!col) { const t = mk(1, 1), tx = t.getContext('2d'); tx.drawImage(sky, 0, 0, 1, 1); const d = tx.getImageData(0, 0, 1, 1).data; col = 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')'; }
    const F = mk(iw, ih), fx = F.getContext('2d');
    fx.fillStyle = col; fx.fillRect(0, 0, iw, ih);
    fx.globalCompositeOperation = 'destination-out'; fx.drawImage(sk.mask, 0, 0, iw, ih);
    x.save();
    x.globalCompositeOperation = sk.type === 'night' ? 'multiply' : 'soft-light';
    x.globalAlpha = Math.min(0.85, sk.harmon / 100 * tone[1]);
    x.drawImage(F, 0, 0);
    x.restore();
  }
  const cur = x.getImageData(0, 0, iw, ih), cd = cur.data, sd = lx.getImageData(0, 0, iw, ih).data;
  for (let i = 0; i < cd.length; i += 4) {
    const a = md[i + 3] / 255;
    if (a < 0.004) continue;
    const a2 = a >= 0.8 ? 1 : (a / 0.8) * (a / 0.8) * (3 - 2 * a / 0.8);   // 邊緣往外推一點，天空蓋得比較乾淨
    if (a2 >= 0.999) { cd[i] = sd[i]; cd[i + 1] = sd[i + 1]; cd[i + 2] = sd[i + 2]; continue; }
    for (let c = 0; c < 3; c++) {
      const f = a < 0.9 ? Math.min(255, Math.max(0, (od[i + c] - a * old[c]) / (1 - a) + (cd[i + c] - od[i + c]))) : cd[i + c];
      cd[i + c] = f * (1 - a2) + sd[i + c] * a2;
    }
  }
  x.putImageData(cur, 0, 0);
}
const TINT_COLORS = ['#6b3e26', '#c9a36b', '#7b1f32', '#e58fb0', '#6f8fb8', '#7d5ba6', '#c7c9cc', '#1d1a1a'];
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh / 6, s, l];
}
function hslRgb(hh, s, l, out, o) {
  const f = n => { const k = (n + hh * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  out[o] = f(0) * 255; out[o + 1] = f(8) * 255; out[o + 2] = f(4) * 255;
}
// 換色：保留原本的明暗紋理，只換色相和飽和度，亮度往目標顏色移動（黑髮也能染成淺色）
function applyTint(wc, t) {
  const iw = wc.width, ih = wc.height, k = iw / P.base.width, b = maskBox(t.mask);
  if (!b) return;
  const x0 = Math.max(0, Math.floor(b.x0 * k) - 2), y0 = Math.max(0, Math.floor(b.y0 * k) - 2), x1 = Math.min(iw, Math.ceil(b.x1 * k) + 2), y1 = Math.min(ih, Math.ceil(b.y1 * k) + 2), w = x1 - x0, hh = y1 - y0;
  if (w < 1 || hh < 1) return;
  const M = mk(w, hh), mx = M.getContext('2d');
  mx.imageSmoothingQuality = 'high';
  mx.drawImage(t.mask, x0 / k, y0 / k, w / k, hh / k, 0, 0, w, hh);
  const md = mx.getImageData(0, 0, w, hh).data, ctx = wc.getContext('2d'), id = ctx.getImageData(x0, y0, w, hh), d = id.data;
  const [th, ts, tl] = rgbHsl(...hexRgb(t.color)), amt = t.amt / 100, tmp = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    const a = md[i + 3] / 255 * amt;
    if (a < 0.01) continue;
    const [, s, l] = rgbHsl(d[i], d[i + 1], d[i + 2]);
    const nl = Math.min(0.97, Math.max(0.02, l + (tl - t.meanL) * 0.85)), ns = Math.min(1, ts * (0.85 + 0.25 * Math.min(1, s * 2)));
    hslRgb(th, ns, nl, tmp, 0);
    d[i] += (tmp[0] - d[i]) * a; d[i + 1] += (tmp[1] - d[i + 1]) * a; d[i + 2] += (tmp[2] - d[i + 2]) * a;
  }
  ctx.putImageData(id, x0, y0);
}
function maskMeanL(base, mask) {
  const s = Math.min(1, 256 / Math.max(base.width, base.height)), w = Math.max(1, Math.round(base.width * s)), hh = Math.max(1, Math.round(base.height * s));
  const a = mk(w, hh), ax = a.getContext('2d'), m = mk(w, hh), mxx = m.getContext('2d');
  ax.drawImage(base, 0, 0, w, hh); mxx.drawImage(mask, 0, 0, w, hh);
  const d = ax.getImageData(0, 0, w, hh).data, md = mxx.getImageData(0, 0, w, hh).data;
  let sl = 0, sw = 0;
  for (let i = 0; i < d.length; i += 4) { const wt = md[i + 3] / 255; if (wt > 0.3) { sl += rgbHsl(d[i], d[i + 1], d[i + 2])[2] * wt; sw += wt; } }
  return sw ? sl / sw : 0.3;
}

// 算圖流程裡的進階步驟：天空與換色 → 化妝 → 五官推移。回傳要繼續處理的畫布
function proPass(wc, s) {
  if (P.sky) applySky(wc);
  for (const t of P.tints) applyTint(wc, t);
  const wantFace = shapeActive() || makeupActive();
  if (!wantFace) return wc;
  const faces = facesFor(P.base);
  if (!faces || !faces.length) return wc;
  for (const f of faces) {
    if (makeupActive()) applyMakeup(wc, f, s);
    if (shapeActive()) { const { ops, box } = faceOps(f, s); applyFaceOps(wc, ops, box); }
  }
  return wc;
}

// ── 遮罩：從低解析度的機率圖放大到原圖大小，邊緣用原圖明暗修到輪廓上 ──
function alphaToMask(base, alpha, w, hh) {
  const { c } = smallCopy(base, 1024), x = mk(w, hh), xx = x.getContext('2d');
  xx.imageSmoothingQuality = 'high'; xx.drawImage(c, 0, 0, w, hh);
  const d = xx.getImageData(0, 0, w, hh).data, gray = new Float32Array(w * hh);
  for (let i = 0; i < gray.length; i++) gray[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  const cap = Math.min(1, 2400 / Math.max(base.width, base.height)), region = mk(base.width * cap, base.height * cap), rx = region.getContext('2d');
  rx.imageSmoothingQuality = 'high'; rx.drawImage(base, 0, 0, region.width, region.height);
  const refined = refineMatte({ alpha, gray, w, h: hh }, region), full = mk(base.width, base.height), fx = full.getContext('2d');
  fx.imageSmoothingQuality = 'high'; fx.drawImage(refined, 0, 0, full.width, full.height);
  return full;
}
async function skySegment(base) {
  const { c } = smallCopy(base, 1024), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const m = await aiCall({ type: 'skyseg', data: d.buffer.slice(0), w: c.width, h: c.height }, [], '正在找出天空…');
  const n = m.w * m.h, alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = m.mask[i] / 255;
  // 天空的範圍會比模型抓的多一點點（樹葉縫隙）：把邊緣附近亮、偏藍或偏白的像素也算進去
  return alphaToMask(base, alpha, m.w, m.h);
}
// 頭髮、衣服、臉、皮膚：MediaPipe 的多類別人像分割（0 背景、1 頭髮、2 身體皮膚、3 臉部皮膚、4 衣服、5 其他）
async function partMask(base, cls) {
  const v = await mpVision();
  if (!PRO.seg) PRO.seg = await v.ImageSegmenter.createFromOptions(PRO.files, { baseOptions: { modelAssetPath: SEG_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false });
  const { c } = smallCopy(base, 1024), res = PRO.seg.segment(c), cms = res.confidenceMasks, cm = cms[cls];
  const w = cm.width, hh = cm.height, alpha = new Float32Array(cm.getAsFloat32Array());
  // 只留把握比較大的部分，並扣掉皮膚（臉、身體），邊緣才不會染到額頭、脖子
  const face = cms[3].getAsFloat32Array(), body = cms[2].getAsFloat32Array(), skin = mk(w, hh), skx = skin.getContext('2d'), sid = skx.createImageData(w, hh);
  for (let i = 0; i < face.length; i++) sid.data[i * 4 + 3] = Math.min(255, (face[i] + body[i]) * 400);
  skx.putImageData(sid, 0, 0);
  for (let i = 0; i < alpha.length; i++) {
    const t = Math.min(1, Math.max(0, (alpha[i] - 0.35) / 0.4));
    alpha[i] = t * t * (3 - 2 * t) * (1 - Math.min(1, (face[i] + body[i]) * 1.3));
  }
  res.close && res.close();
  let n = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > 0.5) n++;
  if (n < alpha.length * 0.004) return null;
  const mask = alphaToMask(base, alpha, w, hh);
  return cls === 1 ? growHair(base, mask, skin) : mask;
}
// 頭髮外圈的細髮絲常常沒被選進去，染淺色後會留一圈黑邊：把範圍往外擴一點，但只吃進顏色跟頭髮差不多暗的像素
function growHair(base, mask, skin) {
  const W = base.width, H = base.height, meanL = maskMeanL(base, mask), sk = mk(W, H), skc = sk.getContext('2d');
  skc.imageSmoothingQuality = 'high'; skc.drawImage(blurCanvas(skin, 1.5), 0, 0, W, H);
  const sd = skc.getImageData(0, 0, W, H).data;
  const grown = blurCanvas(mask, Math.max(2, Math.max(W, H) * 0.012)), gd = grown.getContext('2d').getImageData(0, 0, W, H).data;
  const mx = mask.getContext('2d'), m = mx.getImageData(0, 0, W, H), md = m.data, bd = base.getContext('2d').getImageData(0, 0, W, H).data;
  for (let i = 0; i < md.length; i += 4) {
    const g = Math.min(1, gd[i + 3] / 255 * 2.2);
    if (g <= md[i + 3] / 255) continue;
    const l = (Math.max(bd[i], bd[i + 1], bd[i + 2]) + Math.min(bd[i], bd[i + 1], bd[i + 2])) / 510;
    const hairLike = Math.min(1, Math.max(0, 1 - (l - meanL) / 0.22));
    md[i + 3] = Math.max(md[i + 3], g * hairLike * (1 - sd[i + 3] / 255) * 255);
  }
  mx.putImageData(m, 0, 0);
  mask._box = null;
  return mask;
}

// ── 美體：長腿、增高、瘦身。直接改原圖（可以復原），每次都從開始調整前的那張重算 ──
async function detectPose(cv) {
  const v = await mpVision();
  if (!PRO.poseLm) PRO.poseLm = await v.PoseLandmarker.createFromOptions(PRO.files, { baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', numPoses: 1 });
  const { c } = smallCopy(cv, 1280), res = PRO.poseLm.detect(c), lm = res.landmarks && res.landmarks[0];
  return lm ? lm.map(p => ({ x: p.x * cv.width, y: p.y * cv.height, v: p.visibility == null ? 1 : p.visibility })) : null;
}
function bodyGeom(pose, W, H) {
  const g = i => pose[i], avg = (a, b) => ({ x: (g(a).x + g(b).x) / 2, y: (g(a).y + g(b).y) / 2 });
  const sh = avg(11, 12), hip = avg(23, 24), tor = Math.max(10, hip.y - sh.y);
  const ankles = [27, 28].filter(i => g(i).v > 0.4 && g(i).y < H * 1.02).map(i => g(i).y);
  const ankle = ankles.length ? Math.min(H, Math.max(...ankles)) : H;
  const neck = Math.max(0, sh.y - tor * 0.22);
  const bw = Math.max(Math.abs(g(11).x - g(12).x), Math.abs(g(23).x - g(24).x) * 1.4, 10) * 0.55;
  return { sh, hip, tor, ankle, neck, bw, legsVisible: ankles.length > 0 };
}
// 垂直方向分段拉長：[0,頸] 不變、[頸,髖] × kh、[髖,腳踝] × kh × kl、[腳踝,底] 不變
function stretchKnots(G, H, kh, kl) {
  const ys = [0, G.neck, Math.max(G.neck, G.hip.y), Math.max(G.hip.y, G.ankle), H], ks = [1, kh, kh * kl, 1], out = [0];
  for (let i = 0; i < 4; i++) out.push(out[i] + (ys[i + 1] - ys[i]) * ks[i]);
  return { ys, out, H2: Math.round(out[4]) };
}
function stretchCanvas(cv, K) {
  const W = cv.width, r = cv.height / K.ys[4], c = mk(W, Math.round(K.H2 * r)), x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  for (let i = 0; i < 4; i++) {
    // 用整數座標、每段多畫 1px 疊在下一段上，段與段之間才不會留下細縫
    const sy = Math.round(K.ys[i] * r), sh = Math.round(K.ys[i + 1] * r) - sy, dy = Math.round(K.out[i] * r), dh = Math.round(K.out[i + 1] * r) - dy;
    if (sh >= 1 && dh >= 1) x.drawImage(cv, 0, sy, W, Math.min(cv.height - sy, sh + 1), 0, dy, W, dh + (i < 3 ? 1 : 0));
  }
  return c;
}
function mapStretchY(K, y) {
  for (let i = 0; i < 4; i++) if (y <= K.ys[i + 1] || i === 3) { const t = K.ys[i + 1] > K.ys[i] ? (y - K.ys[i]) / (K.ys[i + 1] - K.ys[i]) : 0; return K.out[i] + t * (K.out[i + 1] - K.out[i]); }
  return y;
}
// 瘦身：腰到大腿上段，越靠近身體邊緣往內收越多，離身體遠的背景不動
function slimCanvas(cv, G, amt, scale) {
  if (!amt) return cv;
  const c = cloneCanvas(cv), s = scale || 1, cx = G.hip.x * s, top = G.sh.y * s, bot = (G.hip.y + G.tor * 0.55) * s, bw = G.bw * s, a = amt / 100 * 0.11;
  warpRegion(c, { x0: cx - bw * 3, x1: cx + bw * 3, y0: top, y1: bot }, q => {
    const t = (q.y - top) / (bot - top), wy = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    const dx = q.x - cx, g = Math.exp(-((dx / (bw * 1.7)) ** 2));
    q.x = cx + dx * (1 + a * wy * wy * g);
  });
  return c;
}
async function prepareBody() {
  const base = P.base;
  if (P.body && P.body.out === base) return P.body;
  P.body = { busy: true, out: base };
  showTool('body');
  let pose = null;
  try { pose = await detectPose(base); } catch (e) { pose = null; }
  if (P.base !== base) return null;
  P.body = pose ? {
    out: base, pose, legs: 0, height: 0, slim: 0, G: bodyGeom(pose, base.width, base.height),
    orig: { base, paint: P.paint, cut: P.cut && P.cut.mask, sky: P.sky && P.sky.mask, tints: P.tints.map(t => t.mask), objs: P.objects.map(o => ({ o, x: o.x, y: o.y })) }
  } : { out: base, none: true };
  if (MODE === 'photo' && P.tool === 'body') showTool('body');
  return P.body;
}
function applyBody() {
  const B = P.body, O = B.orig, G = B.G, W = O.base.width, H = O.base.height;
  const kh = 1 + B.height / 100 * 0.1, kl = 1 + B.legs / 100 * 0.2, K = stretchKnots(G, H, kh, kl);
  const run = cv => { if (!cv) return cv; const sc = cv.width / W; return stretchCanvas(slimCanvas(cv, G, B.slim, sc), K); };
  P.base = run(O.base); P.paint = run(O.paint);
  if (P.cut && O.cut) { P.cut.mask = run(O.cut); }
  if (P.sky && O.sky) P.sky.mask = run(O.sky);
  P.tints.forEach((t, i) => { if (O.tints[i]) t.mask = run(O.tints[i]); });
  for (const r of O.objs) { r.o.x = r.x; r.o.y = mapStretchY(K, r.y); }
  P.mark = null; P.crop = { x: 0, y: 0, w: 1, h: 1 };
  B.out = P.base;
  requestRender();
}

// ── AI 修復：畫質（Real-ESRGAN）、人臉（GFPGAN）、黑白上色（DeOldify） ──
function tensorFrom(cv, mode) {
  const w = cv.width, hh = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, hh).data, n = w * hh, t = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
    const v = d[i * 4 + c];
    t[c * n + i] = mode === 'pm1' ? v / 127.5 - 1 : mode === '255' ? v : v / 255;
  }
  return t;
}
function canvasFrom(t, w, hh, mode) {
  const c = mk(w, hh), x = c.getContext('2d'), id = x.createImageData(w, hh), n = w * hh;
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < 3; ch++) { const v = t[ch * n + i]; id.data[i * 4 + ch] = mode === 'pm1' ? (v + 1) * 127.5 : mode === '255' ? v : v * 255; }
    id.data[i * 4 + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  return c;
}
async function runModel(file, input, dims, label, progress) {
  const m = await aiCall({ type: 'run', url: MODEL_DIR + file, feeds: { input: { data: input, dims } } }, [input.buffer], label, progress);
  return m.out;
}
// 畫質修復：切成小塊放大 4 倍，接縫處多留一圈重疊
async function upscale(base) {
  const L = Math.max(base.width, base.height), inScale = Math.min(1, 1100 / L);
  const src = inScale < 1 ? smallCopy(base, 1100).c : base, W = src.width, H = src.height;
  const T = 160, PAD = 12, out = mk(W * 4, H * 4), ox = out.getContext('2d');
  const tiles = [];
  for (let y = 0; y < H; y += T) for (let x = 0; x < W; x += T) tiles.push([x, y]);
  for (let i = 0; i < tiles.length; i++) {
    const [x, y] = tiles[i], x0 = Math.max(0, x - PAD), y0 = Math.max(0, y - PAD), x1 = Math.min(W, x + T + PAD), y1 = Math.min(H, y + T + PAD);
    const tc = mk(x1 - x0, y1 - y0); tc.getContext('2d').drawImage(src, x0, y0, tc.width, tc.height, 0, 0, tc.width, tc.height);
    const o = (await runModel('esrgan_x4.onnx', tensorFrom(tc, '01'), [1, 3, tc.height, tc.width], '正在提升畫質…（' + (i + 1) + ' / ' + tiles.length + '）', (i + 1) / tiles.length)).output;
    const oc = canvasFrom(o.data, o.dims[3], o.dims[2], '01');
    const cw = Math.min(T, W - x), chh = Math.min(T, H - y);
    ox.drawImage(oc, (x - x0) * 4, (y - y0) * 4, cw * 4, chh * 4, x * 4, y * 4, cw * 4, chh * 4);
  }
  // 輸出最大長邊 4096
  const k = Math.min(1, 4096 / Math.max(out.width, out.height));
  if (k >= 1) return out;
  const fin = mk(out.width * k, out.height * k), fx = fin.getContext('2d');
  fx.imageSmoothingQuality = 'high'; fx.drawImage(out, 0, 0, fin.width, fin.height);
  return fin;
}
// 五個點（兩眼、鼻尖、兩嘴角）對到 GFPGAN 要的標準位置，用最小平方法求相似變換
const FFHQ = [[0.37691676, 0.46864664], [0.62285697, 0.46912813], [0.50123859, 0.61331904], [0.39308822, 0.72541100], [0.61150205, 0.72490465]];
function similarity(src, dst) {
  const n = src.length;
  let mx = 0, my = 0, nx = 0, ny = 0;
  for (let i = 0; i < n; i++) { mx += src[i][0]; my += src[i][1]; nx += dst[i][0]; ny += dst[i][1]; }
  mx /= n; my /= n; nx /= n; ny /= n;
  let a = 0, b = 0, ss = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - mx, sy = src[i][1] - my, dx = dst[i][0] - nx, dy = dst[i][1] - ny;
    a += sx * dx + sy * dy; b += sx * dy - sy * dx; ss += sx * sx + sy * sy;
  }
  a /= ss; b /= ss;
  return [a, b, -b, a, nx - (a * mx - b * my), ny - (b * mx + a * my)];   // canvas 的 setTransform(a,b,c,d,e,f)
}
// 電腦用 GFPGAN（512，細節最好）；手機用 GPEN-256（記憶體只要約五分之一）
function faceModel() { return isTouchDevice() ? ['gpen256.onnx', 256] : ['gfpgan.onnx', 512]; }
async function restoreFaces(base, faces, note) {
  const out = cloneCanvas(base), [file, N] = faceModel();
  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi], c = (ids) => { let x = 0, y = 0; ids.forEach(i => { x += f[i].x; y += f[i].y; }); return [x / ids.length, y / ids.length]; };
    const pts = [c([33, 133, 159, 145]), c([362, 263, 386, 374]), [f[4].x, f[4].y], [f[61].x, f[61].y], [f[291].x, f[291].y]];
    const T = similarity(pts, FFHQ.map(([x, y]) => [x * N, y * N]));
    const crop = mk(N, N), cx = crop.getContext('2d');
    cx.imageSmoothingQuality = 'high'; cx.setTransform(...T); cx.drawImage(out, 0, 0);
    const o = (await runModel(file, tensorFrom(crop, 'pm1'), [1, 3, N, N], '正在修復臉部…' + (faces.length > 1 ? '（' + (fi + 1) + ' / ' + faces.length + '）' : '') + note, (fi + 1) / faces.length)).output;
    const fixed = canvasFrom(o.data, N, N, 'pm1'), fx = fixed.getContext('2d');
    // 邊緣柔化：只換掉臉的中間，外圍慢慢過渡回原圖
    const m = mk(N, N), mxx = m.getContext('2d');
    if (HAS_FILTER) mxx.filter = 'blur(' + (N * 0.04) + 'px)';
    mxx.fillStyle = '#fff'; mxx.beginPath(); mxx.ellipse(N / 2, N * 0.56, N * 0.37, N * 0.44, 0, 0, Math.PI * 2); mxx.fill();
    fx.globalCompositeOperation = 'destination-in'; fx.drawImage(m, 0, 0);
    const [a, b, cc, d, e, g] = T, det = a * d - b * cc, inv = [d / det, -b / det, -cc / det, a / det, (cc * g - d * e) / det, (b * e - a * g) / det];
    const ox = out.getContext('2d');
    ox.save(); ox.imageSmoothingQuality = 'high'; ox.setTransform(...inv); ox.drawImage(fixed, 0, 0); ox.restore();
  }
  return out;
}
// 黑白上色：模型只看 256×256 的灰階圖決定顏色，亮度完全用原圖，所以細節不會變糊
async function colorize(base) {
  const N = isTouchDevice() ? 192 : 256, W = base.width, H = base.height, g = mk(N, N), gx = g.getContext('2d');   // 手機用小一點的圖決定顏色，省記憶體
  gx.imageSmoothingQuality = 'high'; gx.drawImage(base, 0, 0, N, N);
  const id = gx.getImageData(0, 0, N, N);
  for (let i = 0; i < id.data.length; i += 4) { const v = 0.299 * id.data[i] + 0.587 * id.data[i + 1] + 0.114 * id.data[i + 2]; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; }
  gx.putImageData(id, 0, 0);
  const o = (await runModel('deoldify.onnx', tensorFrom(g, '255'), [1, 3, N, N], '正在幫照片上色…（第一次要下載 64MB）', 1)).output;
  const col = canvasFrom(o.data, N, N, '255'), big = mk(W, H), bx = big.getContext('2d');
  bx.imageSmoothingQuality = 'high'; bx.drawImage(col, 0, 0, W, H);
  const cd = bx.getImageData(0, 0, W, H), sd = base.getContext('2d').getImageData(0, 0, W, H).data;
  for (let i = 0; i < cd.data.length; i += 4) {
    const lum = 0.299 * sd[i] + 0.587 * sd[i + 1] + 0.114 * sd[i + 2], R = cd.data[i], G2 = cd.data[i + 1], B = cd.data[i + 2], y = 0.299 * R + 0.587 * G2 + 0.114 * B;
    cd.data[i] = lum + (R - y); cd.data[i + 1] = lum + (G2 - y); cd.data[i + 2] = lum + (B - y);
  }
  bx.putImageData(cd, 0, 0);
  return big;
}
function confirmHeavy() {
  return new Promise(res => {
    const card = $('#dlgCard'), done = v => { $('#dlg').hidden = true; res(v); };
    card.replaceChildren(h('h2', { text: '黑白上色比較吃記憶體' }),
      h('p', { text: '手機記憶體不夠時，網頁可能會重新整理，目前的修圖會不見。建議先匯出一次再上色，或改用電腦。' }),
      h('div', { class: 'actions' }, h('button', { class: 'btn', text: '取消', onclick: () => done(false) }), h('button', { class: 'btn primary', text: '繼續上色', onclick: () => done(true) })));
    $('#dlg').hidden = false;
  });
}
// 修復完先把「修復前」和「修復後」都留著，強度滑桿就是兩張混合
function setRestore(before, after, label) {
  pushHistory();
  P.restore = { before, after, amt: 100, label };
  const kk = after.width / P.base.width;
  P.base = after; P.paint = mk(after.width, after.height); P.objects.forEach(o => { o.x *= kk; o.y *= kk; o.size *= kk; });
  P.cut = null; P.sky = null; P.tints = []; P.mark = null; P.crop = { x: 0, y: 0, w: 1, h: 1 };
  P.restore.out = P.base;
  showTool('restore'); requestRender();
}
function mixRestore(v) {
  const R = P.restore, c = mk(R.after.width, R.after.height), x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(R.before, 0, 0, c.width, c.height);
  x.globalAlpha = v / 100; x.drawImage(R.after, 0, 0);
  R.amt = v; P.base = c; R.out = c;
  requestRender();
}
async function runRestore(kind) {
  const base = P.base;
  try {
    let out = base, faces = [];
    if (kind === 'all' || kind === 'sr') out = await upscale(base);
    if (kind === 'all' || kind === 'face') {
      try { faces = await detectFaces(out); } catch (e) { faces = []; }
      faces = faces.filter(f => dist(f[33], f[263]) > 12);
      if (faces.length) out = await restoreFaces(out, faces.slice(0, 6), '');
      else if (kind === 'face') { toast('照片裡找不到清楚的臉'); return; }
    }
    if (kind === 'color') {
      // 上色模型要 1GB 以上的記憶體：手機上先提醒，記憶體確定不夠的直接建議用電腦
      if (isTouchDevice()) {
        const mem = navigator.deviceMemory;
        if (mem && mem < 6) { toast('這支手機的記憶體不夠跑黑白上色，請改用電腦開啟網站', 6000); return; }
        if (!(await confirmHeavy())) return;
      }
      out = await colorize(base);
    }
    if (P.base !== base) return;
    const before = mk(out.width, out.height), bx = before.getContext('2d');
    bx.imageSmoothingQuality = 'high'; bx.drawImage(base, 0, 0, out.width, out.height);
    setRestore(before, out, kind);
    toast(kind === 'color' ? '上色完成，顏色太濃可以把「強度」往左拉' : '修復完成' + (kind !== 'face' ? '：' + out.width + ' × ' + out.height + (faces.length ? '，修了 ' + faces.length + ' 張臉' : '') : '') + '。可以用「強度」調整', 5000);
  } catch (e) { aiErrorToast(e); }
}

// ── 證件照 ──
const ID_SPECS = [
  ['tw2', '2 吋（身分證、護照）', 35, 45, 34, 4.2],
  ['tw1', '1 吋（履歷、駕照）', 28, 35, 25, 3.5],
  ['us', '美國簽證 2×2 吋', 51, 51, 30, 8],
  ['cn', '中國簽證', 33, 48, 30, 4]
];   // [代號, 名稱, 寬 mm, 高 mm, 頭頂到下巴 mm, 頭頂上方留白 mm]
const ID_BG = [['#ffffff', '白'], ['#e8f1fb', '淺藍'], ['#3b7fd4', '藍'], ['#d33a3a', '紅']];
async function makeIdPhoto() {
  const src = P.idSrc && P.idSrc.from === P.base ? P.idSrc.base : P.base, spec = ID_SPECS.find(s => s[0] === P.idSpec);
  try {
    aiStatus('正在找臉…', 1);
    const faces = await detectFaces(src);
    aiStatus(null);
    if (!faces.length) { toast('找不到臉。請用正面、臉部清楚的照片'); return; }
    const f = faces[0], matte = await aiMatte(src, 'Xenova/modnet');
    const eL = { x: (f[33].x + f[133].x) / 2, y: (f[33].y + f[133].y) / 2 }, eR = { x: (f[362].x + f[263].x) / 2, y: (f[362].y + f[263].y) / 2 };
    const ang = Math.atan2(eR.y - eL.y, eR.x - eL.x), ca = Math.cos(-ang), sa = Math.sin(-ang);
    const mid = { x: (eL.x + eR.x) / 2, y: (eL.y + eR.y) / 2 }, rot = q => ({ x: mid.x + (q.x - mid.x) * ca - (q.y - mid.y) * sa, y: mid.y + (q.x - mid.x) * sa + (q.y - mid.y) * ca });
    const chin = rot(f[152]);
    // 頭頂：從遮罩找臉正上方最高、還屬於人的那一列（頭髮也算）
    const md = matte.getContext('2d').getImageData(0, 0, matte.width, matte.height).data, fw = dist(f[234], f[454]);
    let top = rot(f[10]).y;
    for (let y = Math.max(0, Math.floor(f[10].y - fw * 1.2)); y < f[10].y; y++) {
      let hit = 0;
      for (let x = Math.floor(f[10].x - fw * 0.25); x < f[10].x + fw * 0.25; x += 2) if (x >= 0 && x < matte.width && md[(y * matte.width + x) * 4 + 3] > 128) hit++;
      if (hit > fw * 0.05) { top = Math.min(top, rot({ x: f[10].x, y }).y); break; }
    }
    // 髮髻、蓬鬆的頭髮不算：頭頂最高只到「額頭到下巴」的 1.35 倍（一般頭頂的位置）
    top = Math.max(top, chin.y - (chin.y - rot(f[10]).y) * 1.35);
    const DPMM = 600 / 25.4, OW = Math.round(spec[2] * DPMM), OH = Math.round(spec[3] * DPMM);
    const k = spec[4] * DPMM / (chin.y - top), out = mk(OW, OH), ox = out.getContext('2d');
    ox.fillStyle = P.idBg; ox.fillRect(0, 0, OW, OH);
    const sub = cloneCanvas(src), sx = sub.getContext('2d');
    sx.globalCompositeOperation = 'destination-in'; sx.drawImage(matte, 0, 0);
    const centerX = rot(f[168]).x;
    // 人先畫在透明的一層上，再疊到底色上
    const L = mk(OW, OH), lx = L.getContext('2d');
    lx.imageSmoothingQuality = 'high';
    lx.translate(OW / 2, spec[5] * DPMM);
    lx.scale(k, k);
    lx.translate(-centerX, -top);
    lx.translate(mid.x, mid.y); lx.rotate(-ang); lx.translate(-mid.x, -mid.y);
    lx.drawImage(sub, 0, 0);
    lx.setTransform(1, 0, 0, 1, 0, 0);
    // 原照片只拍到肩膀時，下方用最底下那排（肩膀、衣服）往下延伸補滿，不留白邊；只延伸人本身的顏色
    const yBot = spec[5] * DPMM + (src.height - top) * k;
    if (yBot < OH) {
      const sy = Math.max(0, Math.floor(yBot - Math.abs(Math.tan(ang)) * OW / 2 - OH * 0.015));   // 擺正後底邊是斜的，取高一點、確定還在照片裡的那一排
      // 把人最下方一小段（肩膀、衣服）往下拉長補滿
      const band = Math.round(OH * 0.06), y0 = Math.max(0, sy - band), seg = mk(OW, sy - y0);
      seg.getContext('2d').drawImage(L, 0, y0, OW, sy - y0, 0, 0, OW, sy - y0);
      lx.clearRect(0, y0, OW, OH - y0);
      lx.drawImage(seg, 0, y0, OW, OH - y0);
    }
    ox.drawImage(L, 0, 0);
    pushHistory();
    const keep = P.idSrc && P.idSrc.from === P.base ? P.idSrc.base : P.base;
    P.base = out; P.paint = mk(OW, OH); P.objects = []; P.sel = null; P.cut = null; P.sky = null; P.tints = []; P.mark = null; P.crop = { x: 0, y: 0, w: 1, h: 1 };
    P.idSrc = { base: keep, from: out };
    showTool('idphoto'); requestRender();
    toast('證件照做好了（' + spec[1] + '）。按右上角「匯出」是單張電子檔，也可以匯出沖洗用的排版', 6000);
  } catch (e) { aiStatus(null); aiErrorToast(e); }
}
function exportIdSheet() {
  const spec = ID_SPECS.find(s => s[0] === P.idSpec), one = mk(4, 4);
  renderPhoto(one, 0, { final: true, scale: 0.5 });   // 600 dpi 做的，沖洗用 300 dpi 就夠
  const DP = 300 / 25.4, SW = 1800, SH = 1200, w = spec[2] * DP, hh = spec[3] * DP, gap = 3 * DP;
  const cols = Math.floor((SW - gap) / (w + gap)), rows = Math.floor((SH - gap) / (hh + gap));
  const sheet = mk(SW, SH), x = sheet.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, SW, SH);
  const ox = (SW - cols * w - (cols - 1) * gap) / 2, oy = (SH - rows * hh - (rows - 1) * gap) / 2;
  x.strokeStyle = '#c8c8c8'; x.lineWidth = 1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const px = ox + c * (w + gap), py = oy + r * (hh + gap);
    x.drawImage(one, px, py, w, hh); x.strokeRect(px - 0.5, py - 0.5, w + 1, hh + 1);
  }
  saveCanvas(sheet, '證件照沖洗排版_4x6', { fmt: 'jpg', q: 95 });
  toast('排版是 4×6 吋（' + cols * rows + ' 張），拿去沖洗時選「4×6」、「不要裁切」', 6000);
}

// ── 一次修很多張：把目前的調色、濾鏡、美顏、五官、化妝套到其他照片，一起匯出 ──
async function batchExport() {
  const files = (await pickFiles($('#fileImgs'))).filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  const keep = { base: P.base, paint: P.paint, objects: P.objects, sel: P.sel, cut: P.cut, sky: P.sky, tints: P.tints, mark: P.mark, frame: P.frame, restore: P.restore };
  const outs = [], mime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[EXP.photo.fmt] || 'image/jpeg';
  try {
    for (let i = 0; i < files.length; i++) {
      aiStatus('正在修第 ' + (i + 1) + ' / ' + files.length + ' 張…', i / files.length);
      let cv;
      try { cv = await fileToCanvas(files[i], PHOTO_MAX); } catch (e) { continue; }
      if (shapeActive() || makeupActive()) { const f = await detectFaces(cv).catch(() => []); PRO.faces = f; PRO.facesFor = cv; PRO.facesJobFor = cv; }
      Object.assign(P, { base: cv, paint: mk(cv.width, cv.height), objects: [], sel: null, cut: null, sky: null, tints: [], mark: null });
      const out = mk(4, 4);
      renderPhoto(out, 0, { final: true, scale: photoExportScale() });
      Object.assign(P, keep);
      const blob = await new Promise(r => out.toBlob(r, mime, EXP.photo.q / 100));
      if (blob) outs.push(new File([blob], files[i].name.replace(/\.[^.]+$/, '') + '_修圖.' + (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'), { type: mime }));
      await new Promise(r => setTimeout(r, 0));
    }
  } finally { Object.assign(P, keep); aiStatus(null); requestRender(); }
  if (!outs.length) { toast('沒有可以處理的照片'); return; }
  let canShare = false;
  try { canShare = isTouchDevice() && !!(navigator.share && navigator.canShare && navigator.canShare({ files: outs })); } catch (e) { canShare = false; }
  if (canShare) {
    const card = $('#dlgCard');
    card.replaceChildren(h('h2', { text: outs.length + ' 張都修好了' }),
      h('button', { class: 'btn primary wide big', text: '存到相簿（' + outs.length + ' 張）', onclick: async () => { try { await navigator.share({ files: outs }); $('#dlg').hidden = true; toast('完成'); } catch (e) { if (e.name !== 'AbortError') toast('無法分享，請改用下載'); } } }),
      h('button', { class: 'btn wide', text: '一張一張下載', onclick: () => { outs.forEach((f, i) => setTimeout(() => downloadBlob(f.name, f), i * 400)); $('#dlg').hidden = true; } }),
      h('div', { class: 'actions' }, h('button', { class: 'btn', text: '關閉', onclick: () => { $('#dlg').hidden = true; } })));
    $('#dlg').hidden = false;
  } else if (window.claude && window.claude.use) { for (const f of outs) await saveFile(f.name, f); }
  else { outs.forEach((f, i) => setTimeout(() => downloadBlob(f.name, f), i * 400)); toast('已下載 ' + outs.length + ' 張', 4000); }
}

// ── 畫布上的點選：換色的「點選物件」 ──
function proPointer(p) {
  if (P.tool !== 'recolor' || P.tintPart !== 'tap') return false;
  const base = P.base;
  aiSegment(base, [p]).then(sel => {
    if (!sel || P.base !== base) { if (!sel) toast('沒有選到東西，換個位置再點一次'); return; }
    addTint('tap', sel);
  }, aiErrorToast);
  return true;
}
function addTint(part, mask) {
  pushHistory();
  const old = P.tints.findIndex(t => t.part === part && part !== 'tap');
  const t = { part, mask, color: P.tintColor, amt: 80, meanL: maskMeanL(P.base, mask) };
  if (old >= 0) P.tints[old] = t; else P.tints.push(t);
  P.tintSel = P.tints.indexOf(t);
  showTool('recolor'); requestRender();
}
async function pickPart(part) {
  P.tintPart = part;
  if (part === 'tap') { showTool('recolor'); toast('在照片上點一下要換色的東西'); return; }
  const base = P.base;
  try {
    aiStatus(part === 'hair' ? '正在找出頭髮…' : '正在找出衣服…', 1);
    const m = await partMask(base, part === 'hair' ? 1 : 4);
    aiStatus(null);
    if (P.base !== base) return;
    if (!m) { toast(part === 'hair' ? '找不到頭髮' : '找不到衣服', 3500); showTool('recolor'); return; }
    addTint(part, m);
  } catch (e) { aiStatus(null); aiErrorToast(e); }
}

// ── 面板 ──
Object.assign(PANELS, {
  body(el) {
    el.append(h('h2', { text: '美體' }));
    const B = P.body && P.body.out === P.base ? P.body : null;
    if (!B) { prepareBody(); el.append(h('p', { text: '正在找出身形…第一次使用要下載約 9MB 的模型。' })); return; }
    if (B.busy) { el.append(h('p', { text: '正在找出身形…第一次使用要下載約 9MB 的模型。' })); return; }
    if (B.none) { el.append(h('p', { class: 'warn', text: '找不到人的身體。請用拍到肩膀和腰的照片（全身照效果最好）。' })); return; }
    const live = key => v => { B[key] = v; applyBody(); };
    slider(el, { label: '長腿', min: 0, max: 100, value: B.legs, def: 0, onStart: pushHistory, onInput: live('legs') });
    slider(el, { label: '增高', min: 0, max: 100, value: B.height, def: 0, onStart: pushHistory, onInput: live('height') });
    slider(el, { label: '瘦身（腰和臀部）', min: 0, max: 100, value: B.slim, def: 0, onStart: pushHistory, onInput: live('slim') });
    if (!B.G.legsVisible) el.append(h('p', { text: '這張照片沒拍到腳，長腿會把腰以下全部拉長。' }));
    el.append(h('p', { text: '照片會跟著變高一點，背景也會一起拉長；拉太多看起來會不自然，建議不要超過一半。' }));
  },
  sky(el) {
    el.append(h('h2', { text: '換天空' }));
    if (!P.sky) {
      el.append(h('button', {
        class: 'btn primary wide', text: '一鍵換天空', onclick: async () => {
          const base = P.base;
          try {
            const mask = await skySegment(base);
            if (P.base !== base) return;
            const b = maskBox(mask);
            if (!b || b.frac < 0.02) { toast('這張照片找不到天空', 3500); return; }
            pushHistory();
            P.sky = { mask, type: 'clouds', harmon: 40, img: null, imgId: 0 };
            showTool('sky'); requestRender();
          } catch (e) { aiErrorToast(e); }
        }
      }));
      el.append(h('p', { text: '自動找出天空，換成藍天、晚霞或星空，前景也會跟著調成相配的顏色。第一次使用要下載約 29MB 的模型。' }));
      return;
    }
    const sk = P.sky;
    chips(el, SKY_TYPES, sk.type, async v => {
      if (v === 'image') {
        const [f] = await pickFiles($('#fileImg'));
        if (!f) { showTool('sky'); return; }
        try { sk.img = await fileToCanvas(f, 3000); sk.imgId++; } catch (e) { toast('無法讀取 ' + f.name); return; }
      }
      pushHistory(); sk.type = v; showTool('sky'); requestRender();
    });
    slider(el, { label: '前景融合', min: 0, max: 100, value: sk.harmon, def: 40, onStart: pushHistory, onInput: v => { sk.harmon = v; requestRender(); } });
    el.append(h('button', { class: 'btn danger wide', text: '取消換天空', onclick: () => { pushHistory(); P.sky = null; showTool('sky'); requestRender(); } }));
  },
  recolor(el) {
    el.append(h('h2', { text: '換色' }));
    el.append(h('h3', { text: '要換顏色的地方' }));
    chips(el, [['hair', '頭髮'], ['clothes', '衣服'], ['tap', '點選物件']], P.tintPart, pickPart);
    const t = P.tints[P.tintSel];
    if (!t) { el.append(h('p', { text: '選「頭髮」或「衣服」會自動找出範圍；其他東西選「點選物件」再點一下照片。' })); return; }
    el.append(h('h3', { text: '顏色' }));
    swatches(el, TINT_COLORS, t.color, c => { t.color = P.tintColor = c; requestRender(); });
    slider(el, { label: '強度', min: 0, max: 100, value: t.amt, def: 80, onStart: pushHistory, onInput: v => { t.amt = v; requestRender(); } });
    if (P.tints.length > 1) {
      el.append(h('h3', { text: '已經換色的地方' }));
      el.append(h('div', { class: 'chips' }, P.tints.map((x, i) => h('button', { class: 'btn', 'aria-pressed': String(i === P.tintSel), text: { hair: '頭髮', clothes: '衣服', tap: '物件' }[x.part] + (x.part === 'tap' ? ' ' + (P.tints.slice(0, i + 1).filter(y => y.part === 'tap').length) : ''), onclick: () => { P.tintSel = i; showTool('recolor'); } }))));
    }
    el.append(h('button', { class: 'btn danger wide', text: '取消這個換色', onclick: () => { pushHistory(); P.tints.splice(P.tintSel, 1); P.tintSel = P.tints.length - 1; showTool('recolor'); requestRender(); } }));
  },
  idphoto(el) {
    el.append(h('h2', { text: '證件照' }));
    const made = P.idSrc && P.idSrc.from === P.base;
    el.append(h('h3', { text: '規格' }));
    chips(el, ID_SPECS.map(s => [s[0], s[1]]), P.idSpec, v => { P.idSpec = v; showTool('idphoto'); });
    el.append(h('h3', { text: '底色' }));
    chips(el, ID_BG, P.idBg, v => { P.idBg = v; showTool('idphoto'); });
    el.append(h('button', { class: 'btn primary wide', text: made ? '用新的規格、底色重做' : '製作證件照', onclick: makeIdPhoto }));
    if (made) {
      el.append(h('button', { class: 'btn wide', text: '匯出沖洗用排版（4×6 吋）', onclick: exportIdSheet }));
      el.append(h('p', { text: '做好後還可以到「美顏」磨皮、美白，到「調整」調亮度，排版和電子檔都會一起套用。' }));
    } else el.append(h('p', { text: '用正面、表情自然、臉部清楚的照片。會自動去背換底色、把臉擺正，並依規格裁成標準大小（600 dpi）。' }));
  },
  restore(el) {
    el.append(h('h2', { text: 'AI 修復' }));
    el.append(h('button', { class: 'btn primary wide', text: '一鍵修復（畫質＋臉部）', onclick: () => runRestore('all') }));
    el.append(h('div', { class: 'btn-row' },
      h('button', { class: 'btn', text: '只修臉部', onclick: () => runRestore('face') }),
      h('button', { class: 'btn', text: '黑白照上色', onclick: () => runRestore('color') }),
      h('button', { class: 'btn', text: '只提升畫質', onclick: () => runRestore('sr') })));
    if (P.restore && P.restore.out === P.base) slider(el, { label: '強度', min: 0, max: 100, value: P.restore.amt, def: 100, fmt: v => v + '%', onInput: mixRestore });
    el.append(h('p', { text: '模糊、雜訊多、解析度低的照片會變清楚，臉部五官會重新補上細節。黑白照片可以自動上色。第一次使用要下載模型（臉部 ' + (isTouchDevice() ? '19' : '85') + 'MB、上色 64MB）。' }));
  }
});
// 美顏面板加上「五官」和「化妝」
const _beautyPanel = PANELS.beauty;
PANELS.beauty = function (el) {
  _beautyPanel(el);
  const root = el, faces = facesFor(P.base), noFace = faces && !faces.length;
  let g = group(root, 'beauty.face', '五官（大眼、瘦臉、瘦鼻、微笑）');
  if (noFace) g.append(h('p', { class: 'warn', text: '這張照片找不到臉，五官和化妝不能用。' }));
  else {
    if (!faces) g.append(h('p', { text: '正在找臉…' }));
    for (const [k, label, mn, mx] of SHAPE_KEYS) slider(g, { label, min: mn, max: mx, value: P.shape[k], def: 0, onStart: pushHistory, onInput: v => { P.shape[k] = v; requestRender(); } });
    if (faces && faces.length > 1) g.append(h('p', { text: '找到 ' + faces.length + ' 張臉，會一起調整。' }));
  }
  g = group(root, 'beauty.makeup', '化妝（口紅、腮紅、眼影）');
  if (noFace) return;
  chips(g, MAKEUP_PRESETS.map(([k, n]) => [k, n]), P.makeup.preset || 'none', v => { pushHistory(); const pr = MAKEUP_PRESETS.find(p => p[0] === v)[2]; Object.assign(P.makeup, pr, { preset: v }); showTool('beauty'); requestRender(); });
  slider(g, { label: '口紅', min: 0, max: 100, value: P.makeup.lip, def: 0, onStart: pushHistory, onInput: v => { P.makeup.lip = v; requestRender(); } });
  swatches(g, LIP_COLORS, P.makeup.lipColor, c => { P.makeup.lipColor = c; requestRender(); });
  slider(g, { label: '腮紅', min: 0, max: 100, value: P.makeup.blush, def: 0, onStart: pushHistory, onInput: v => { P.makeup.blush = v; requestRender(); } });
  slider(g, { label: '眼影', min: 0, max: 100, value: P.makeup.shadow, def: 0, onStart: pushHistory, onInput: v => { P.makeup.shadow = v; requestRender(); } });
};
// 去背面板：還沒去背時多一個「人像模式」
const _cutPanel = PANELS.cutout;
PANELS.cutout = function (el) {
  _cutPanel(el);
  if (P.cut) return;
  const btn = $$('button', el).find(b => b.textContent === '一鍵去背');
  btn.after(h('button', { class: 'btn wide', text: '人像模式（背景變模糊）', onclick: () => runCutout({ portrait: true }) }));
};

// 新工具排進左邊工具列
(function () {
  const at = (after, item) => PHOTO_TOOLS.splice(PHOTO_TOOLS.findIndex(t => t[0] === after) + 1, 0, item);
  at('beauty', ['body', '美體']);
  at('retouch', ['restore', 'AI 修復']);
  at('cutout', ['sky', '換天空']);
  at('sky', ['recolor', '換色']);
  at('wm', ['idphoto', '證件照']);
  Object.assign(TOOL_ICONS, {
    body: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M8 9.5l4-1.5 4 1.5M12 14l-3 6.5M12 14l3 6.5"/>',
    restore: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v3.5h3.5"/><path d="M12 8.5v4l2.6 1.6"/>',
    sky: '<path d="M6.5 17.5h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6-1.4A4 4 0 0 0 6.5 17.5z"/><path d="M3 21h18"/>',
    recolor: '<path d="M12 3.5c3.5 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2.5-6 6-10z"/><path d="M9 14.5a3 3 0 0 0 3 3"/>',
    idphoto: '<rect x="4.5" y="3" width="15" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7.5 18c.8-2.4 2.4-3.6 4.5-3.6s3.7 1.2 4.5 3.6"/>'
  });
})();
