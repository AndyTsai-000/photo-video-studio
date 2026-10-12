// AI 影像功能：去背（找出主體）和清除物件（把塗掉的地方補起來）
// 模型在背景執行緒裡跑，照片不會上傳；第一次使用要下載模型，之後瀏覽器會留著
const AI = { worker: null, job: null };
const AI_MATTE_MODELS = [['Xenova/modnet', '人像、寵物（快，25MB）'], ['onnx-community/ISNet-ONNX', '物品、一般（精準，176MB）']];

const AI_WORKER_SRC = `
const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const LAMA_URL = 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx';
let TF = null, ORT = null, lama = null;
const pipes = {};
const post = (m, t) => self.postMessage(m, t || []);

// 下載大檔並回報進度；存進瀏覽器快取，下次不用重抓
async function fetchCached(url) {
  let cache = null;
  try { cache = await caches.open('ai-models'); const hit = await cache.match(url); if (hit) return await hit.arrayBuffer(); } catch (e) { cache = null; }
  const res = await fetch(url);
  if (!res.ok) throw new Error('http ' + res.status);
  const total = +res.headers.get('content-length') || 0, reader = res.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    post({ type: 'download', progress: total ? got / total : 0 });
  }
  const blob = new Blob(chunks);
  try { if (cache) await cache.put(url, new Response(blob)); } catch (e) { /* 快取滿了就算了 */ }
  return await blob.arrayBuffer();
}

self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'matte') {
      if (!TF) { TF = await import(TF_URL); TF.env.allowLocalModels = false; }
      if (!pipes[m.model]) {
        pipes[m.model] = await TF.pipeline('background-removal', m.model, {
          dtype: 'fp32',
          progress_callback: p => { if (p.status === 'progress' && p.file && p.file.endsWith('.onnx')) post({ type: 'download', progress: (p.progress || 0) / 100 }); }
        });
      }
      post({ type: 'stage', text: '正在找出主體…' });
      const out = await pipes[m.model](new TF.RawImage(new Uint8ClampedArray(m.data), m.w, m.h, 4));
      const im = out[0], n = im.width * im.height, alpha = new Uint8Array(n), ch = im.channels;
      for (let i = 0; i < n; i++) alpha[i] = im.data[i * ch + ch - 1];
      post({ type: 'done', alpha, w: im.width, h: im.height }, [alpha.buffer]);
    } else if (m.type === 'inpaint') {
      if (!ORT) { ORT = await import(ORT_URL + 'ort.min.mjs'); ORT.env.wasm.wasmPaths = ORT_URL; ORT.env.logLevel = 'error'; }
      if (!lama) lama = await ORT.InferenceSession.create(await fetchCached(LAMA_URL), { executionProviders: ['wasm'] });
      post({ type: 'stage', text: '正在補上背景…大約需要半分鐘' });
      const N = 512, px = new Uint8ClampedArray(m.data), hole = new Uint8Array(m.mask);
      const img = new Float32Array(3 * N * N), mask = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) {
        img[i] = px[i * 4] / 255; img[N * N + i] = px[i * 4 + 1] / 255; img[2 * N * N + i] = px[i * 4 + 2] / 255;
        mask[i] = hole[i] ? 1 : 0;
      }
      const feeds = {};
      feeds[lama.inputNames[0]] = new ORT.Tensor('float32', img, [1, 3, N, N]);
      feeds[lama.inputNames[1]] = new ORT.Tensor('float32', mask, [1, 1, N, N]);
      const r = (await lama.run(feeds))[lama.outputNames[0]].data, out = new Uint8ClampedArray(N * N * 4);
      for (let i = 0; i < N * N; i++) { out[i * 4] = r[i]; out[i * 4 + 1] = r[N * N + i]; out[i * 4 + 2] = r[2 * N * N + i]; out[i * 4 + 3] = 255; }
      post({ type: 'done', data: out.buffer }, [out.buffer]);
    }
  } catch (err) {
    post({ type: 'error', message: String((err && err.message) || err) });
  }
};
`;

