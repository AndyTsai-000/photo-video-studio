// 剪輯模式：片段依序排在一條時間軸上，另有文字軌和一條配樂
const VC = $('#vc');
const vctx = VC.getContext('2d');
const V = {
  clips: [], texts: [], music: null,
  t: 0, playing: false, active: null, lastTs: 0,
  sel: null, selText: null, aspect: '16:9', res: 720, pps: 50,
  isSample: true, exporting: false, rec: null, cancelled: false, audio: null
};
const V_ASPECTS = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5] };
const V_FILTERS = [
  ['none', '原片', '', null],
  ['fresh', '清新', 'brightness(1.08) saturate(1.15) contrast(.96)', null],
  ['warm', '暖陽', 'saturate(1.15)', 'rgba(255,150,40,.22)'],
  ['cool', '冷調', 'contrast(1.06) saturate(.9)', 'rgba(60,130,255,.22)'],
  ['bw', '黑白', 'grayscale(1) contrast(1.1)', null],
  ['vintage', '復古', 'sepia(.6) contrast(.95) brightness(1.03)', null],
  ['vivid', '鮮豔', 'saturate(1.5) contrast(1.1)', null],
  ['film', '膠片', 'contrast(1.1) saturate(.85) sepia(.15)', null]
];
let vid = 0;
const clipDur = c => (c.out - c.in) / c.speed;
const totalDur = () => V.clips.reduce((s, c) => s + clipDur(c), 0);
const fmtTime = t => Math.floor(t / 60) + ':' + (t % 60).toFixed(1).padStart(4, '0');

function locate(t) {
  let s = 0;
  for (let i = 0; i < V.clips.length; i++) {
    const c = V.clips[i], d = clipDur(c);
    if (t < s + d) return { clip: c, idx: i, start: s, local: t - s };
    s += d;
  }
  return { clip: null, idx: -1, start: s, local: 0 };
}
function clipStart(c) {
  let s = 0;
  for (const k of V.clips) { if (k === c) return s; s += clipDur(k); }
  return s;
}
function setVideoSize() {
  const [a, b] = V_ASPECTS[V.aspect], r = V.res;
  if (a >= b) { VC.height = r; VC.width = Math.round(r * a / b / 2) * 2; }
  else { VC.width = r; VC.height = Math.round(r * b / a / 2) * 2; }
  fit(VC);
  drawFrame();
}

