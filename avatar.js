// 虛擬人：一張人像照片 + 一段話 → 會開口說話的影片
// 做法：找出照片裡臉部的定位點，依語音的音量讓下巴和嘴巴開合、眼睛眨動、頭輕微擺動。
// 文字用瀏覽器裡的語音模型唸出來（不上傳）。這是「會動的照片」，不是重新生成一個人，
// 嘴型跟著音量和聲音的高低開合，不會精確對出每個字的口型。
const AVC = $('#avc');
const avx = AVC.getContext('2d');
// 各語言可用的語音模型（f 女聲、m 男聲）。只有一種性別的語言，另一種用調整音高的方式模擬。
// 台語、客語沒有能直接唸漢字的模型，改用麥克風錄音。
const AV_LANGS = [
  ['zh', '中文', { f: 'zh_CN-huayan-medium' }],
  ['en', '英文', { f: 'en_US-hfc_female-medium', m: 'en_US-hfc_male-medium' }],
  ['nan', '台語', null],
  ['hak', '客語', null],
  ['es', '西班牙文', { f: 'es_MX-claude-high', m: 'es_ES-davefx-medium' }],
  ['fr', '法文', { f: 'fr_FR-siwis-medium', m: 'fr_FR-tom-medium' }],
  ['de', '德文', { f: 'de_DE-kerstin-low', m: 'de_DE-thorsten-medium' }],
  ['it', '義大利文', { f: 'it_IT-paola-medium', m: 'it_IT-riccardo-x_low' }],
  ['pt', '葡萄牙文', { m: 'pt_BR-faber-medium' }],
  ['ru', '俄文', { f: 'ru_RU-irina-medium', m: 'ru_RU-denis-medium' }],
  ['vi', '越南文', { f: 'vi_VN-vais1000-medium' }],   // 另一個男聲模型實測會執行失敗，男聲用模擬的
  ['nl', '荷蘭文', { f: 'nl_BE-nathalie-medium', m: 'nl_BE-rdh-medium' }],
  ['pl', '波蘭文', { f: 'pl_PL-gosia-medium', m: 'pl_PL-darkman-medium' }],
  ['tr', '土耳其文', { m: 'tr_TR-dfki-medium' }],
  ['ar', '阿拉伯文', { m: 'ar_JO-kareem-medium' }]
];
// 回傳要用的模型和音高倍率（1 表示不用調）；這個語言沒有模型時回傳 null
function voiceFor(lang, gender) {
  const t = (AV_LANGS.find(l => l[0] === lang) || [])[2];
  if (!t) return null;
  if (t[gender]) return { id: t[gender], shift: 1 };
  return gender === 'm' ? { id: t.f, shift: 0.74 } : { id: t.m, shift: 1.4 };
}
// 改變音高但不改變說話速度：先重新取樣（音高和長度一起變），再把長度拉回來
function pitchShift(x, factor) {
  const n1 = Math.floor(x.length / factor), y = new Float32Array(n1);
  for (let i = 0; i < n1; i++) { const p = i * factor, k = Math.floor(p), f = p - k; y[i] = x[k] * (1 - f) + (x[k + 1] || 0) * f; }
  // 把 y 的長度縮放回原本的長度：一小段一小段接起來，每段都挑波形最接得上的位置（WSOLA）
  const win = 1440, hs = win / 2, ha = hs * n1 / x.length, tol = 480, out = new Float32Array(x.length + win), wsum = new Float32Array(x.length + win), hann = new Float32Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / win);
  let prev = 0;
  for (let k = 0; k * hs < x.length; k++) {
    const ideal = Math.round(k * ha);
    let best = clamp(ideal, 0, Math.max(0, n1 - win));
    if (k > 0) {
      const want = prev + hs;   // 上一段自然接下去的位置
      let bs = -Infinity;
      for (let d = -tol; d <= tol; d += 4) {
        const c = ideal + d;
        if (c < 0 || c + win >= n1 || want + win >= n1) continue;
        let sc = 0;
        for (let i = 0; i < hs; i += 6) sc += y[c + i] * y[want + i];
        if (sc > bs) { bs = sc; best = c; }
      }
    }
    prev = best;
    const o = k * hs;
    for (let i = 0; i < win && best + i < n1; i++) { out[o + i] += y[best + i] * hann[i]; wsum[o + i] += hann[i]; }
  }
  const res = new Float32Array(x.length);
  for (let i = 0; i < res.length; i++) res[i] = wsum[i] > 1e-3 ? out[i] / wsum[i] : 0;
  return res;
}
function pcmToWav(pcm, sr) {
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf), str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, clamp(pcm[i], -1, 1) * 32767, true);
  return new Blob([buf], { type: 'audio/wav' });
}
async function decodeMono48k(blob) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ab = await new OAC(1, 1, 48000).decodeAudioData(await blob.arrayBuffer());
  const pcm = new Float32Array(ab.length);
  for (let ch = 0; ch < ab.numberOfChannels; ch++) { const d = ab.getChannelData(ch); for (let i = 0; i < d.length; i++) pcm[i] += d[i] / ab.numberOfChannels; }
  return pcm;
}
const AV_ASPECTS = [['orig', '照片原比例'], ['9:16', '直式 9:16'], ['1:1', '方形 1:1'], ['16:9', '橫式 16:9']];
const PIPER_URL = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/+esm';
const PIPER_PATHS = {
  onnxWasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
  piperData: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data',
  piperWasm: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm'
};
const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const AV = {
  img: null, pix: null, face: null, frame: null,
  text: '', gender: 'f', lang: 'zh', audio: null, lines: [], rec: null,
  el: null, playing: false, t: 0, amt: 70, blink: true, sway: true, caps: true, aspect: 'orig',
  rig: null, style: 'natural', head: 100, smile: 0, brows: true,
  busy: false, cancel: false, tts: null, detector: null
};

