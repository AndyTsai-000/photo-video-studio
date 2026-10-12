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

// 找出主體，回傳跟原圖一樣大的遮罩畫布（主體不透明、背景透明）
async function aiMatte(src, model) {
  const s = Math.min(1, 1024 / Math.max(src.width, src.height));
  const c = mk(src.width * s, src.height * s), x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  const id = x.getImageData(0, 0, c.width, c.height);
  const m = await aiCall({ type: 'matte', model, data: id.data.buffer, w: c.width, h: c.height }, [id.data.buffer], '正在準備去背…');
  const small = mk(m.w, m.h), md = new ImageData(m.w, m.h);
  for (let i = 0; i < m.alpha.length; i++) { md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = 255; md.data[i * 4 + 3] = m.alpha[i]; }
  small.getContext('2d').putImageData(md, 0, 0);
  const full = mk(src.width, src.height), fx = full.getContext('2d');
  fx.imageSmoothingQuality = 'high';
  fx.drawImage(small, 0, 0, full.width, full.height);
  return full;
}

// 把 mark 畫布上塗過的地方從 base 清掉並補上背景，回傳新的畫布；沒有塗抹時回傳 null
async function aiInpaint(base, mark) {
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
  const cw = Math.round(Math.min(W, side)), ch = Math.round(Math.min(H, side));
  const cx = Math.round(clamp((bx0 + bx1) / 2 - cw / 2, 0, W - cw)), cy = Math.round(clamp((by0 + by1) / 2 - ch / 2, 0, H - ch));
  const img = mk(N, N), ix = img.getContext('2d');
  ix.imageSmoothingQuality = 'high';
  ix.drawImage(base, cx, cy, cw, ch, 0, 0, N, N);
  const mc = mk(N, N), mx = mc.getContext('2d');
  mx.drawImage(mark, cx, cy, cw, ch, 0, 0, N, N);
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
  const res = await aiCall({ type: 'inpaint', data: id.data.buffer, mask: hole.buffer.slice(0) }, [id.data.buffer], '正在準備清除…');
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