function aiStatus(text, progress) {
  const bar = $('#aiBar');
  bar.hidden = text == null;
  if (text == null) return;
  $('#aiText').textContent = text;
  $('#aiProgress').style.width = Math.round(clamp(progress == null ? 1 : progress, 0, 1) * 100) + '%';
}
function aiCall(msg, transfer, label) {
  return new Promise((resolve, reject) => {
    if (AI.job) { reject(new Error('busy')); return; }
    if (!AI.worker) AI.worker = new Worker(URL.createObjectURL(new Blob([AI_WORKER_SRC], { type: 'text/javascript' })), { type: 'module' });
    const w = AI.worker, fail = err => { AI.job = null; aiStatus(null); reject(err); };
    AI.job = { reject };
    aiStatus(label, 1);
    w.onmessage = e => {
      const m = e.data;
      if (m.type === 'download') aiStatus('第一次使用，正在下載 AI 模型…（之後不用再下載）', m.progress);
      else if (m.type === 'stage') aiStatus(m.text, 1);
      else if (m.type === 'done') { AI.job = null; aiStatus(null); resolve(m); }
      else if (m.type === 'error') {
        // 出錯後這個執行緒的狀態不可靠，下次重開
        w.terminate(); AI.worker = null;
        fail(new Error(m.message));
      }
    };
    w.onerror = e => { e.preventDefault(); w.terminate(); AI.worker = null; fail(new Error('load')); };
    w.postMessage(msg, transfer);
  });
}
function aiCancel() {
  if (AV.busy) AV.cancel = true;   // 虛擬人製作影片時也是用這個進度條
  if (!AI.job) return;
  const job = AI.job;
  AI.worker.terminate(); AI.worker = null; AI.job = null;
  aiStatus(null);
  job.reject(new Error('cancelled'));
  toast('已取消');
}
function aiErrorToast(e) {
  if (e.message === 'cancelled') return;
  toast(e.message === 'busy' ? '上一個 AI 處理還在進行，請等它完成'
    : 'AI 功能無法啟動：下載不到模型或記憶體不足。請確認網路；在 Claude 頁面裡請改用獨立網址版本。', 6500);
}
$('#aiCancel').addEventListener('click', aiCancel);