// ── 畫出目前時間點的畫面 ──
function clipFilter(c) {
  const preset = V_FILTERS.find(f => f[0] === c.filter) || V_FILTERS[0];
  let s = preset[2];
  if (c.b) s += ' brightness(' + (1 + c.b / 100 * 0.6) + ')';
  if (c.c) s += ' contrast(' + (1 + c.c / 100 * 0.6) + ')';
  if (c.s) s += ' saturate(' + (1 + c.s / 100) + ')';
  return { css: s.trim() || 'none', overlay: preset[3] };
}
function drawFrame() {
  const W = VC.width, H = VC.height, total = totalDur();
  const L = locate(Math.min(V.t, Math.max(0, total - 0.001)));
  const c = L.clip;
  if (c && c.kind === 'video' && c.el.readyState < 2) return; // 還沒有畫面可畫，先留著上一格
  vctx.fillStyle = '#000000';
  vctx.fillRect(0, 0, W, H);
  if (c) {
    const sw = c.kind === 'video' ? c.el.videoWidth : c.el.width, sh = c.kind === 'video' ? c.el.videoHeight : c.el.height;
    if (sw && sh) {
      const sc = c.fit === 'contain' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
      const dw = sw * sc, dh = sh * sc, f = clipFilter(c), d = clipDur(c);
      let alpha = 1;
      if (c.fade) alpha = clamp(Math.min(L.local, d - L.local) / Math.min(0.5, d / 2), 0, 1);
      vctx.save();
      vctx.globalAlpha = alpha;
      if (HAS_FILTER) vctx.filter = f.css;
      vctx.drawImage(c.el, (W - dw) / 2, (H - dh) / 2, dw, dh);
      vctx.filter = 'none';
      if (f.overlay) {
        vctx.globalCompositeOperation = 'soft-light';
        vctx.fillStyle = f.overlay;
        vctx.fillRect((W - dw) / 2, (H - dh) / 2, dw, dh);
      }
      vctx.restore();
    }
  }
  for (const tx of V.texts) {
    if (V.t < tx.start || V.t > tx.start + tx.dur) continue;
    const a = clamp(Math.min(V.t - tx.start, tx.start + tx.dur - V.t) / 0.25, 0, 1);
    const lines = tx.text.split('\n');
    let size = H * tx.size / 100;
    vctx.save();
    vctx.font = '700 ' + size + 'px ' + FONTS.hei[1];
    const widest = Math.max(...lines.map(l => vctx.measureText(l).width));
    if (widest > W * 0.92) { size *= W * 0.92 / widest; vctx.font = '700 ' + size + 'px ' + FONTS.hei[1]; }
    vctx.globalAlpha = a; vctx.textAlign = 'center'; vctx.textBaseline = 'middle';
    vctx.lineJoin = 'round'; vctx.lineWidth = size * 0.16; vctx.strokeStyle = 'rgba(0,0,0,.85)'; vctx.fillStyle = tx.color;
    const cy = H * (tx.pos === 'top' ? 0.14 : tx.pos === 'middle' ? 0.5 : 0.86);
    lines.forEach((l, i) => {
      const y = cy + (i - (lines.length - 1) / 2) * size * 1.25;
      vctx.strokeText(l, W / 2, y); vctx.fillText(l, W / 2, y);
    });
    vctx.restore();
  }
}

// ── 聲音：每個影片和配樂各有一個音量節點，匯出時一起錄進去 ──
function ensureAudio() {
  if (!V.audio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const ac = new AC(), master = ac.createGain(), dest = ac.createMediaStreamDestination();
      master.connect(ac.destination); master.connect(dest);
      V.audio = { ac, master, dest, nodes: new WeakMap() };
    } catch (e) { return; }
  }
  if (V.audio.ac.state === 'suspended') V.audio.ac.resume().catch(() => {});
}
function setGain(el, vol) {
  if (!V.audio) { el.volume = clamp(vol, 0, 1); return; }
  let n = V.audio.nodes.get(el);
  if (!n) {
    try {
      const src = V.audio.ac.createMediaElementSource(el), gain = V.audio.ac.createGain();
      src.connect(gain); gain.connect(V.audio.master);
      n = { gain };
      V.audio.nodes.set(el, n);
    } catch (e) { el.volume = clamp(vol, 0, 1); return; }
  }
  n.gain.gain.value = vol;
}