// ── 臉部定位 ──
async function detectFace(canvas) {
  if (!AV.detector) {
    const vision = await import(VISION_URL + '/+esm');
    AV.conns = vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION;   // 臉部網格的連接方式，建立網格時要用
    const files = await vision.FilesetResolver.forVisionTasks(VISION_URL + '/wasm');
    AV.detector = await vision.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1 });
  }
  const res = AV.detector.detect(canvas);
  return res.faceLandmarks && res.faceLandmarks[0] ? res.faceLandmarks[0] : null;
}
// 把定位點整理成動畫要用的幾何：下唇內緣那條線、嘴角、下巴、兩眼的上下眼瞼
function buildFace(lm, W, H) {
  const P = i => ({ x: lm[i].x * W, y: lm[i].y * H });
  const line = ids => ids.map(P).sort((a, b) => a.x - b.x);
  const lower = line([78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308]);
  const L = lower[0], R = lower[lower.length - 1], chin = P(152), mw = R.x - L.x;
  const lipMid = lower[Math.floor(lower.length / 2)].y;
  const box = (x0, y0, x1, y1) => ({ x0: Math.max(0, Math.floor(x0)), y0: Math.max(0, Math.floor(y0)), x1: Math.min(W, Math.ceil(x1)), y1: Math.min(H, Math.ceil(y1)) });
  const eye = (up, low) => {
    const u = line(up), l = line(low), x0 = u[0].x, x1 = u[u.length - 1].x;
    const top = Math.min(...u.map(p => p.y)), bot = Math.max(...l.map(p => p.y)), gap = bot - top;
    return { u, l, x0, x1, box: box(x0 - 2, top - gap * 1.6, x1 + 2, bot + 2) };
  };
  let fx0 = W, fy0 = H, fx1 = 0, fy1 = 0;
  for (const p of lm) { fx0 = Math.min(fx0, p.x * W); fx1 = Math.max(fx1, p.x * W); fy0 = Math.min(fy0, p.y * H); fy1 = Math.max(fy1, p.y * H); }
  return {
    lower, xL: L.x, xR: R.x, mw, chinY: chin.y, lipMid,
    mouthBox: box(L.x - mw * 0.6, Math.min(...lower.map(p => p.y)) - 2, R.x + mw * 0.6, chin.y + (chin.y - lipMid) * 0.55),
    eyes: [eye([33, 246, 161, 160, 159, 158, 157, 173, 133], [33, 7, 163, 144, 145, 153, 154, 155, 133]),
      eye([362, 398, 384, 385, 386, 387, 388, 466, 263], [362, 382, 381, 380, 374, 373, 390, 249, 263])],
    cx: (fx0 + fx1) / 2, cy: (fy0 + fy1) / 2, size: fx1 - fx0
  };
}
// 折線在 x 的高度；超出兩端就用端點
function lineY(pts, x) {
  if (x <= pts[0].x) return pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i].x) { const a = pts[i - 1], b = pts[i], t = (x - a.x) / Math.max(1e-6, b.x - a.x); return a.y + (b.y - a.y) * t; }
  }
  return pts[pts.length - 1].y;
}

