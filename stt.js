// 自動字幕：在瀏覽器裡用 Whisper 語音模型把影片的聲音轉成文字，聲音不會上傳
const STT = {
  auto: true, lang: 'chinese', model: 'Xenova/whisper-base',
  queue: [], job: null, worker: null, broken: false
};
const STT_LANGS = [['chinese', '中文'], ['english', '英文'], ['japanese', '日文'], ['korean', '韓文'], ['', '自動偵測']];
const STT_MODELS = [['Xenova/whisper-base', '快速（約 77MB）'], ['Xenova/whisper-small', '精準（約 250MB）']];
try {
  const saved = JSON.parse(localStorage.getItem('stt') || '{}');
  if (typeof saved.auto === 'boolean') STT.auto = saved.auto;
  if (STT_LANGS.some(l => l[0] === saved.lang)) STT.lang = saved.lang;
  if (STT_MODELS.some(m => m[0] === saved.model)) STT.model = saved.model;
} catch (e) { /* 沒有儲存空間就用預設值 */ }
function saveSttPrefs() {
  try { localStorage.setItem('stt', JSON.stringify({ auto: STT.auto, lang: STT.lang, model: STT.model })); } catch (e) { /* 略過 */ }
}

const STT_WORKER_SRC = `
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
env.allowLocalModels = false;
let pipe = null, pipeModel = '';
self.onmessage = async e => {
  const { audio, model, language } = e.data;
  try {
    if (!pipe || pipeModel !== model) {
      pipe = await pipeline('automatic-speech-recognition', model, {
        dtype: 'q8',
        progress_callback: p => {
          if (p.status === 'progress' && p.file && p.file.endsWith('.onnx')) self.postMessage({ type: 'download', progress: p.progress || 0 });
        }
      });
      pipeModel = model;
    }
    const SR = 16000, WIN = 28 * SR, out = [];
    for (let off = 0; off < audio.length; off += WIN) {
      self.postMessage({ type: 'progress', progress: off / audio.length });
      const part = audio.subarray(off, Math.min(audio.length, off + WIN));
      if (part.length < SR * 0.4) break;
      let sum = 0;
      for (let i = 0; i < part.length; i += 8) sum += part[i] * part[i];
      if (Math.sqrt(sum / (part.length / 8)) < 0.003) continue; // 這一段幾乎沒聲音，模型容易亂編字，直接跳過
      const opts = { return_timestamps: true };
      if (language) { opts.language = language; opts.task = 'transcribe'; }
      const r = await pipe(part, opts);
      for (const c of r.chunks || []) {
        const s = c.timestamp[0] == null ? 0 : c.timestamp[0];
        const en = c.timestamp[1] == null ? part.length / SR : c.timestamp[1];
        out.push({ start: off / SR + s, end: off / SR + Math.max(en, s + 0.3), text: c.text });
      }
    }
    self.postMessage({ type: 'done', chunks: out });
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
`;

function sttStatus(text, progress) {
  const bar = $('#sttBar');
  bar.hidden = text == null;
  if (text == null) return;
  $('#sttText').textContent = text;
  $('#sttProgress').style.width = Math.round(clamp(progress || 0, 0, 1) * 100) + '%';
}

// 把影片檔的聲音解成 16kHz 單聲道；沒有聲音軌時回傳 null
async function decodeAudio16k(file) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) throw new Error('這個瀏覽器不支援聲音解碼');
  const buf = await file.arrayBuffer();
  let ab;
  try { ab = await new OAC(1, 1, 16000).decodeAudioData(buf); } catch (e) { return null; }
  const n = ab.length, mono = new Float32Array(n);
  for (let ch = 0; ch < ab.numberOfChannels; ch++) {
    const d = ab.getChannelData(ch);
    for (let i = 0; i < n; i++) mono[i] += d[i] / ab.numberOfChannels;
  }
  if (ab.sampleRate === 16000) return mono;
  const ratio = ab.sampleRate / 16000, out = new Float32Array(Math.floor(n / ratio));
  for (let i = 0; i < out.length; i++) out[i] = mono[Math.floor(i * ratio)];
  return out;
}

function runSttWorker(audio, job) {
  return new Promise((resolve, reject) => {
    if (!STT.worker) {
      const url = URL.createObjectURL(new Blob([STT_WORKER_SRC], { type: 'text/javascript' }));
      STT.worker = new Worker(url, { type: 'module' });
    }
    const w = STT.worker, name = job.clip.name;
    job.abort = () => reject(new Error('cancelled'));
    w.onmessage = e => {
      const m = e.data;
      if (m.type === 'download') sttStatus('第一次使用，正在下載語音模型…（之後不用再下載）', m.progress / 100);
      else if (m.type === 'progress') sttStatus('正在聽「' + name + '」並產生字幕…', m.progress);
      else if (m.type === 'done') resolve(m.chunks);
      else if (m.type === 'error') reject(new Error(m.message));
    };
    w.onerror = e => { e.preventDefault(); reject(new Error('load')); };
    w.postMessage({ audio, model: STT.model, language: STT.lang }, [audio.buffer]);
  });
}