// ── 播放 ──
function activate(c, local) {
  if (V.active && V.active.kind === 'video' && V.active.el !== c.el) V.active.el.pause();
  V.active = c;
  if (c.kind !== 'video') return;
  const v = c.el, want = c.in + local * c.speed;
  if (Math.abs(v.currentTime - want) > 0.08) v.currentTime = want;
  v.playbackRate = c.speed;
  setGain(v, c.vol);
  v.play().catch(() => {});
}
function syncMusic() {
  const m = V.music;
  if (!m) return;
  setGain(m.el, m.vol);
  if (V.playing && V.t < m.dur) {
    if (Math.abs(m.el.currentTime - V.t) > 0.15) m.el.currentTime = V.t;
    m.el.play().catch(() => {});
  } else m.el.pause();
}
function play() {
  const total = totalDur();
  if (total <= 0) { toast('先加入影片或圖片'); return; }
  if (V.t >= total - 0.03) V.t = 0;
  ensureAudio();
  V.playing = true; V.active = null; V.lastTs = performance.now();
  $('#playBtn').textContent = '暫停';
  syncMusic();
  requestAnimationFrame(tick);
}
function pause() {
  V.playing = false;
  if (V.active && V.active.kind === 'video') V.active.el.pause();
  V.active = null;
  if (V.music) V.music.el.pause();
  $('#playBtn').textContent = '播放';
}
function tick(now) {
  if (!V.playing) return;
  const dt = Math.min(0.1, (now - V.lastTs) / 1000);
  V.lastTs = now;
  const total = totalDur(), L = locate(V.t), c = L.clip;
  if (!c) { finishPlayback(total); return; }
  if (V.active !== c) activate(c, L.local);
  if (c.kind === 'video') {
    const v = c.el;
    if (!v.seeking && v.readyState >= 2) {
      if (v.currentTime >= c.out - 0.02 || v.ended) V.t = L.start + clipDur(c) + 0.0005;
      else V.t = Math.max(V.t, L.start + Math.max(0, (v.currentTime - c.in) / c.speed));
    }
  } else V.t += dt;
  if (V.music && V.t >= V.music.dur) V.music.el.pause();
  if (V.t >= total) { finishPlayback(total); return; }
  drawFrame(); updatePlayhead();
  requestAnimationFrame(tick);
}
function finishPlayback(total) {
  V.t = total;
  pause();
  drawFrame(); updatePlayhead();
  if (V.exporting && V.rec && V.rec.state !== 'inactive') V.rec.stop();
}
function seek(t) {
  V.t = clamp(t, 0, totalDur());
  if (V.playing) { V.active = null; syncMusic(); }
  else {
    const L = locate(Math.min(V.t, Math.max(0, totalDur() - 0.001)));
    if (L.clip && L.clip.kind === 'video') {
      const want = L.clip.in + L.local * L.clip.speed;
      if (Math.abs(L.clip.el.currentTime - want) > 0.02) L.clip.el.currentTime = want;
    }
  }
  drawFrame(); updatePlayhead();
}

// ── 匯入素材 ──
function waitSeek(v, t) {
  return new Promise(res => {
    const done = () => { v.removeEventListener('seeked', done); res(); };
    v.addEventListener('seeked', done);
    setTimeout(done, 2500);
    v.currentTime = t;
  });
}
function thumbOf(src, sw, sh) {
  const c = mk(96, 54), s = Math.max(96 / sw, 54 / sh);
  c.getContext('2d').drawImage(src, (96 - sw * s) / 2, (54 - sh * s) / 2, sw * s, sh * s);
  try { return c.toDataURL('image/jpeg', 0.6); } catch (e) { return ''; }
}
function newClip(kind, el, name, dur, thumb) {
  return { id: ++vid, kind, el, name, srcDur: dur, in: 0, out: dur, speed: 1, vol: 1, filter: 'none', b: 0, c: 0, s: 0, fit: 'cover', fade: false, thumb };
}
async function addVideoFile(f) {
  const v = document.createElement('video');
  v.preload = 'auto'; v.playsInline = true;
  v.src = URL.createObjectURL(f);
  await new Promise((res, rej) => {
    v.onloadedmetadata = res;
    v.onerror = () => rej(new Error('這個瀏覽器無法播放「' + f.name + '」的影片格式'));
  });
  if (!isFinite(v.duration)) {
    // 有些錄製檔一開始不知道長度，跳到很後面讓瀏覽器算出來
    await waitSeek(v, 1e7);
  }
  const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 10;
  await waitSeek(v, Math.min(0.2, dur / 2));
  const thumb = thumbOf(v, v.videoWidth || 16, v.videoHeight || 9);
  v.addEventListener('seeked', () => { if (!V.playing) drawFrame(); });
  v.addEventListener('loadeddata', () => { if (!V.playing) drawFrame(); });
  V.clips.push(newClip('video', v, f.name, dur, thumb));
}
function setMusicFile(f) {
  if (V.music) V.music.el.pause();
  const a = new Audio();
  a.preload = 'auto';
  a.src = URL.createObjectURL(f);
  V.music = { el: a, name: f.name, vol: 0.6, dur: 0 };
  const m = V.music;
  a.addEventListener('loadedmetadata', () => { m.dur = isFinite(a.duration) ? a.duration : 600; rebuildTL(); });
  a.addEventListener('error', () => { if (V.music === m) { V.music = null; rebuildTL(); vPanel(); } toast('這個瀏覽器無法播放「' + f.name + '」'); });
}
async function addMedia(files) {
  if (!files.length) return;
  pause();
  for (const f of files) {
    const isMedia = f.type.startsWith('video/') || f.type.startsWith('image/');
    if (isMedia && V.isSample) { V.clips = []; V.texts = []; V.isSample = false; V.t = 0; V.sel = V.selText = null; }
    try {
      if (f.type.startsWith('video/')) await addVideoFile(f);
      else if (f.type.startsWith('image/')) {
        const cv = await fileToCanvas(f, 1920);
        V.clips.push(newClip('image', cv, f.name, 3, thumbOf(cv, cv.width, cv.height)));
      } else if (f.type.startsWith('audio/')) setMusicFile(f);
      else toast('不支援的檔案：' + f.name);
    } catch (e) { toast(e.message || '無法讀取 ' + f.name, 4000); }
  }
  rebuildTL(); vPanel(); seek(V.t);
}