// ── 每一格的臉：嘴巴張開 open（0..1）、眨眼 blink（0..1）──
function drawFaceFrame(open, blink) {
  const img = AV.img, W = img.width, maxY = img.height - 1.001, f = AV.face, src = AV.pix.data, fx = AV.frame.getContext('2d');
  fx.drawImage(img, 0, 0);
  const O = open * (f.chinY - f.lipMid) * 0.26 * AV.amt / 100;
  if (O > 0.3) {
    const b = f.mouthBox, bw = b.x1 - b.x0, bh = b.y1 - b.y0, out = fx.createImageData(bw, bh), o = out.data;
    for (let x = 0; x < bw; x++) {
      const X = b.x0 + x, ly = lineY(f.lower, X), u = (X - f.xL) / f.mw;
      const prof = u > 0 && u < 1 ? Math.pow(Math.sin(Math.PI * u), 0.75) : 0;   // 嘴角不動、中間張最大
      const side = u < 0 ? -u : u > 1 ? u - 1 : 0, jaw = side >= 0.55 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * side / 0.55);   // 下巴往兩側漸漸不動
      const D = Math.max(12, (f.chinY - ly) * 1.5);
      for (let y = 0; y < bh; y++) {
        const Y = b.y0 + y, td = Y - ly, oi = (y * bw + x) * 4;
        let sy = Y, inside = 0;
        if (td > 0 && td < D) {
          // 下唇以下的皮膚往下推，越靠近下巴底部推得越少；這裡反過來解出這個位置原本是哪一列
          let ts = td;
          for (let k = 0; k < 4; k++) {
            const q = clamp(ts / D, 0, 1), g = (1 - q) * (1 - q) * (1 + 2 * q), m = Math.min(1, q / 0.3);
            ts = td - O * g * (prof + (jaw - prof) * m);
          }
          if (ts < 0) { inside = Math.min(1, -ts); ts = 0; }
          sy = Math.min(maxY, ly + ts);
        }
        const y0 = Math.floor(sy), fy = sy - y0, i0 = (y0 * W + X) * 4, i1 = i0 + W * 4;
        let r = src[i0] * (1 - fy) + src[i1] * fy, g2 = src[i0 + 1] * (1 - fy) + src[i1 + 1] * fy, bl = src[i0 + 2] * (1 - fy) + src[i1 + 2] * fy;
        if (inside) { r += (34 - r) * inside; g2 += (10 - g2) * inside; bl += (14 - bl) * inside; }   // 張開露出來的口腔，深色
        o[oi] = r; o[oi + 1] = g2; o[oi + 2] = bl; o[oi + 3] = 255;
      }
    }
    fx.putImageData(out, b.x0, b.y0);
  }
  if (blink > 0.02) {
    for (const e of f.eyes) {
      const b = e.box, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      if (bw < 2 || bh < 2) continue;
      const out = fx.createImageData(bw, bh), o = out.data;
      for (let x = 0; x < bw; x++) {
        const X = b.x0 + x, uy = lineY(e.u, X), lowy = lineY(e.l, X), gap = Math.max(0, lowy - uy);
        const inEye = X > e.x0 && X < e.x1, strip = gap * 1.3 + 2, top = uy - strip, cover = inEye ? gap * blink : 0;
        for (let y = 0; y < bh; y++) {
          const Y = b.y0 + y, oi = (y * bw + x) * 4;
          // 把眼睛上方那一小條皮膚往下拉，蓋住眼睛
          const sy = clamp(cover > 0 && Y > top && Y < uy + cover ? top + (Y - top) * strip / (strip + cover) : Y, 0, maxY);
          const y0 = Math.floor(sy), fy = sy - y0, i0 = (y0 * W + X) * 4, i1 = i0 + W * 4;
          o[oi] = src[i0] * (1 - fy) + src[i1] * fy; o[oi + 1] = src[i0 + 1] * (1 - fy) + src[i1 + 1] * fy; o[oi + 2] = src[i0 + 2] * (1 - fy) + src[i1 + 2] * fy; o[oi + 3] = 255;
        }
      }
      fx.putImageData(out, b.x0, b.y0);
    }
  }
}
// 每隔 3 到 5 秒眨一次眼，一次約 0.18 秒
// 眨眼：每隔 2.5 到 5 秒一次，偶爾連眨兩下；閉得快、張得慢
function blinkAt(t) {
  if (!AV.blink) return 0;
  const shape = d => (d < 0 || d > 0.22 ? 0 : d < 0.07 ? d / 0.07 : 1 - (d - 0.07) / 0.15);
  let start = 0.9, n = 0, v = 0;
  while (start < t + 0.01) {
    v = Math.max(v, shape(t - start));
    if (n % 4 === 2) v = Math.max(v, shape(t - start - 0.3));   // 連眨兩下
    start += 2.5 + ((n * 7919) % 100) / 40;
    n++;
  }
  return v;
}
const AV_STYLES = [
  ['natural', '自然', { head: 1, nod: 1, brow: 1 }],
  ['calm', '沉穩', { head: 0.45, nod: 0.5, brow: 0.5 }],
  ['lively', '活潑', { head: 1.7, nod: 1.5, brow: 1.4 }],
  ['nod', '頻頻點頭', { head: 0.8, nod: 2.4, brow: 0.9 }],
  ['still', '只動臉', { head: 0, nod: 0, brow: 1 }]
];
function sampleAt(arr, t) {
  const p = t * 60, i = Math.floor(p);
  if (!arr || i < 0 || i >= arr.length - 1) return 0;
  return arr[i] + (arr[i + 1] - arr[i]) * (p - i);
}
// 時間 t 的整體姿勢：嘴巴跟著聲音，頭和眉毛是「緩慢的隨機擺動」加上「語氣加重時點一下頭、挑一下眉」
function poseAt(t) {
  const a = AV.audio, r = AV.rig, st = AV_STYLES.find(x => x[0] === AV.style)[2], k = AV.head / 100 * st.head;
  const open = sampleAt(a && a.env, t), wide = sampleAt(a && a.wide, t);
  let nod = 0, brow = 0;
  if (a) for (const e of a.emph) {
    const d = t - e + 0.1;
    if (d > 0 && d < 0.7) nod += Math.pow(Math.sin(Math.PI * d / 0.7), 2);
    if (d > 0 && d < 0.5) brow += Math.sin(Math.PI * d / 0.5);
  }
  // 幾個不同快慢的波疊起來，看起來不會像規律的鐘擺
  const yaw = (Math.sin(t * 0.53 + 1.3) * 0.55 + Math.sin(t * 1.27 + 0.4) * 0.3 + Math.sin(t * 2.9) * 0.08) * 4.5 * k;
  const pitch = (Math.sin(t * 0.61 + 2.1) * 0.5 + Math.sin(t * 1.53) * 0.3) * 2.4 * k + nod * 3.4 * st.nod * AV.head / 100 + open * 0.9 * k;
  const roll = (Math.sin(t * 0.41 + 0.7) * 0.6 + Math.sin(t * 1.1 + 2) * 0.25) * 2.2 * k;
  return {
    jaw: open * (r.chinY - r.lipMid) * 0.3 * AV.amt / 100 * (1 - 0.35 * wide),
    wide: wide * 0.9 - open * 0.3, smile: AV.smile / 100 * (1 - open * 0.25),
    brow: AV.brows ? Math.min(1, brow * st.brow) * 0.9 + open * 0.12 : 0,
    blink: blinkAt(t), yaw, pitch, roll,
    tx: Math.sin(t * 0.37 + 0.5) * r.size * 0.012 * k, ty: Math.sin(t * 0.83) * r.size * 0.006 * k
  };
}
function openAt(t) {
  const a = AV.audio;
  if (!a) return 0;
  const p = t * 60, i = Math.floor(p), e = a.env;
  if (i < 0 || i >= e.length - 1) return 0;
  return e[i] + (e[i + 1] - e[i]) * (p - i);
}
function avatarSize() {
  const iw = AV.img.width, ih = AV.img.height, even = v => Math.max(2, Math.round(v / 2) * 2);
  if (AV.aspect === '9:16') return [1080, 1920];
  if (AV.aspect === '1:1') return [1080, 1080];
  if (AV.aspect === '16:9') return [1920, 1080];
  const k = Math.min(1, 1440 / Math.max(iw, ih));
  return [even(iw * k), even(ih * k)];
}
// 畫出時間 t 的整個畫面到 canvas
function avatarDraw(canvas, t) {
  const [W, H] = avatarSize(), ctx = canvas.getContext('2d');
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const open = openAt(t), rig = AV.rig;
  let frame = AV.frame;
  if (rig) frame = rigRender(rig, poseAt(t));
  else drawFaceFrame(open, blinkAt(t));
  const iw = AV.img.width, ih = AV.img.height, f = AV.face, swayAll = !rig && AV.sway;
  const s = Math.max(W / iw, H / ih) * (swayAll ? 1.035 : 1);
  // 裁切時盡量把臉放在畫面中間偏上
  const ox = clamp(W / 2 - f.cx * s, W - iw * s, 0), oy = clamp(H * 0.42 - f.cy * s, H - ih * s, 0);
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (swayAll) {
    const px = ox + f.cx * s, py = oy + f.cy * s;
    ctx.translate(px + Math.sin(t * 0.7) * W * 0.004, py + Math.sin(t * 1.3) * H * 0.003 + open * H * 0.002);
    ctx.rotate((Math.sin(t * 0.9) * 0.6 + Math.sin(t * 2.3) * 0.25) * Math.PI / 180);
    ctx.translate(-px, -py);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(frame, ox, oy, iw * s, ih * s);
  ctx.restore();
  if (AV.caps) {
    const line = AV.lines.find(l => t >= l.start && t < l.end);
    if (line) {
      let size = Math.min(W, H) * 0.06;
      ctx.font = '700 ' + size + 'px ' + FONTS.hei[1];
      const tw = ctx.measureText(line.text).width;
      if (tw > W * 0.9) { size *= W * 0.9 / tw; ctx.font = '700 ' + size + 'px ' + FONTS.hei[1]; }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = size * 0.18; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.fillStyle = '#ffffff';
      ctx.strokeText(line.text, W / 2, H * 0.9); ctx.fillText(line.text, W / 2, H * 0.9);
    }
  }
}
function avatarRefresh() {
  if (!AV.img) return;
  avatarDraw(AVC, AV.t);
  fit(AVC);
}

// ── 照片與聲音 ──
async function setAvatarPhoto(file) {
  if (AV.busy) return;
  AV.busy = true;
  aiStatus('正在找出照片裡的臉…（第一次使用要下載一個小模型）', 1);
  try {
    const cv = await fileToCanvas(file, 1600), lm = await detectFace(cv);
    if (!lm) { toast('這張照片找不到臉。請換一張正面、臉部清楚、沒有被遮住的照片。', 5000); return; }
    avatarStop();
    AV.img = cv;
    AV.pix = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
    AV.frame = mk(cv.width, cv.height);
    AV.face = buildFace(lm, cv.width, cv.height);
    // 臉部網格建不起來（瀏覽器不支援 WebGL、套件載不到）時 rig 是 null，會退回只動嘴巴和眼睛的簡單做法
    try { AV.rig = await buildRig(cv, lm, AV.conns); } catch (e) { AV.rig = null; }
    AV.t = 0;
    syncAvatarEmpty(); avatarPanel(); avatarRefresh();
  } catch (e) {
    toast('臉部偵測無法啟動：下載不到模型。請確認網路；在 Claude 頁面裡請改用獨立網址版本。', 6500);
  } finally {
    AV.busy = false; aiStatus(null);
    avatarPanel();   // 處理期間按鈕是停用的，結束後重畫才會恢復
  }
}
// 把一段聲音設成虛擬人要說的話：算出每 1/60 秒的嘴巴開合程度
async function setAvatarAudio(blob, text) {
  const pcm = await decodeMono48k(blob);
  const hop = 800, n = Math.floor(pcm.length / hop), raw = new Float32Array(n), env = new Float32Array(n + 2);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * hop, e = j + hop; j < e; j += 2) s += pcm[j] * pcm[j]; raw[i] = Math.sqrt(s / (hop / 2)); }
  const sorted = Float32Array.from(raw).sort(), ref = Math.max(1e-4, sorted[Math.floor(n * 0.9)] || 0);
  let v = 0;
  for (let i = 0; i < n; i++) {
    const target = clamp((raw[i] / ref - 0.1) * 1.2, 0, 1);
    v += (target - v) * (target > v ? 0.55 : 0.28);   // 張開快、合起來慢一點，比較像真的在說話
    env[i] = v;
  }
  // 嘴型寬窄：ㄙ、ㄒ、ㄧ這類聲音高頻多，嘴角往兩邊拉；ㄨ、ㄛ這類低沉的聲音嘴巴比較圓
  const wide = new Float32Array(n + 2);
  let wv = 0;
  for (let i = 0; i < n; i++) {
    let z = 0;
    for (let j = i * hop + 1, e = j + hop - 1; j < e; j++) if ((pcm[j] >= 0) !== (pcm[j - 1] >= 0)) z++;
    const target = raw[i] / ref < 0.12 ? 0 : clamp((z / hop - 0.05) / 0.13, 0, 1);
    wv += (target - wv) * 0.4;
    wide[i] = wv;
  }
  // 語氣加重的地方：音量從小突然變大，而且跟上一次隔一小段時間
  const emph = [];
  for (let i = 8; i < n; i++) {
    if (env[i] > 0.7 && env[i - 7] < 0.42 && (!emph.length || i / 60 - emph[emph.length - 1] > 0.75)) emph.push(i / 60);
  }
  avatarStop();
  if (AV.audio) URL.revokeObjectURL(AV.audio.url);
  const dur = pcm.length / 48000, url = URL.createObjectURL(blob);
  AV.audio = { pcm, env, wide, emph, dur, url };
  AV.lines = text ? splitCaption({ text, start: 0.05, end: Math.max(0.2, dur - 0.05) }) : [];
  AV.el = new Audio(url);
  AV.el.addEventListener('ended', () => { avatarStop(); AV.t = 0; avatarRefresh(); });
  AV.t = 0;
}
let toSimpFn = null;
async function toSimp(text) {
  if (!toSimpFn) {
    try {
      await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/t2cn.js'; s.onload = res; s.onerror = rej; document.head.append(s); });
      toSimpFn = window.OpenCC.Converter({ from: 'tw', to: 'cn' });
    } catch (e) { toSimpFn = t => t; }
  }
  return toSimpFn(text);
}
// 把文字唸成語音，回傳 WAV。虛擬人和手動剪輯的「虛擬人聲」共用
async function synthSpeech(text, lang, gender) {
  const voice = voiceFor(lang, gender);
  if (!voice) throw new Error('novoice');
  aiStatus('正在準備語音…', 1);
  if (!AV.tts) AV.tts = await import(PIPER_URL);
  const lib = AV.tts;
  // 中文語音模型認簡體字，先轉換（畫面上的字幕仍用原本輸入的文字）
  const say = lang === 'zh' ? await toSimp(text) : text;
  lib.TtsSession._instance = null;   // 換聲音時要重新載入模型
  const session = await lib.TtsSession.create({
    voiceId: voice.id, wasmPaths: PIPER_PATHS,
    progress: p => { if (p && p.total) aiStatus('第一次使用這個聲音，正在下載語音模型…（之後不用再下載）', p.loaded / p.total); }
  });
  aiStatus('正在把文字變成語音…', 1);
  let wav = await session.predict(say);
  if (voice.shift !== 1) {
    aiStatus('正在調整成' + (gender === 'm' ? '男聲' : '女聲') + '…', 1);
    wav = pcmToWav(pitchShift(await decodeMono48k(wav), voice.shift), 48000);
  }
  return wav;
}
async function avatarSpeak() {
  const text = AV.text.trim();
  if (AV.busy) return;
  if (!voiceFor(AV.lang, AV.gender)) { toast('這個語言沒有語音模型，請改用麥克風錄音'); return; }
  if (!text) { toast('先輸入要讓人像說的話'); return; }
  AV.busy = true; avatarPanel();
  try {
    await setAvatarAudio(await synthSpeech(text, AV.lang, AV.gender), text);
    aiStatus(null);
    AV.busy = false;
    avatarPanel(); avatarRefresh();
    avatarPlay();
  } catch (e) {
    aiStatus(null);
    toast('語音無法產生：下載不到語音模型。請確認網路；在 Claude 頁面裡請改用獨立網址版本。也可以改用麥克風錄音或自己的錄音檔。', 7000);
  }
  AV.busy = false;
  avatarPanel();
}
// 用麥克風錄一段話當作人像的聲音（台語、客語，或想用自己的聲音時）
async function avatarRecord() {
  if (AV.rec) { AV.rec.stop(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { toast('這個瀏覽器不能錄音，請改用「選錄音檔」'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { toast('沒有取得麥克風的使用權限。請在瀏覽器網址列旁允許麥克風，或改用「選錄音檔」。在 Claude 頁面裡不能錄音。', 7000); return; }
  avatarStop();
  const chunks = [], rec = new MediaRecorder(stream);
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    AV.rec = null;
    try {
      await setAvatarAudio(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), AV.text.trim());
      avatarPanel(); avatarRefresh(); avatarPlay();
    } catch (e) { toast('錄音沒有成功，請再試一次'); avatarPanel(); }
  };
  AV.rec = rec;
  rec.start();
  avatarPanel();
  toast('錄音中…說完再按一次按鈕停止', 4000);
}

// ── 預覽播放 ──
function avatarPlay() {
  if (!AV.img || !AV.audio || AV.playing) return;
  AV.playing = true;
  AV.el.currentTime = AV.t >= AV.audio.dur - 0.05 ? 0 : AV.t;
  AV.el.play().catch(() => {});
  $('#avPlay').textContent = '暫停';
  const loop = () => {
    if (!AV.playing) return;
    AV.t = AV.el.currentTime;
    avatarDraw(AVC, AV.t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
function avatarStop() {
  AV.playing = false;
  if (AV.el) AV.el.pause();
  const b = $('#avPlay');
  if (b) b.textContent = '播放';
}

// ── 匯出：畫面和聲音都是算出來的，不用照實際速度播一遍，直接逐格編成 MP4 ──
async function avatarEncode() {
  if (!window.VideoEncoder || !window.AudioEncoder || !window.VideoFrame) throw new Error('unsupported');
  await loadMuxer();
  const canvas = mk(4, 4), fps = 30, dur = AV.audio.dur + 0.3;
  avatarDraw(canvas, 0);
  const w = canvas.width, hh = canvas.height;
  let vcfg = null;
  for (const lv of ['640028', '64002A', '640033']) {
    const cfg = { codec: 'avc1.' + lv, width: w, height: hh, bitrate: Math.round(w * hh * fps * 0.12), framerate: fps, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) { vcfg = cfg; break; } } catch (e) { /* 試下一個 */ }
  }
  const acfg = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 };
  if (!vcfg || !(await AudioEncoder.isConfigSupported(acfg)).supported) throw new Error('unsupported');
  const target = new Mp4Muxer.ArrayBufferTarget();
  const muxer = new Mp4Muxer.Muxer({ target, fastStart: 'in-memory', firstTimestampBehavior: 'offset', video: { codec: 'avc', width: w, height: hh, frameRate: fps }, audio: { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 } });
  let err = null;
  const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { err = e; } });
  ve.configure(vcfg);
  const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { err = e; } });
  ae.configure(acfg);
  try {
    const N = Math.ceil(dur * fps);
    for (let i = 0; i < N; i++) {
      if (AV.cancel) throw new Error('cancelled');
      if (err) throw err;
      avatarDraw(canvas, i / fps);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      ve.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      // 編碼器忙不過來就等一下，也讓畫面有機會更新進度
      while (ve.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 4));
      if (i % 8 === 0) { aiStatus('正在製作影片…', i / N); await new Promise(r => setTimeout(r, 0)); }
    }
    const pcm = AV.audio.pcm, CH = 4800;
    for (let off = 0; off < pcm.length; off += CH) {
      const n = Math.min(CH, pcm.length - off), data = new Float32Array(n * 2);
      data.set(pcm.subarray(off, off + n), 0); data.set(pcm.subarray(off, off + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(off / 48000 * 1e6), data });
      ae.encode(ad); ad.close();
    }
    await ve.flush(); await ae.flush();
    if (err) throw err;
    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    try { ve.close(); ae.close(); } catch (e) { /* 已關閉 */ }
  }
}
async function avatarExport(toVideo) {
  if (AV.busy) return;
  if (!AV.img || !AV.audio) { toast('先選照片並產生語音'); return; }
  AV.busy = true; AV.cancel = false;
  avatarStop(); avatarPanel();
  aiStatus('正在製作影片…', 0);
  try {
    const blob = await avatarEncode();
    aiStatus(null);
    if (toVideo) {
      const was = STT.auto;
      STT.auto = false;   // 這支影片的話是自己打的，不用再聽一次產生字幕
      setMode('video');
      await addMedia([new File([blob], '虛擬人.mp4', { type: 'video/mp4' })]);
      STT.auto = was;
      toast('已把虛擬人影片加進手動剪輯');
    } else saveFile('虛擬人.mp4', blob);
  } catch (e) {
    aiStatus(null);
    if (e.message !== 'cancelled') toast(e.message === 'unsupported' ? '這個瀏覽器不支援影片編碼，請改用電腦版 Chrome 或 Edge。' : '製作影片失敗：' + (e.message || '未知原因'), 6000);
  }
  AV.busy = false; AV.cancel = false;
  avatarRefresh(); avatarPanel();
}