// 模型輸出的中文常是簡體，轉成繁體
let toTradFn = null;
async function toTrad(text) {
  if (!toTradFn) {
    try {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/cn2t.js';
        s.onload = res; s.onerror = rej;
        document.head.append(s);
      });
      toTradFn = window.OpenCC.Converter({ from: 'cn', to: 'tw' });
    } catch (e) { toTradFn = t => t; }
  }
  return toTradFn(text);
}

// 中文字幕裡的半形標點換成全形
function fullWidthPunct(t) {
  return t.replace(/,/g, '，').replace(/\?/g, '？').replace(/!/g, '！').replace(/:/g, '：').replace(/;/g, '；');
}
// 一句太長就切成幾行字幕，時間照字數比例分配
function splitCaption(ch) {
  const text = ch.text.trim();
  if (!text || /^[\[(（【♪].*[\])）】♪]$/.test(text)) return [];
  const cjk = /[぀-ヿ㐀-鿿가-힯]/.test(text), max = cjk ? 16 : 42;
  const pieces = [];
  for (const seg of text.split(/(?<=[，。！？；、,.!?;])\s*/).filter(Boolean)) {
    const last = pieces[pieces.length - 1];
    if (last != null && (last + seg).length <= max) pieces[pieces.length - 1] = last + (cjk ? '' : ' ') + seg;
    else pieces.push(seg);
  }
  const lines = [];
  for (const p of pieces) {
    if (p.length <= max) { lines.push(p); continue; }
    if (cjk) for (let i = 0; i < p.length; i += max) lines.push(p.slice(i, i + max));
    else {
      let cur = '';
      for (const w of p.split(/\s+/)) {
        if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
      }
      if (cur) lines.push(cur);
    }
  }
  const totalLen = lines.reduce((s, l) => s + l.length, 0) || 1, span = ch.end - ch.start;
  let t = ch.start;
  return lines.map(l => {
    const d = span * l.length / totalLen, item = { start: t, end: t + d, text: cjk ? fullWidthPunct(l.replace(/[，。；、,.;]+$/, '')) : l };
    t += d;
    return item;
  }).filter(i => i.text);
}

async function applyCaptions(clip, chunks) {
  const group = V.clips.filter(c => c.el === clip.el);
  if (!group.length) return 0;
  const ids = new Set(group.map(c => c.id));
  V.texts = V.texts.filter(t => !(t.auto && ids.has(t.clip)));
  let n = 0;
  for (const ch of chunks) {
    for (const line of splitCaption(ch)) {
      // 片段被分割過的話，字幕分給包含那個時間點的那一段
      const owner = group.find(c => line.start >= c.in && line.start < c.out) || group[0];
      const text = STT.lang === 'chinese' || STT.lang === '' ? await toTrad(line.text) : line.text;
      V.texts.push({ id: ++vid, clip: owner.id, at: line.start, dur: line.end - line.start, text, auto: true });
      n++;
    }
  }
  return n;
}

function queueCaptions(clip) {
  if (!clip.file) { toast('範例片段沒有聲音可以辨識'); return; }
  if (STT.queue.includes(clip) || (STT.job && STT.job.clip.el === clip.el)) return;
  STT.queue.push(clip);
  sttNext();
}
async function sttNext() {
  if (STT.job || !STT.queue.length) return;
  const clip = STT.queue.shift();
  if (!V.clips.some(c => c.el === clip.el)) { sttNext(); return; }
  const job = STT.job = { clip, abort: null, cancelled: false };
  sttStatus('正在讀取「' + clip.name + '」的聲音…', 0);
  vPanel();
  try {
    const audio = await decodeAudio16k(clip.file);
    if (job.cancelled) return;
    if (!audio) { toast('「' + clip.name + '」沒有聲音，不產生字幕', 3500); return; }
    const chunks = await runSttWorker(audio, job);
    if (job.cancelled) return;
    const n = await applyCaptions(clip, chunks);
    toast(n ? '已產生 ' + n + ' 句字幕，點時間軸上的字幕可以修改' : '「' + clip.name + '」沒有聽到說話聲', 3500);
  } catch (e) {
    if (!job.cancelled) {
      // 模型載不下來（例如離線，或頁面所在的環境擋掉外部連線）：這次先關掉，避免每支影片都再失敗一次
      if (STT.worker) { STT.worker.terminate(); STT.worker = null; }
      STT.broken = true; STT.queue = [];
      toast('自動字幕無法啟動：下載不到語音模型。請確認網路，或改用獨立網址版本。', 6000);
    }
  } finally {
    if (STT.job === job) STT.job = null;
    sttStatus(null);
    rebuildTL(); vPanel(); drawFrame();
    vCommit();
    sttNext();
  }
}
function cancelStt() {
  const job = STT.job;
  STT.queue = [];
  if (!job) return;
  job.cancelled = true;
  if (STT.worker) { STT.worker.terminate(); STT.worker = null; }
  if (job.abort) job.abort();
  sttStatus(null);
  toast('已取消自動字幕');
}
$('#sttCancel').addEventListener('click', cancelStt);