// ── 時間軸 ──
function rebuildTL() {
  const total = totalDur(), pps = V.pps;
  $('#tlInner').style.width = Math.max(total * pps + 120, 0) + 'px';
  const ruler = $('#tlRuler');
  ruler.replaceChildren();
  const step = pps >= 70 ? 1 : pps >= 30 ? 2 : pps >= 15 ? 5 : 10;
  for (let s = 0; s <= total + step; s += step) ruler.append(h('span', { style: 'left:' + s * pps + 'px', text: fmtTime(s).replace('.0', '') }));
  const tc = $('#tlClips');
  tc.replaceChildren();
  for (const c of V.clips) {
    tc.append(h('div', {
      class: 'clip', 'data-clip': c.id, 'aria-selected': String(V.sel === c.id),
      style: 'width:' + clipDur(c) * pps + 'px;' + (c.thumb ? 'background-image:url(' + c.thumb + ')' : ''),
      title: c.name
    }, h('span', { text: clipDur(c).toFixed(1) + ' 秒　' + c.name })));
  }
  const tt = $('#tlTexts');
  tt.replaceChildren();
  for (const tx of V.texts) {
    tt.append(h('div', {
      class: 'tbar', 'data-text': tx.id, 'aria-selected': String(V.selText === tx.id),
      style: 'left:' + tx.start * pps + 'px;width:' + Math.max(12, tx.dur * pps) + 'px', text: tx.text.split('\n')[0]
    }));
  }
  const tm = $('#tlMusic');
  tm.replaceChildren();
  if (V.music) tm.append(h('div', { class: 'mbar', style: 'width:' + Math.max(40, Math.min(V.music.dur || total, total) * pps) + 'px', text: '配樂　' + V.music.name }));
  updatePlayhead();
}
function updatePlayhead() {
  $('#playhead').style.transform = 'translateX(' + (V.t * V.pps - 1) + 'px)';
  $('#timeLabel').textContent = fmtTime(V.t) + ' / ' + fmtTime(totalDur());
  if (V.exporting) $('#exportBar').style.width = (totalDur() ? V.t / totalDur() * 100 : 0) + '%';
  if (V.playing) {
    const sc = $('#tlScroll'), x = V.t * V.pps;
    if (x > sc.scrollLeft + sc.clientWidth - 60 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 80);
  }
}
(function wireTimeline() {
  const inner = $('#tlInner');
  let scrubbing = false;
  const at = e => (e.clientX - inner.getBoundingClientRect().left) / V.pps;
  inner.addEventListener('pointerdown', e => {
    const clipEl = e.target.closest('[data-clip]'), textEl = e.target.closest('[data-text]');
    const sel = clipEl ? +clipEl.dataset.clip : null, selText = textEl ? +textEl.dataset.text : null;
    if ((clipEl || textEl) && (V.sel !== sel || V.selText !== selText)) {
      V.sel = sel; V.selText = selText;
      rebuildTL(); vPanel();
    }
    scrubbing = true;
    inner.setPointerCapture(e.pointerId);
    seek(at(e));
  });
  inner.addEventListener('pointermove', e => { if (scrubbing) seek(at(e)); });
  ['pointerup', 'pointercancel'].forEach(ev => inner.addEventListener(ev, () => { scrubbing = false; }));
  $('#zoomRange').addEventListener('input', e => { V.pps = +e.target.value; rebuildTL(); });
  $('#playBtn').addEventListener('click', () => (V.playing ? pause() : play()));

  const selClip = () => V.clips.find(c => c.id === V.sel);
  const after = () => { rebuildTL(); vPanel(); seek(V.t); };
  $('#splitBtn').addEventListener('click', () => {
    pause();
    const L = locate(V.t), c = L.clip;
    if (!c || L.local < 0.1 || clipDur(c) - L.local < 0.1) { toast('把播放頭移到片段中間再分割'); return; }
    const a = { ...c, id: ++vid }, b = { ...c, id: ++vid };
    if (c.kind === 'video') { a.out = b.in = c.in + L.local * c.speed; }
    else { a.out = L.local; b.out = c.out - L.local; }
    V.clips.splice(L.idx, 1, a, b);
    V.sel = b.id; V.selText = null;
    after();
  });
  $('#dupBtn').addEventListener('click', () => {
    const c = selClip();
    if (!c) { toast('先在時間軸上點選一個片段'); return; }
    pause();
    const d = { ...c, id: ++vid };
    V.clips.splice(V.clips.indexOf(c) + 1, 0, d);
    V.sel = d.id;
    after();
  });
  const moveSel = dir => {
    const c = selClip();
    if (!c) { toast('先在時間軸上點選一個片段'); return; }
    const i = V.clips.indexOf(c), j = i + dir;
    if (j < 0 || j >= V.clips.length) return;
    pause();
    [V.clips[i], V.clips[j]] = [V.clips[j], V.clips[i]];
    V.t = clipStart(c);
    after();
  };
  $('#leftBtn').addEventListener('click', () => moveSel(-1));
  $('#rightBtn').addEventListener('click', () => moveSel(1));
  $('#delBtn').addEventListener('click', deleteVideoSelection);
})();
function deleteVideoSelection() {
  if (V.selText) { V.texts = V.texts.filter(t => t.id !== V.selText); V.selText = null; }
  else if (V.sel) { pause(); V.clips = V.clips.filter(c => c.id !== V.sel); V.sel = null; }
  else { toast('先在時間軸上點選片段或文字'); return; }
  rebuildTL(); vPanel(); seek(V.t);
}