// ── 去背 ──
// 模型一次只看得到長邊 1024 的縮圖，所以直接放大回原圖時邊緣會糊、細的地方會斷。精準度靠三件事補回來：
//   1. 第二次分析：先找出主體大概在哪，把那一塊裁下來再分析一次，主體在模型眼中就變大、變清楚
//   2. 邊緣貼合：拿原圖的明暗當參考，把放大後的邊緣修到真正的輪廓上（guided filter）
//   3. 兩次結果差太多時（代表第二次看錯東西）退回第一次的結果
// 跑一次模型：回傳縮圖尺寸的 alpha（0..1）和同尺寸的灰階圖
async function matteOnce(src, model, label) {
  const s = Math.min(1, 1024 / Math.max(src.width, src.height));
  const c = mk(src.width * s, src.height * s), x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  const id = x.getImageData(0, 0, c.width, c.height), d = id.data, w = c.width, hh = c.height, n = w * hh, gray = new Float32Array(n);
  for (let i = 0; i < n; i++) gray[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  const m = await aiCall({ type: 'matte', model, data: d.buffer, w, h: hh }, [d.buffer], label);
  const alpha = new Float32Array(n);
  if (m.w === w && m.h === hh) for (let i = 0; i < n; i++) alpha[i] = m.alpha[i] / 255;
  else for (let y = 0; y < hh; y++) for (let xx = 0; xx < w; xx++) alpha[y * w + xx] = m.alpha[Math.min(m.h - 1, Math.floor(y * m.h / hh)) * m.w + Math.min(m.w - 1, Math.floor(xx * m.w / w))] / 255;
  return { alpha, gray, w, h: hh };
}
// 方框平均（先橫再直，各用累加，速度跟半徑無關）
function boxMean(a, w, hh, r) {
  const t = new Float32Array(a.length), out = new Float32Array(a.length);
  for (let y = 0; y < hh; y++) {
    const row = y * w;
    let s = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) s += a[row + x];
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r), hi = Math.min(w - 1, x + r);
      t[row + x] = s / (hi - lo + 1);
      if (x + r + 1 < w) s += a[row + x + r + 1];
      if (x - r >= 0) s -= a[row + x - r];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y <= Math.min(r, hh - 1); y++) s += t[y * w + x];
    for (let y = 0; y < hh; y++) {
      const lo = Math.max(0, y - r), hi = Math.min(hh - 1, y + r);
      out[y * w + x] = s / (hi - lo + 1);
      if (y + r + 1 < hh) s += t[(y + r + 1) * w + x];
      if (y - r >= 0) s -= t[(y - r) * w + x];
    }
  }
  return out;
}
// 把縮圖尺寸的 alpha 放大成 region 畫布的大小，邊緣照 region 的明暗修到真正的輪廓上
function refineMatte(lo, region) {
  const { alpha: p, gray: I, w, h: hh } = lo, n = w * hh, r = Math.max(3, Math.round(Math.max(w, hh) / 150)), eps = 2e-4;
  const II = new Float32Array(n), Ip = new Float32Array(n);
  for (let i = 0; i < n; i++) { II[i] = I[i] * I[i]; Ip[i] = I[i] * p[i]; }
  const mI = boxMean(I, w, hh, r), mp = boxMean(p, w, hh, r), mII = boxMean(II, w, hh, r), mIp = boxMean(Ip, w, hh, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { a[i] = (mIp[i] - mI[i] * mp[i]) / (mII[i] - mI[i] * mI[i] + eps); b[i] = mp[i] - a[i] * mI[i]; }
  const ma = boxMean(a, w, hh, r), mb = boxMean(b, w, hh, r);
  const W = region.width, H = region.height, rd = region.getContext('2d').getImageData(0, 0, W, H).data;
  const out = new ImageData(W, H), o = out.data, kx = w / W, ky = hh / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(hh - 1.001, Math.max(0, (y + 0.5) * ky - 0.5)), y0 = Math.floor(fy), ty = fy - y0, r0 = y0 * w, r1 = r0 + w;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1.001, Math.max(0, (x + 0.5) * kx - 0.5)), x0 = Math.floor(fx), tx = fx - x0;
      const i00 = r0 + x0, i10 = i00 + 1, i01 = r1 + x0, i11 = i01 + 1, w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const pv = p[i00] * w00 + p[i10] * w10 + p[i01] * w01 + p[i11] * w11;
      const pb = mp[i00] * w00 + mp[i10] * w10 + mp[i01] * w01 + mp[i11] * w11;
      const oi = (y * W + x) * 4;
      let v = pv;
      // 只在邊緣附近（主體和背景交界的那一圈）用原圖修正，主體內部和背景深處維持模型的判斷
      const edge = Math.min(1, 6.4 * pb * (1 - pb));
      if (edge > 0.01) {
        const g = (0.299 * rd[oi] + 0.587 * rd[oi + 1] + 0.114 * rd[oi + 2]) / 255;
        const q = (ma[i00] * w00 + ma[i10] * w10 + ma[i01] * w01 + ma[i11] * w11) * g + (mb[i00] * w00 + mb[i10] * w10 + mb[i01] * w01 + mb[i11] * w11);
        v = pv + (q - pv) * edge;
      }
      o[oi] = o[oi + 1] = o[oi + 2] = 255;
      o[oi + 3] = Math.min(1, Math.max(0, (v - 0.04) / 0.92)) * 255;
    }
  }
  const cv = mk(W, H);
  cv.getContext('2d').putImageData(out, 0, 0);
  return cv;
}
// 找出主體，回傳跟原圖一樣大的遮罩畫布（主體不透明、背景透明）。opts.refine === false 時用最簡單的做法（測試比較用）
async function aiMatte(src, model, opts) {
  const W = src.width, H = src.height, first = await matteOnce(src, model, '正在準備去背…');
  const full = mk(W, H), fx = full.getContext('2d');
  fx.imageSmoothingQuality = 'high';
  if (opts && opts.refine === false) {
    const small = mk(first.w, first.h), md = new ImageData(first.w, first.h);
    for (let i = 0; i < first.alpha.length; i++) { md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = 255; md.data[i * 4 + 3] = first.alpha[i] * 255; }
    small.getContext('2d').putImageData(md, 0, 0);
    fx.drawImage(small, 0, 0, W, H);
    return full;
  }
  // 主體的範圍（縮圖座標）
  let x0 = first.w, y0 = first.h, x1 = -1, y1 = -1;
  for (let y = 0; y < first.h; y++) for (let x = 0; x < first.w; x++) {
    if (first.alpha[y * first.w + x] > 0.5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  let lo = first, box = { x: 0, y: 0, w: W, h: H };
  if (x1 >= 0) {
    const k = W / first.w, pad = Math.max(x1 - x0, y1 - y0) * 0.09 + 4;
    const bx = Math.max(0, Math.floor((x0 - pad) * k)), by = Math.max(0, Math.floor((y0 - pad) * k));
    const bw = Math.min(W, Math.ceil((x1 + 1 + pad) * k)) - bx, bh = Math.min(H, Math.ceil((y1 + 1 + pad) * k)) - by;
    // 主體只佔畫面一部分時才值得再看一次
    if (bw > 32 && bh > 32 && bw * bh < 0.62 * W * H) {
      const crop = mk(bw, bh);
      crop.getContext('2d').drawImage(src, bx, by, bw, bh, 0, 0, bw, bh);
      const second = await matteOnce(crop, model, '正在精修邊緣…（放大主體再分析一次）');
      // 兩次的結果重疊夠多才採用第二次；差太多代表第二次看錯了東西
      let inter = 0, uni = 0;
      for (let y = 0; y < second.h; y += 2) for (let x = 0; x < second.w; x += 2) {
        const a2 = second.alpha[y * second.w + x] > 0.5;
        const fxp = Math.min(first.w - 1, Math.floor((bx + (x + 0.5) * bw / second.w) / k)), fyp = Math.min(first.h - 1, Math.floor((by + (y + 0.5) * bh / second.h) / k));
        const a1 = first.alpha[fyp * first.w + fxp] > 0.5;
        if (a1 && a2) inter++;
        if (a1 || a2) uni++;
      }
      if (uni && inter / uni > 0.6) { lo = second; box = { x: bx, y: by, w: bw, h: bh }; }
    }
  }
  // 邊緣貼合在最多長邊 3000 的畫布上做，夠細又不會太慢
  const cap = Math.min(1, 3000 / Math.max(box.w, box.h)), region = mk(box.w * cap, box.h * cap), rx = region.getContext('2d');
  rx.imageSmoothingQuality = 'high';
  rx.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, region.width, region.height);
  fx.drawImage(refineMatte(lo, region), box.x, box.y, box.w, box.h);
  return full;
}

// 把 mark 畫布上塗過的地方從 base 清掉並補上背景，回傳新的畫布；沒有塗抹時回傳 null。
// 標記分成好幾塊、彼此離得遠時（例如左上和右下各一個浮水印）一塊一塊處理：
// 模型每次只處理 512×512，範圍越小補出來越清楚
async function aiInpaint(base, mark) {
  const W = base.width, H = base.height, S = 128, probe = mk(S, S), px = probe.getContext('2d');
  px.drawImage(mark, 0, 0, S, S);
  const pd = px.getImageData(0, 0, S, S).data, on = new Uint8Array(S * S), label = new Int32Array(S * S);
  // 先把標記往外擴兩格，靠得很近的幾塊就會連成一塊
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (pd[(y * S + x) * 4 + 3] <= 10) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < S && yy < S) on[yy * S + xx] = 1; }
  }
  const boxes = [];
  for (let i = 0; i < S * S; i++) {
    if (!on[i] || label[i]) continue;
    const id = boxes.length + 1, b = { x0: S, y0: S, x1: 0, y1: 0 }, stack = [i];
    label[i] = id;
    while (stack.length) {
      const c = stack.pop(), cx = c % S, cy = (c - cx) / S;
      b.x0 = Math.min(b.x0, cx); b.x1 = Math.max(b.x1, cx); b.y0 = Math.min(b.y0, cy); b.y1 = Math.max(b.y1, cy);
      for (const n of [c - 1, c + 1, c - S, c + S]) {
        if (n < 0 || n >= S * S || label[n] || !on[n]) continue;
        if ((n === c - 1 && cx === 0) || (n === c + 1 && cx === S - 1)) continue;
        label[n] = id; stack.push(n);
      }
    }
    boxes.push(b);
  }
  if (!boxes.length) return null;
  if (boxes.length === 1 || boxes.length > 4) return inpaintOne(base, mark, '');
  let cur = base;
  for (let k = 0; k < boxes.length; k++) {
    const b = boxes[k], x = Math.floor(b.x0 / S * W), y = Math.floor(b.y0 / S * H), w = Math.ceil((b.x1 + 1) / S * W) - x, hh = Math.ceil((b.y1 + 1) / S * H) - y;
    const part = mk(W, H);
    part.getContext('2d').drawImage(mark, x, y, w, hh, x, y, w, hh);
    const out = await inpaintOne(cur, part, '（第 ' + (k + 1) + ' / ' + boxes.length + ' 處）');
    if (out) cur = out;
  }
  return cur === base ? null : cur;
}
async function inpaintOne(base, mark, note) {
  const W = base.width, H = base.height, S = 256, N = 512;
  const probe = mk(S, S), px = probe.getContext('2d');
  px.drawImage(mark, 0, 0, S, S);
  const pd = px.getImageData(0, 0, S, S).data;
  let x0 = S, y0 = S, x1 = -1, y1 = -1;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (pd[(y * S + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  // 取塗抹範圍周圍一塊（留足夠的背景讓模型參考），縮到模型要的 512×512
  const bx0 = x0 / S * W, by0 = y0 / S * H, bx1 = (x1 + 1) / S * W, by1 = (y1 + 1) / S * H;
  const side = Math.max(bx1 - bx0, by1 - by0) * 2.4 + 80;
  // 標記貼著照片邊緣時，取樣範圍往照片外面多伸一些（最多伸出自己大小的 35%），
  // 伸出去的部分用邊緣那一排像素延伸填滿。這樣模型在標記的每一邊都有背景可以參考，
  // 否則貼邊的地方會補出一塊暗影
  const cw = Math.round(Math.min(W * 1.5, side)), ch = Math.round(Math.min(H * 1.5, side));
  const cx = Math.round(clamp((bx0 + bx1) / 2 - cw / 2, -cw * 0.35, W - cw * 0.65)), cy = Math.round(clamp((by0 + by1) / 2 - ch / 2, -ch * 0.35, H - ch * 0.65));
  const pad = mk(cw, ch), pdx = pad.getContext('2d');
  pdx.drawImage(base, -cx, -cy);
  const lx = Math.max(0, -cx), rx = Math.min(cw, W - cx), ty = Math.max(0, -cy), by = Math.min(ch, H - cy);
  if (lx > 0) pdx.drawImage(pad, lx, ty, 1, by - ty, 0, ty, lx, by - ty);
  if (rx < cw) pdx.drawImage(pad, rx - 1, ty, 1, by - ty, rx, ty, cw - rx, by - ty);
  if (ty > 0) pdx.drawImage(pad, 0, ty, cw, 1, 0, 0, cw, ty);
  if (by < ch) pdx.drawImage(pad, 0, by - 1, cw, 1, 0, by, cw, ch - by);
  const img = mk(N, N), ix = img.getContext('2d');
  ix.imageSmoothingQuality = 'high';
  ix.drawImage(pad, 0, 0, cw, ch, 0, 0, N, N);
  const markPad = mk(cw, ch);
  markPad.getContext('2d').drawImage(mark, -cx, -cy);
  const mc = mk(N, N), mx = mc.getContext('2d');
  mx.drawImage(markPad, 0, 0, cw, ch, 0, 0, N, N);
  const mdata = mx.getImageData(0, 0, N, N).data, raw = new Uint8Array(N * N), tmp = new Uint8Array(N * N), hole = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) raw[i] = mdata[i * 4 + 3] > 25 ? 1 : 0;
  // 把遮罩往外擴一圈，邊緣殘影才清得乾淨
  const R = 7;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (let k = Math.max(0, x - R); k <= Math.min(N - 1, x + R) && !v; k++) v = raw[y * N + k];
    tmp[y * N + x] = v;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (let k = Math.max(0, y - R); k <= Math.min(N - 1, y + R) && !v; k++) v = tmp[k * N + x];
    hole[y * N + x] = v;
  }
  const id = ix.getImageData(0, 0, N, N);
  const res = await aiCall({ type: 'inpaint', data: id.data.buffer, mask: hole.buffer.slice(0) }, [id.data.buffer], '正在準備清除…' + note);
  const filled = mk(N, N);
  filled.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(res.data), N, N), 0, 0);
  // 只把補好的部分（遮罩範圍，邊緣柔化）貼回原圖
  const holeCv = mk(N, N), hd = new ImageData(N, N);
  for (let i = 0; i < N * N; i++) { hd.data[i * 4] = hd.data[i * 4 + 1] = hd.data[i * 4 + 2] = 255; hd.data[i * 4 + 3] = hole[i] ? 255 : 0; }
  holeCv.getContext('2d').putImageData(hd, 0, 0);
  const soft = blurCanvas(holeCv, 2.5), sx = soft.getContext('2d');
  sx.drawImage(holeCv, 0, 0);
  const patch = mk(cw, ch), pc = patch.getContext('2d');
  pc.imageSmoothingQuality = 'high';
  pc.drawImage(filled, 0, 0, cw, ch);
  pc.globalCompositeOperation = 'destination-in';
  pc.drawImage(soft, 0, 0, cw, ch);
  const out = cloneCanvas(base);
  out.getContext('2d').drawImage(patch, cx, cy);
  return out;
}