// ── 介面 ──
function syncAvatarEmpty() {
  const empty = !AV.img;
  $('#avatarEmpty').hidden = !empty;
  AVC.parentElement.hidden = empty;
  $('#avatarPanel').hidden = $('#avatarFoot').hidden = empty;
  $('#avatar').classList.toggle('is-empty', empty);
}
function avatarPanel() {
  const root = $('#avatarPanel');
  root.replaceChildren();
  if (!AV.img) return;
  root.append(h('h2', { text: '虛擬人' }));
  root.append(h('button', { class: 'btn wide', text: '換一張人像照片', onclick: async () => { const [f] = await pickFiles($('#fileImg')); if (f) setAvatarPhoto(f); } }));

  let el = group(root, 'av.say', '1　要說的話', true);
  const ta = h('textarea', { id: 'avText', rows: 5, maxlength: 600, placeholder: '在這裡輸入要讓人像說的話，例如：大家好，歡迎來到我的頻道。' });
  ta.value = AV.text;
  ta.addEventListener('input', () => { AV.text = ta.value; });
  el.append(h('label', { class: 'field', for: 'avText' }, '文字內容（最多 600 字）', ta));
  el.append(h('h3', { text: '聲音' }));
  chips(el, [['f', '女聲'], ['m', '男聲']], AV.gender, v => { AV.gender = v; avatarPanel(); });
  el.append(h('h3', { text: '語言' }));
  chips(el, AV_LANGS.map(l => [l[0], l[1]]), AV.lang, v => { AV.lang = v; avatarPanel(); });
  const voice = voiceFor(AV.lang, AV.gender), langName = AV_LANGS.find(l => l[0] === AV.lang)[1];
  if (voice) {
    if (voice.shift !== 1) el.append(h('p', { text: langName + '只有' + (AV.gender === 'm' ? '女聲' : '男聲') + '的語音模型，' + (AV.gender === 'm' ? '男聲' : '女聲') + '是把音調' + (AV.gender === 'm' ? '調低' : '調高') + '模擬出來的，聽起來會比較不自然。' }));
    if (AV.lang === 'zh') el.append(h('p', { text: '中文是標準國語口音。' }));
    else if (AV.lang !== 'en') el.append(h('p', { text: '請直接輸入' + langName + '，程式不會幫你翻譯。' }));
    el.append(h('button', { class: 'btn primary wide', disabled: AV.busy, text: AV.audio ? '重新產生語音' : '產生語音並播放', onclick: avatarSpeak }));
  } else {
    el.append(h('p', { text: langName + '目前沒有能把文字直接唸出來的語音模型。請按下面的按鈕，用麥克風自己唸一段' + langName + '，人像會跟著你的聲音開口。上面輸入的文字會當成字幕。' }));
  }
  el.append(h('button', { class: 'btn wide' + (voice ? '' : ' primary'), disabled: AV.busy, 'aria-pressed': String(!!AV.rec), text: AV.rec ? '錄音中…按這裡停止' : '用麥克風錄音', onclick: avatarRecord }));
  el.append(h('button', {
    class: 'btn wide', disabled: AV.busy, text: '選錄音檔', onclick: async () => {
      const [f] = await pickFiles($('#fileAudio'));
      if (!f) return;
      try { await setAvatarAudio(f, AV.text.trim()); avatarPanel(); avatarRefresh(); avatarPlay(); } catch (e) { toast('這個聲音檔讀不了，請換 mp3、m4a 或 wav'); }
    }
  }));
  el.append(h('p', { text: '用錄音時，人像會跟著你的聲音開口；上面有輸入文字的話會當成字幕。' }));

  el = group(root, 'av.motion', '2　動作', false);
  const redraw = () => { if (!AV.playing) avatarRefresh(); };
  if (AV.rig) {
    el.append(h('h3', { text: '說話的樣子' }));
    chips(el, AV_STYLES.map(x => [x[0], x[1]]), AV.style, v => { AV.style = v; redraw(); });
    slider(el, { label: '頭部動作的幅度', min: 0, max: 200, step: 5, value: AV.head, def: 100, fmt: v => v + '%', onInput: v => { AV.head = v; redraw(); } });
  }
  slider(el, { label: '嘴巴張開的幅度', min: 20, max: 130, value: AV.amt, def: 70, fmt: v => v + '%', onInput: v => { AV.amt = v; redraw(); } });
  if (AV.rig) slider(el, { label: '微笑', min: 0, max: 100, value: AV.smile, def: 0, fmt: v => v + '%', onInput: v => { AV.smile = v; redraw(); } });
  el.append(h('div', { class: 'chips' },
    h('button', { class: 'btn', 'aria-pressed': String(AV.blink), text: '眨眼', onclick: () => { AV.blink = !AV.blink; avatarPanel(); } }),
    AV.rig ? h('button', { class: 'btn', 'aria-pressed': String(AV.brows), text: '挑眉', onclick: () => { AV.brows = !AV.brows; avatarPanel(); } })
      : h('button', { class: 'btn', 'aria-pressed': String(AV.sway), text: '頭部輕微擺動', onclick: () => { AV.sway = !AV.sway; avatarPanel(); avatarRefresh(); } }),
    h('button', { class: 'btn', 'aria-pressed': String(AV.caps), text: '顯示字幕', onclick: () => { AV.caps = !AV.caps; avatarPanel(); avatarRefresh(); } })));
  if (AV.rig) el.append(h('p', { text: '頭會緩慢地轉動、歪頭，說到語氣加重的地方會點一下頭、挑一下眉。肩膀和背景不會跟著動。' }));

  el = group(root, 'av.aspect', '3　畫面比例', false);
  chips(el, AV_ASPECTS, AV.aspect, v => { AV.aspect = v; avatarRefresh(); });

  root.append(h('button', { class: 'btn primary wide', disabled: AV.busy || !AV.audio, text: '匯出成影片（MP4）', onclick: () => avatarExport(false) }));
  root.append(h('button', { class: 'btn wide', disabled: AV.busy || !AV.audio, text: '送到「手動剪輯」繼續編輯', onclick: () => avatarExport(true) }));
  if (!AV.audio) root.append(h('p', { text: '先產生語音，才能預覽和匯出。' }));
  root.append(h('p', { text: '請只使用你自己的照片，或已經取得本人同意的照片。' }));
}
function initAvatar() {
  $('#avatarEmptyBtn').addEventListener('click', async () => { const [f] = await pickFiles($('#fileImg')); if (f) setAvatarPhoto(f); });
  $('#avPlay').addEventListener('click', () => {
    if (!AV.audio) { toast('先輸入文字並產生語音'); return; }
    if (AV.playing) avatarStop(); else avatarPlay();
  });
  syncAvatarEmpty();
}