// ── 右側設定面板 ──
function vPanel() {
  const el = $('#videoPanel');
  el.replaceChildren();
  const clip = V.clips.find(c => c.id === V.sel), text = V.texts.find(t => t.id === V.selText);
  const refresh = () => { rebuildTL(); drawFrame(); };

  if (clip) {
    el.append(h('h2', { text: '片段設定' }), h('p', { text: clip.name }));
    if (clip.kind === 'video') {
      const fmt = v => v.toFixed(1) + ' 秒';
      slider(el, { label: '起點', min: 0, max: clip.srcDur, step: 0.05, value: clip.in, fmt, onStart: pause, onInput: v => { clip.in = Math.min(v, clip.out - 0.1); rebuildTL(); seek(clipStart(clip)); } });
      slider(el, { label: '終點', min: 0, max: clip.srcDur, step: 0.05, value: clip.out, fmt, onStart: pause, onInput: v => { clip.out = Math.max(v, clip.in + 0.1); rebuildTL(); seek(clipStart(clip) + clipDur(clip) - 0.03); } });
      slider(el, { label: '速度', min: 0.25, max: 3, step: 0.25, value: clip.speed, def: 1, fmt: v => v + ' 倍', onStart: pause, onInput: v => { clip.speed = v; rebuildTL(); seek(V.t); } });
      slider(el, { label: '原聲音量', min: 0, max: 200, step: 5, value: Math.round(clip.vol * 100), def: 100, fmt: v => v + '%', onInput: v => { clip.vol = v / 100; if (V.active === clip) setGain(clip.el, clip.vol); } });
    } else {
      slider(el, { label: '顯示長度', min: 0.5, max: 15, step: 0.5, value: clip.out, def: 3, fmt: v => v + ' 秒', onStart: pause, onInput: v => { clip.out = v; rebuildTL(); seek(Math.min(V.t, totalDur())); } });
    }
    el.append(h('h3', { text: '濾鏡' }));
    chips(el, V_FILTERS.map(f => [f[0], f[1]]), clip.filter, v => { clip.filter = v; drawFrame(); });
    for (const [k, label] of [['b', '亮度'], ['c', '對比'], ['s', '飽和度']]) {
      slider(el, { label, min: -100, max: 100, value: clip[k], def: 0, onInput: v => { clip[k] = v; drawFrame(); } });
    }
    el.append(h('h3', { text: '畫面' }));
    chips(el, [['cover', '填滿畫面'], ['contain', '完整顯示']], clip.fit, v => { clip.fit = v; drawFrame(); });
    el.append(h('button', { class: 'btn wide', 'aria-pressed': String(clip.fade), text: '開頭結尾淡入淡出', onclick: () => { clip.fade = !clip.fade; vPanel(); drawFrame(); } }));
    el.append(h('button', { class: 'btn ghost wide', text: '回到專案設定', onclick: () => { V.sel = null; rebuildTL(); vPanel(); } }));
    return;
  }
  if (text) {
    el.append(h('h2', { text: '文字設定' }));
    const ta = h('textarea', { id: 'vTextEdit', rows: 2 });
    ta.value = text.text;
    ta.addEventListener('input', () => { text.text = ta.value; refresh(); });
    el.append(h('label', { class: 'field', for: 'vTextEdit' }, '內容', ta));
    el.append(h('h3', { text: '位置' }));
    chips(el, [['top', '上方'], ['middle', '中間'], ['bottom', '下方']], text.pos, v => { text.pos = v; drawFrame(); });
    el.append(h('h3', { text: '顏色' }));
    swatches(el, ['#ffffff', '#ffd24a', '#ff5d8f', '#62d2c6', '#1a1a1a'], text.color, c => { text.color = c; drawFrame(); });
    slider(el, { label: '大小', min: 3, max: 20, step: 0.5, value: text.size, def: 7, onInput: v => { text.size = v; drawFrame(); } });
    const fmt = v => v.toFixed(1) + ' 秒';
    slider(el, { label: '出現時間', min: 0, max: Math.max(1, totalDur()), step: 0.1, value: text.start, fmt, onInput: v => { text.start = v; rebuildTL(); seek(v + 0.3); } });
    slider(el, { label: '顯示長度', min: 0.5, max: 20, step: 0.1, value: text.dur, def: 3, fmt, onInput: v => { text.dur = v; refresh(); } });
    el.append(h('button', { class: 'btn danger wide', text: '刪除這段文字', onclick: deleteVideoSelection }));
    el.append(h('button', { class: 'btn ghost wide', text: '回到專案設定', onclick: () => { V.selText = null; rebuildTL(); vPanel(); } }));
    return;
  }

  el.append(h('h2', { text: '剪輯專案' }));
  if (V.isSample) el.append(h('p', {}, h('span', { class: 'tag', text: '範例片段' }), '加入你的素材後，範例會自動換掉。'));
  el.append(h('button', { class: 'btn primary wide', text: '加入影片或圖片', onclick: async () => addMedia(await pickFiles($('#fileMedia'))) }));
  el.append(h('button', {
    class: 'btn wide', text: '在播放頭加一段文字', onclick: () => {
      if (!V.clips.length) { toast('先加入影片或圖片'); return; }
      const tx = { id: ++vid, text: '輸入文字', start: Math.min(V.t, Math.max(0, totalDur() - 1)), dur: 3, pos: 'bottom', size: 7, color: '#ffffff' };
      V.texts.push(tx); V.selText = tx.id; V.sel = null;
      rebuildTL(); vPanel(); drawFrame();
    }
  }));
  el.append(h('button', { class: 'btn wide', text: V.music ? '換一首配樂' : '加入配樂', onclick: async () => { const [f] = await pickFiles($('#fileAudio')); if (f) { pause(); setMusicFile(f); rebuildTL(); vPanel(); } } }));
  if (V.music) {
    const m = V.music;
    slider(el, { label: '配樂音量', min: 0, max: 100, step: 5, value: Math.round(m.vol * 100), def: 60, fmt: v => v + '%', onInput: v => { m.vol = v / 100; setGain(m.el, m.vol); } });
    el.append(h('button', { class: 'btn danger wide', text: '移除配樂', onclick: () => { m.el.pause(); V.music = null; rebuildTL(); vPanel(); } }));
  }
  el.append(h('h3', { text: '畫面比例' }));
  chips(el, [['16:9', '橫式 16:9'], ['9:16', '直式 9:16'], ['1:1', '方形 1:1'], ['4:5', '4:5']], V.aspect, v => { V.aspect = v; setVideoSize(); });
  el.append(h('hr'), h('p', { text: '點時間軸上的片段可以修剪、變速、套濾鏡。按空白鍵播放或暫停。' }));
}

// ── 匯出：把畫布和聲音即時錄成影片檔 ──
function exportVideo() {
  if (V.exporting) return;
  if (totalDur() <= 0) { toast('先加入影片或圖片'); return; }
  if (!window.MediaRecorder || !VC.captureStream) { toast('這個瀏覽器不支援影片匯出，請改用 Chrome 或 Edge', 4000); return; }
  pause();
  V.res = +$('#exportOpt').value || 720;
  setVideoSize();
  ensureAudio();
  const stream = VC.captureStream(30);
  if (V.audio) V.audio.dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m));
  let rec;
  try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: V.res >= 1080 ? 10e6 : 6e6 }); }
  catch (e) { toast('無法開始錄製：' + e.message, 4000); return; }
  const chunks = [], ext = mime && mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    stream.getVideoTracks().forEach(t => t.stop());
    $('#exportOverlay').hidden = true;
    V.exporting = false; V.rec = null;
    if (V.cancelled) { toast('已取消匯出'); return; }
    saveFile('剪輯作品.' + ext, new Blob(chunks, { type: 'video/' + ext }));
  };
  V.exporting = true; V.cancelled = false; V.rec = rec;
  $('#exportBar').style.width = '0%';
  $('#exportOverlay').hidden = false;
  seek(0);
  // 等第一格畫面就緒再開始錄
  setTimeout(() => {
    if (!V.exporting) return;
    rec.start(1000);
    play();
  }, 500);
}
$('#cancelExport').addEventListener('click', () => {
  V.cancelled = true;
  pause();
  if (V.rec && V.rec.state !== 'inactive') V.rec.stop();
  else { V.exporting = false; V.rec = null; $('#exportOverlay').hidden = true; }
});

function initVideo() {
  for (let i = 0; i < 3; i++) {
    const cv = makeSample(i + 1, 1280, 720);
    const c = newClip('image', cv, '範例片段 ' + (i + 1), 3, thumbOf(cv, cv.width, cv.height));
    c.fade = i > 0;
    V.clips.push(c);
  }
  V.texts.push({ id: ++vid, text: '我的旅行日記', start: 0.3, dur: 2.5, pos: 'bottom', size: 8, color: '#ffffff' });
  setVideoSize();
  rebuildTL(); vPanel();
}
