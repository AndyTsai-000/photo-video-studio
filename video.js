// 剪輯模式：片段依序排在一條時間軸上，另有文字軌和一條配樂
const VC = $('#vc');
const vctx = VC.getContext('2d');
const V = {
  clips: [], texts: [], music: null,
  t: 0, playing: false, active: null, lastTs: 0,
  sel: null, selText: null, aspect: '16:9', res: 720, pps: 50,
  exporting: false, rec: null, cancelled: false, audio: null
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
// 文字都掛在某個片段上；at、dur 用片段的原始時間記錄，修剪、變速、換順序後仍會對得上
function textLocal(tx, c) {
  if (tx.auto && !c.capOn) return null;
  const k = c.kind === 'video' ? c.speed : 1, rel = (tx.at - (c.kind === 'video' ? c.in : 0)) / k;
  const s = Math.max(0, rel), e = Math.min(clipDur(c), rel + tx.dur / k);
  return e - s < 0.02 ? null : { s, e };
}
function addClipText(c) {
  const L = locate(V.t), local = L.clip === c ? Math.min(L.local, Math.max(0, clipDur(c) - 0.5)) : 0;
  const k = c.kind === 'video' ? c.speed : 1;
  const tx = { id: ++vid, clip: c.id, at: (c.kind === 'video' ? c.in : 0) + local * k, dur: Math.max(1, clipDur(c) - local) * k, text: '輸入文字', pos: 'bottom', size: 7, color: '#ffffff' };
  V.texts.push(tx); V.selText = tx.id; V.sel = null;
  rebuildTL(); vPanel(); seek(clipStart(c) + local + 0.3);
  selectAllIn('#vTextEdit');
}
function videoDims(res) {
  const [a, b] = V_ASPECTS[V.aspect];
  return a >= b ? [Math.round(res * a / b / 2) * 2, res] : [res, Math.round(res * b / a / 2) * 2];
}
function setVideoSize() {
  const [w, hh] = videoDims(V.res);
  VC.width = w; VC.height = hh;
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
const V_TRANS = [['none', '無'], ['fade', '淡化'], ['slide', '滑入'], ['push', '推移'], ['zoom', '放大'], ['wipe', '擦除']];
const V_TEXT_ANIM = [['fade', '淡入'], ['up', '上滑'], ['pop', '彈出'], ['type', '打字'], ['none', '無']];
const TRANS_DUR = 0.6;
const easeOut = p => 1 - Math.pow(1 - p, 3);
// 把一個片段在某個時間點的畫面畫到 ctx：含濾鏡、旋轉、緩慢推近、暗角
function drawClip(ctx, c, local, W, H) {
  const sw = c.kind === 'video' ? c.el.videoWidth : c.el.width, sh = c.kind === 'video' ? c.el.videoHeight : c.el.height;
  if (!sw || !sh) return;
  const turned = c.rot % 180 !== 0, rw = turned ? sh : sw, rh = turned ? sw : sh;
  const cover = Math.max(W / rw, H / rh), contain = Math.min(W / rw, H / rh);
  const f = clipFilter(c), d = clipDur(c), prog = d > 0 ? clamp(local / d, 0, 1) : 0;
  const kb = c.kb === 'in' ? 1 + 0.18 * prog : c.kb === 'out' ? 1.18 - 0.18 * prog : 1;
  const put = (sc, css, overlay) => {
    const dw = sw * sc, dh = sh * sc;
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.rotate(c.rot * Math.PI / 180); ctx.scale(c.flip ? -1 : 1, 1);
    if (HAS_FILTER) ctx.filter = css;
    ctx.drawImage(c.el, -dw / 2, -dh / 2, dw, dh);
    ctx.filter = 'none';
    if (overlay) {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = overlay;
      ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
    }
    ctx.restore();
  };
  ctx.save();
  if (c.fade) ctx.globalAlpha = clamp(Math.min(local, d - local) / Math.min(0.5, d / 2), 0, 1);
  // 模糊背景：先鋪一層放大、模糊的同一個畫面，再把完整畫面疊上去
  if (c.fit === 'blur') put(cover * 1.1, (f.css === 'none' ? '' : f.css + ' ') + 'blur(' + Math.round(H / 30) + 'px) brightness(.65)', null);
  put((c.fit === 'cover' ? cover : contain) * c.zoom * kb, f.css, f.overlay);
  if (c.vig) {
    const diag = Math.hypot(W, H) / 2, g = ctx.createRadialGradient(W / 2, H / 2, diag * 0.45, W / 2, H / 2, diag);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + (c.vig / 100 * 0.85) + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}
function drawFrame() {
  const W = VC.width, H = VC.height, total = totalDur();
  const L = locate(Math.min(V.t, Math.max(0, total - 0.001)));
  const c = L.clip;
  if (c && c.kind === 'video' && c.el.readyState < 2) return; // 還沒有畫面可畫，先留著上一格
  vctx.fillStyle = '#000000';
  vctx.fillRect(0, 0, W, H);
  if (c) {
    // 轉場：播放到新片段時，用上一段的最後一格和新片段做過場
    const T = Math.min(TRANS_DUR, clipDur(c) / 2);
    const tr = c.trans && c.trans !== 'none' && V.prevFrame && V.prevFor === c.id && L.local < T ? c.trans : null;
    if (!tr) drawClip(vctx, c, L.local, W, H);
    else {
      if (!V.layer || V.layer.width !== W || V.layer.height !== H) V.layer = mk(W, H);
      const lx = V.layer.getContext('2d'), p = easeOut(L.local / T), prev = V.prevFrame;
      lx.fillStyle = '#000000'; lx.fillRect(0, 0, W, H);
      drawClip(lx, c, L.local, W, H);
      vctx.save();
      vctx.drawImage(prev, tr === 'push' ? -W * p : 0, 0, W, H);
      if (tr === 'fade') { vctx.globalAlpha = p; vctx.drawImage(V.layer, 0, 0); }
      else if (tr === 'slide' || tr === 'push') vctx.drawImage(V.layer, W * (1 - p), 0);
      else if (tr === 'zoom') { const k = 0.6 + 0.4 * p; vctx.globalAlpha = p; vctx.drawImage(V.layer, (W - W * k) / 2, (H - H * k) / 2, W * k, H * k); }
      else if (tr === 'wipe') { const ww = Math.max(1, W * p); vctx.drawImage(V.layer, 0, 0, ww, H, 0, 0, ww, H); }
      vctx.restore();
    }
  }
  if (V.clean) return;   // 擷取畫面時不要文字和浮水印
  for (const tx of V.texts) {
    if (!c || tx.clip !== c.id) continue;
    const sp = textLocal(tx, c);
    if (!sp || L.local < sp.s || L.local > sp.e) continue;
    const st = tx.auto ? c.cap : tx, anim = tx.auto ? 'none' : (st.anim || 'fade');
    const tin = clamp((L.local - sp.s) / 0.35, 0, 1), tout = clamp((sp.e - L.local) / 0.25, 0, 1), e = easeOut(tin);
    const a = anim === 'none' ? 1 : Math.min(anim === 'type' ? 1 : tin, tout);
    const lines = tx.text.split('\n');
    let size = H * st.size / 100, shown = lines;
    if (anim === 'type') {
      const n = Math.ceil(tx.text.length * clamp((L.local - sp.s) / Math.max(0.3, (sp.e - sp.s) * 0.6), 0, 1));
      shown = tx.text.slice(0, n).split('\n');
    }
    vctx.save();
    const fam = FONTS[st.font || 'hei'][1];
    vctx.font = '700 ' + size + 'px ' + fam;
    const widest = Math.max(...lines.map(l => vctx.measureText(l).width));
    if (widest > W * 0.92) { size *= W * 0.92 / widest; vctx.font = '700 ' + size + 'px ' + fam; }
    vctx.globalAlpha = a; vctx.textAlign = 'center'; vctx.textBaseline = 'middle';
    vctx.lineJoin = 'round'; vctx.lineWidth = size * 0.16; vctx.strokeStyle = 'rgba(0,0,0,.85)'; vctx.fillStyle = st.color;
    const cy = H * (st.pos === 'top' ? 0.14 : st.pos === 'middle' ? 0.5 : 0.86) + (anim === 'up' ? (1 - e) * size * 0.9 : 0);
    if (anim === 'pop') { const k = 0.6 + 0.4 * e; vctx.translate(W / 2, cy); vctx.scale(k, k); vctx.translate(-W / 2, -cy); }
    shown.forEach((l, i) => {
      const y = cy + (i - (lines.length - 1) / 2) * size * 1.25;
      if (st.bg) {
        const tw = vctx.measureText(l).width + size * 0.7;
        vctx.fillStyle = 'rgba(0,0,0,.62)';
        roundRectPath(vctx, W / 2 - tw / 2, y - size * 0.66, tw, size * 1.3, size * 0.2); vctx.fill();
        vctx.fillStyle = st.color;
      } else vctx.strokeText(l, W / 2, y);
      vctx.fillText(l, W / 2, y);
    });
    vctx.restore();
  }
  if (V.mark) {
    const m = V.mark, w = W * m.size / 100, hh = w * m.cv.height / m.cv.width, pad = W * 0.03;
    vctx.save();
    vctx.globalAlpha = m.alpha;
    vctx.imageSmoothingQuality = 'high';
    vctx.drawImage(m.cv, m.pos[1] === 'r' ? W - w - pad : pad, m.pos[0] === 'b' ? H - hh - pad : pad, w, hh);
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
  if (V.playing && V.t + m.offset < m.dur) {
    const want = V.t + m.offset;
    if (Math.abs(m.el.currentTime - want) > 0.15) m.el.currentTime = want;
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
  if (V.music) {
    const m = V.music;
    if (V.t + m.offset >= m.dur) m.el.pause();
    else if (m.fadeOut) setGain(m.el, m.vol * clamp((total - V.t) / 2, 0, 1));
  }
  if (V.t >= total) { finishPlayback(total); return; }
  // 這一格要跨到下一段、而且下一段有設轉場：畫布上還是這一段的最後一格，先留下來做過場
  const nx = V.clips[L.idx + 1];
  if (nx && nx.trans && nx.trans !== 'none' && V.t >= L.start + clipDur(c)) { V.prevFrame = cloneCanvas(VC); V.prevFor = nx.id; }
  drawFrame(); updatePlayhead();
  encodeFrame(false);
  requestAnimationFrame(tick);
}
function finishPlayback(total) {
  V.t = total;
  pause();
  drawFrame(); updatePlayhead();
  if (V.exporting && V.rec && V.rec.state !== 'inactive') V.rec.stop();
  else if (V.exporting && V.enc) finishEncode();
}
function seek(t) {
  V.t = clamp(t, 0, totalDur());
  V.prevFor = null;
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
  return { id: ++vid, kind, el, name, srcDur: dur, in: 0, out: dur, speed: 1, vol: 1, filter: 'none', b: 0, c: 0, s: 0, fit: 'cover', rot: 0, flip: false, zoom: 1, fade: false, trans: 'none', kb: 'none', vig: 0, thumb, file: null, capOn: true, cap: { pos: 'bottom', size: 6, color: '#ffffff' } };
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
  const clip = newClip('video', v, f.name, dur, thumb);
  clip.file = f;
  V.clips.push(clip);
  if (STT.auto && !STT.broken) queueCaptions(clip);
}
function setMusicFile(f, meta) {
  if (V.music) V.music.el.pause();
  const a = new Audio();
  a.preload = 'auto';
  a.src = URL.createObjectURL(f);
  V.music = { el: a, name: (meta && meta.title) || f.name, vol: 0.6, dur: 0, offset: 0, fadeOut: false, credit: (meta && meta.credit) || '' };
  const m = V.music;
  a.addEventListener('loadedmetadata', () => { m.dur = isFinite(a.duration) ? a.duration : 600; rebuildTL(); vPanel(); });
  a.addEventListener('error', () => { if (V.music === m) { V.music = null; rebuildTL(); vPanel(); } toast('這個瀏覽器無法播放「' + f.name + '」'); });
}
async function addMedia(files) {
  if (!files.length) return;
  pause();
  for (const f of files) {
    try {
      if (f.type.startsWith('video/')) await addVideoFile(f);
      else if (f.type.startsWith('image/')) {
        const cv = await fileToCanvas(f, 3840);
        V.clips.push(newClip('image', cv, f.name, 3, thumbOf(cv, cv.width, cv.height)));
      } else if (f.type.startsWith('audio/')) setMusicFile(f);
      else toast('不支援的檔案：' + f.name);
    } catch (e) { toast(e.message || '無法讀取 ' + f.name, 4000); }
  }
  rebuildTL(); vPanel(); seek(V.t);
  vCommit();
}

// ── 時間軸 ──
function rebuildTL() {
  const total = totalDur(), pps = V.pps, empty = !V.clips.length;
  $('#videoEmpty').hidden = !empty;
  VC.parentElement.hidden = empty;
  // 還沒有素材時跟修圖、拼圖一樣：右邊工具列和時間軸都先收起來
  $('#videoPanel').hidden = $('#video .timeline').hidden = empty;
  $('#video').classList.toggle('is-empty', empty);
  if (!empty) fit(VC);
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
  let cs = 0;
  for (const c of V.clips) {
    for (const tx of V.texts) {
      if (tx.clip !== c.id) continue;
      const sp = textLocal(tx, c);
      if (!sp) continue;
      tt.append(h('div', {
        class: 'tbar' + (tx.auto ? ' auto' : ''), 'data-text': tx.id, 'aria-selected': String(V.selText === tx.id), title: tx.text,
        style: 'left:' + (cs + sp.s) * pps + 'px;width:' + Math.max(10, (sp.e - sp.s) * pps - 1) + 'px', text: tx.text.split('\n')[0]
      }));
    }
    cs += clipDur(c);
  }
  const tm = $('#tlMusic');
  tm.replaceChildren();
  if (V.music) tm.append(h('div', { class: 'mbar', style: 'width:' + Math.max(40, Math.min(V.music.dur ? V.music.dur - V.music.offset : total, total) * pps) + 'px', text: '配樂　' + V.music.name }));
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
// 在播放頭把片段切成兩段；切成功回傳 true。quiet 時切不了也不跳提示
function splitAtPlayhead(quiet) {
  pause();
  const L = locate(V.t), c = L.clip;
  if (!c || L.local < 0.1 || clipDur(c) - L.local < 0.1) { if (!quiet) toast('把播放頭移到片段中間再分割'); return false; }
  const a = { ...c, id: ++vid }, b = { ...c, id: ++vid };
  a.cap = { ...c.cap }; b.cap = { ...c.cap };
  b.trans = 'none';   // 同一段切開的後半不需要轉場
  const cutAt = c.kind === 'video' ? c.in + L.local * c.speed : L.local;
  if (c.kind === 'video') { a.out = b.in = cutAt; }
  else { a.out = L.local; b.out = c.out - L.local; }
  // 文字依切點分給前後兩段
  for (const tx of V.texts) {
    if (tx.clip !== c.id) continue;
    if (tx.at < cutAt) tx.clip = a.id;
    else { tx.clip = b.id; if (c.kind !== 'video') tx.at -= cutAt; }
  }
  V.clips.splice(L.idx, 1, a, b);
  V.sel = b.id; V.selText = null;
  rebuildTL(); vPanel(); seek(V.t);
  return true;
}
// 定格：把播放頭這一格變成一張 2 秒的靜止畫面插進去
function addFreezeFrame() {
  if (!V.clips.length) { toast('先加入影片或圖片'); return; }
  pause();
  V.clean = true; V.res = 1080; setVideoSize();
  const shot = cloneCanvas(VC);
  V.clean = false; V.res = 720; setVideoSize();
  const L0 = locate(Math.min(V.t, Math.max(0, totalDur() - 0.001)));
  let idx;
  if (splitAtPlayhead(true)) idx = V.clips.findIndex(c => c.id === V.sel);
  else idx = L0.idx + (L0.local > clipDur(L0.clip) / 2 ? 1 : 0);
  const fr = newClip('image', shot, '定格畫面', 2, thumbOf(shot, shot.width, shot.height));
  V.clips.splice(idx, 0, fr);
  V.sel = fr.id; V.selText = null;
  rebuildTL(); vPanel(); seek(clipStart(fr) + 0.05);
  vCommit();
  toast('已插入 2 秒定格畫面，長度可以在右邊調整');
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
  $('#splitBtn').addEventListener('click', () => splitAtPlayhead(false));
  $('#dupBtn').addEventListener('click', () => {
    const c = selClip();
    if (!c) { toast('先在時間軸上點選一個片段'); return; }
    pause();
    const d = { ...c, id: ++vid, cap: { ...c.cap } };
    V.clips.splice(V.clips.indexOf(c) + 1, 0, d);
    V.texts.push(...V.texts.filter(t => t.clip === c.id).map(t => ({ ...t, id: ++vid, clip: d.id })));
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
  else if (V.sel) { pause(); V.clips = V.clips.filter(c => c.id !== V.sel); V.texts = V.texts.filter(t => t.clip !== V.sel); V.sel = null; }
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
    el.append(h('h3', { text: '這個片段的文字' }));
    el.append(h('button', { class: 'btn primary wide', text: '加一段文字', onclick: () => addClipText(clip) }));
    const mine = V.texts.filter(t => t.clip === clip.id && !t.auto);
    if (mine.length) {
      el.append(h('div', { class: 'chips' }, mine.map(t => h('button', {
        class: 'btn', text: t.text.split('\n')[0].slice(0, 12) || '（空白）', title: '修改這段文字',
        onclick: () => { V.selText = t.id; V.sel = null; rebuildTL(); vPanel(); }
      }))));
    }
    if (clip.kind === 'video') {
      el.append(h('h3', { text: '自動字幕' }));
      const autos = V.texts.filter(t => t.clip === clip.id && t.auto);
      const busy = (STT.job && STT.job.clip.el === clip.el) || STT.queue.some(q => q.el === clip.el);
      if (busy) el.append(h('p', { text: '正在聽這支影片的聲音，完成後字幕會出現在時間軸上。' }));
      else if (autos.length) {
        el.append(h('p', { text: '共 ' + autos.length + ' 句。點時間軸上的字幕就能修改內容。' }));
        el.append(h('div', { class: 'chips' },
          h('button', { class: 'btn', 'aria-pressed': String(clip.capOn), text: clip.capOn ? '字幕顯示中' : '字幕已隱藏', onclick: () => { clip.capOn = !clip.capOn; refresh(); vPanel(); } }),
          h('button', { class: 'btn', text: '重新產生', onclick: () => queueCaptions(clip) }),
          h('button', { class: 'btn danger', text: '刪除字幕', onclick: () => { V.texts = V.texts.filter(t => !(t.clip === clip.id && t.auto)); refresh(); vPanel(); } })));
      } else el.append(h('button', { class: 'btn wide', text: '聽聲音自動產生字幕', onclick: () => queueCaptions(clip) }));
    }
    el.append(h('h3', { text: '轉場（從上一段進到這一段）' }));
    if (V.clips[0] === clip) el.append(h('p', { text: '第一個片段前面沒有畫面，不需要轉場。' }));
    else chips(el, V_TRANS, clip.trans || 'none', v => { clip.trans = v; });
    el.append(h('h3', { text: '鏡頭' }));
    chips(el, [['none', '不動'], ['in', '緩慢推近'], ['out', '緩慢拉遠']], clip.kb || 'none', v => { clip.kb = v; drawFrame(); });
    el.append(h('h3', { text: '濾鏡' }));
    chips(el, V_FILTERS.map(f => [f[0], f[1]]), clip.filter, v => { clip.filter = v; drawFrame(); });
    for (const [k, label] of [['b', '亮度'], ['c', '對比'], ['s', '飽和度']]) {
      slider(el, { label, min: -100, max: 100, value: clip[k], def: 0, onInput: v => { clip[k] = v; drawFrame(); } });
    }
    slider(el, { label: '暗角', min: 0, max: 100, value: clip.vig || 0, def: 0, onInput: v => { clip.vig = v; drawFrame(); } });
    el.append(h('h3', { text: '畫面' }));
    chips(el, [['cover', '填滿畫面'], ['contain', '完整顯示'], ['blur', '模糊背景']], clip.fit, v => { clip.fit = v; drawFrame(); });
    el.append(h('div', { class: 'chips' },
      h('button', { class: 'btn', text: '向右轉 90°', onclick: () => { clip.rot = (clip.rot + 90) % 360; drawFrame(); } }),
      h('button', { class: 'btn', 'aria-pressed': String(clip.flip), text: '左右鏡像', onclick: () => { clip.flip = !clip.flip; vPanel(); drawFrame(); } })));
    slider(el, { label: '放大', min: 100, max: 300, step: 5, value: Math.round(clip.zoom * 100), def: 100, fmt: v => v + '%', onInput: v => { clip.zoom = v / 100; drawFrame(); } });
    el.append(h('button', { class: 'btn wide', 'aria-pressed': String(clip.fade), text: '開頭結尾淡入淡出', onclick: () => { clip.fade = !clip.fade; vPanel(); drawFrame(); } }));
    el.append(h('button', { class: 'btn ghost wide', text: '回到專案設定', onclick: () => { V.sel = null; rebuildTL(); vPanel(); } }));
    return;
  }
  if (text) {
    const owner = V.clips.find(c => c.id === text.clip);
    if (!owner) { V.selText = null; vPanel(); return; }
    const st = text.auto ? owner.cap : text;
    const k = owner.kind === 'video' ? owner.speed : 1, base = owner.kind === 'video' ? owner.in : 0;
    el.append(h('h2', { text: text.auto ? '自動字幕' : '文字設定' }), h('p', { text: '所屬片段：' + owner.name }));
    const ta = h('textarea', { id: 'vTextEdit', rows: 2 });
    ta.value = text.text;
    ta.addEventListener('input', () => { text.text = ta.value; refresh(); });
    el.append(h('label', { class: 'field', for: 'vTextEdit' }, '內容', ta));
    const fmt = v => v.toFixed(1) + ' 秒';
    slider(el, { label: '出現時間（片段內）', min: 0, max: Math.max(0.1, clipDur(owner)), step: 0.1, value: clamp((text.at - base) / k, 0, clipDur(owner)), fmt, onStart: pause, onInput: v => { text.at = base + v * k; rebuildTL(); seek(clipStart(owner) + v + 0.05); } });
    slider(el, { label: '顯示長度', min: 0.3, max: Math.max(15, Math.ceil(clipDur(owner))), step: 0.1, value: clamp(text.dur / k, 0.3, Math.max(15, Math.ceil(clipDur(owner)))), fmt, onInput: v => { text.dur = v * k; refresh(); } });
    el.append(h('hr'), h('h3', { text: text.auto ? '樣式（這個片段的字幕一起套用）' : '樣式' }));
    chips(el, [['top', '上方'], ['middle', '中間'], ['bottom', '下方']], st.pos, v => { st.pos = v; drawFrame(); });
    swatches(el, ['#ffffff', '#ffd24a', '#ff5d8f', '#62d2c6', '#1a1a1a'], st.color, c => { st.color = c; drawFrame(); });
    chips(el, Object.entries(FONTS).map(([key, v]) => [key, v[0]]), st.font || 'hei', v => {
      st.font = v; drawFrame();
      if (document.fonts && document.fonts.load) document.fonts.load('700 40px ' + FONTS[v][1], text.text).then(drawFrame, () => {});
    });
    if (!text.auto) {
      el.append(h('h3', { text: '出現動畫' }));
      chips(el, V_TEXT_ANIM, st.anim || 'fade', v => { st.anim = v; seek(clipStart(owner) + clamp((text.at - base) / k, 0, clipDur(owner)) + 0.02); });
    }
    el.append(h('button', { class: 'btn wide', 'aria-pressed': String(!!st.bg), text: '黑色底條（取代描邊）', onclick: () => { st.bg = !st.bg; vPanel(); drawFrame(); } }));
    slider(el, { label: '大小', min: 3, max: 20, step: 0.5, value: st.size, def: text.auto ? 6 : 7, onInput: v => { st.size = v; drawFrame(); } });
    el.append(h('button', { class: 'btn danger wide', text: text.auto ? '刪除這一句' : '刪除這段文字', onclick: deleteVideoSelection }));
    el.append(h('button', { class: 'btn ghost wide', text: '回到片段設定', onclick: () => { V.selText = null; V.sel = owner.id; rebuildTL(); vPanel(); } }));
    return;
  }

  el.append(h('h2', { text: '剪輯專案' }));
  el.append(h('button', { class: 'btn primary wide', text: '加入影片或圖片', onclick: async () => addMedia(await pickFiles($('#fileMedia'))) }));
  el.append(h('button', {
    class: 'btn wide', text: '在播放頭的片段加一段文字', onclick: () => {
      const L = locate(Math.min(V.t, Math.max(0, totalDur() - 0.001)));
      if (!L.clip) { toast('先加入影片或圖片'); return; }
      addClipText(L.clip);
    }
  }));
  el.append(h('button', { class: 'btn wide', text: V.music ? '換一首配樂' : '加入配樂（搜尋、貼網址或選檔）', onclick: openMusicDialog }));
  if (V.music) {
    const m = V.music;
    el.append(h('p', { text: '配樂：' + m.name }));
    slider(el, { label: '配樂音量', min: 0, max: 100, step: 5, value: Math.round(m.vol * 100), def: 60, fmt: v => v + '%', onInput: v => { m.vol = v / 100; setGain(m.el, m.vol); } });
    slider(el, { label: '從音樂的哪裡開始', min: 0, max: Math.max(1, Math.floor(m.dur) - 1), step: 1, value: Math.min(m.offset, Math.max(0, Math.floor(m.dur) - 1)), def: 0, fmt: v => fmtTime(v).replace(/\.0$/, ''), onStart: pause, onInput: v => { m.offset = v; rebuildTL(); } });
    el.append(h('button', { class: 'btn wide', 'aria-pressed': String(m.fadeOut), text: '影片結尾音樂淡出', onclick: () => { m.fadeOut = !m.fadeOut; setGain(m.el, m.vol); vPanel(); } }));
    if (m.credit) {
      el.append(h('p', { text: '這首需要標示作者。公開發表影片時，請把下面這段文字放在說明欄：' }), h('p', { class: 'credit', text: m.credit }));
      el.append(h('button', {
        class: 'btn wide', text: '複製標示文字', onclick: () => {
          const done = () => toast('已複製'), fail = () => toast('無法自動複製，請手動選取上面的文字');
          try { navigator.clipboard.writeText(m.credit).then(done, fail); } catch (e) { fail(); }
        }
      }));
    }
    el.append(h('button', { class: 'btn danger wide', text: '移除配樂', onclick: () => { m.el.pause(); V.music = null; rebuildTL(); vPanel(); } }));
  }
  el.append(h('h3', { text: '畫面比例' }));
  chips(el, [['16:9', '橫式 16:9'], ['9:16', '直式 9:16'], ['1:1', '方形 1:1'], ['4:5', '4:5']], V.aspect, v => { V.aspect = v; setVideoSize(); });
  el.append(h('hr'));
  el.append(h('button', { class: 'btn wide', text: '把目前畫面送到「修圖」', onclick: snapshotToPhoto }));
  el.append(h('button', { class: 'btn wide', text: '在播放頭插入定格畫面', onclick: addFreezeFrame }));
  el.append(h('hr'), h('h3', { text: '浮水印、Logo' }));
  el.append(h('button', {
    class: 'btn wide', text: V.mark ? '換一張浮水印圖片' : '加入浮水印圖片', onclick: async () => {
      const [f] = await pickFiles($('#fileImg'));
      if (!f) return;
      try {
        const cv = await fileToCanvas(f, 1200);
        V.mark = { cv, pos: 'br', size: 16, alpha: 0.85, ...(V.mark ? { pos: V.mark.pos, size: V.mark.size, alpha: V.mark.alpha } : {}) };
        vPanel(); drawFrame();
      } catch (e) { toast('無法讀取 ' + f.name); }
    }
  }));
  if (V.mark) {
    const m = V.mark;
    chips(el, [['tl', '左上'], ['tr', '右上'], ['bl', '左下'], ['br', '右下']], m.pos, v => { m.pos = v; drawFrame(); });
    slider(el, { label: '浮水印大小', min: 5, max: 50, value: m.size, def: 16, fmt: v => v + '%', onInput: v => { m.size = v; drawFrame(); } });
    slider(el, { label: '不透明度', min: 10, max: 100, value: Math.round(m.alpha * 100), def: 85, fmt: v => v + '%', onInput: v => { m.alpha = v / 100; drawFrame(); } });
    el.append(h('button', { class: 'btn danger wide', text: '移除浮水印', onclick: () => { V.mark = null; vPanel(); drawFrame(); } }));
  }
  if (V.texts.length) el.append(h('button', { class: 'btn wide', text: '匯出字幕檔（SRT）', onclick: exportSrt }));
  el.append(h('hr'), h('h3', { text: '自動字幕' }));
  el.append(h('button', {
    class: 'btn wide', 'aria-pressed': String(STT.auto), text: STT.auto ? '加入影片時自動產生字幕：開' : '加入影片時自動產生字幕：關',
    onclick: () => { STT.auto = !STT.auto; if (STT.auto) STT.broken = false; else cancelStt(); saveSttPrefs(); vPanel(); }
  }));
  if (STT.auto) {
    el.append(h('p', { text: '會聽影片裡的說話聲並轉成字幕，全程在你的裝置上處理，聲音不會上傳。不需要就按上面的按鈕關掉。' }));
    el.append(h('h3', { text: '影片裡說的語言' }));
    chips(el, STT_LANGS, STT.lang, v => { STT.lang = v; saveSttPrefs(); });
    el.append(h('h3', { text: '辨識品質（第一次需下載）' }));
    chips(el, STT_MODELS, STT.model, v => { STT.model = v; saveSttPrefs(); });
  }
  el.append(h('hr'), h('p', { text: '點時間軸上的片段可以修剪、變速、套濾鏡、加文字。按空白鍵播放或暫停。' }));
}

// ── 匯出 ──
// 優先用瀏覽器的影片編碼器直接編出「標準 MP4」（H.264 + AAC，檔頭在最前面）。
// 這種檔案 LINE、手機相簿、各種播放器都認得。瀏覽器內建錄影（MediaRecorder）產生的是
// 分段式 MP4 或 WebM，傳到 LINE 會被當成一般檔案，所以只在編碼器不能用時才退回去用它。
const MUXER_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.min.js';
function loadMuxer() {
  if (window.Mp4Muxer) return Promise.resolve();
  return new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = MUXER_URL; sc.onload = res; sc.onerror = () => rej(new Error('muxer'));
    document.head.append(sc);
  });
}
async function makeMp4Encoder(w, hh, fps, bitrate) {
  if (!window.VideoEncoder || !window.AudioEncoder || !window.VideoFrame || !window.AudioData || !V.audio) return null;
  try { await loadMuxer(); } catch (e) { return null; }
  // H.264 的 level 依畫面大小和格數挑最低夠用的，舊裝置比較播得動；不支援再往上試
  const load = w * hh * fps, levels = ['64001F', '640028', '64002A', '640033'];
  const start = load <= 1280 * 720 * 30 ? 0 : load <= 1920 * 1080 * 30 ? 1 : load <= 1920 * 1080 * 60 ? 2 : 3;
  let vcfg = null;
  for (const lv of levels.slice(start)) {
    const cfg = { codec: 'avc1.' + lv, width: w, height: hh, bitrate, framerate: fps, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) { vcfg = cfg; break; } } catch (e) { /* 試下一個 */ }
  }
  const sr = V.audio.ac.sampleRate, acfg = { codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: 2, bitrate: 160000 };
  let audioOk = false;
  try { audioOk = (await AudioEncoder.isConfigSupported(acfg)).supported; } catch (e) { audioOk = false; }
  if (!vcfg || !audioOk) return null;
  const target = new Mp4Muxer.ArrayBufferTarget();
  const muxer = new Mp4Muxer.Muxer({
    target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width: w, height: hh, frameRate: fps },
    audio: { codec: 'aac', numberOfChannels: 2, sampleRate: sr }
  });
  const E = { muxer, target, fps, sr, on: false, t0: 0, last: -1, lastKey: -1e9, samples: 0, error: null, tap: null, mute: null };
  E.ve = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { E.error = e; } });
  E.ve.configure(vcfg);
  E.ae = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { E.error = e; } });
  E.ae.configure(acfg);
  // 從總音量節點分接出聲音資料餵給編碼器
  const ac = V.audio.ac;
  E.tap = ac.createScriptProcessor(4096, 2, 2);
  E.mute = ac.createGain(); E.mute.gain.value = 0;
  V.audio.master.connect(E.tap); E.tap.connect(E.mute); E.mute.connect(ac.destination);
  E.tap.onaudioprocess = ev => {
    if (!E.on || E.error) return;
    const n = ev.inputBuffer.length, data = new Float32Array(n * 2);
    data.set(ev.inputBuffer.getChannelData(0), 0);
    data.set(ev.inputBuffer.numberOfChannels > 1 ? ev.inputBuffer.getChannelData(1) : ev.inputBuffer.getChannelData(0), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(E.samples / sr * 1e6), data });
    E.samples += n;
    try { E.ae.encode(ad); } catch (e) { E.error = e; }
    ad.close();
  };
  return E;
}
// 播放迴圈每畫完一格就呼叫：照設定的格數把畫布送進編碼器
function encodeFrame(force) {
  const E = V.enc;
  if (!E || !E.on || E.error) return;
  const n = Math.floor((performance.now() - E.t0) / 1000 * E.fps);
  if (n <= E.last && !force) return;
  if (E.ve.encodeQueueSize > 12) return;   // 電腦編不過來時跳過這一格，不讓記憶體堆積
  const idx = Math.max(n, E.last + 1);
  E.last = idx;
  const key = idx - E.lastKey >= E.fps * 2;
  if (key) E.lastKey = idx;
  const frame = new VideoFrame(VC, { timestamp: Math.round(idx * 1e6 / E.fps), duration: Math.round(1e6 / E.fps) });
  try { E.ve.encode(frame, { keyFrame: key }); } catch (e) { E.error = e; }
  frame.close();
}
function endExportUi() {
  $('#exportOverlay').hidden = true;
  $('#exportTitle').textContent = '正在匯出影片';
  V.exporting = false; V.rec = null; V.enc = null; V.res = 720; setVideoSize();
}
function closeEncoder(E) {
  E.on = false;
  E.tap.onaudioprocess = null;
  try { V.audio.master.disconnect(E.tap); E.tap.disconnect(); E.mute.disconnect(); } catch (e) { /* 已經拔掉了 */ }
  try { if (E.ve.state !== 'closed') E.ve.close(); if (E.ae.state !== 'closed') E.ae.close(); } catch (e) { /* 略過 */ }
}
async function finishEncode() {
  const E = V.enc;
  if (!E) return;
  encodeFrame(true);   // 補上最後一格
  E.on = false;
  $('#exportTitle').textContent = '正在完成檔案…';
  try {
    await E.ve.flush(); await E.ae.flush();
    if (E.error) throw E.error;
    E.muxer.finalize();
    const blob = new Blob([E.target.buffer], { type: 'video/mp4' });
    closeEncoder(E); endExportUi();
    if (V.cancelled) { toast('已取消匯出'); return; }
    saveFile('剪輯作品.mp4', blob);
  } catch (e) {
    if (V.cancelled) return;   // 收尾途中被取消，取消那邊已經處理好了
    closeEncoder(E); endExportUi();
    toast('匯出失敗：' + ((e && e.message) || '編碼器發生錯誤') + '。可以把解析度或格數調低再試一次。', 6000);
  }
}
function exportWithRecorder(fps) {
  if (!window.MediaRecorder || !VC.captureStream) { endExportUi(); toast('這個瀏覽器不支援影片匯出，請改用 Chrome 或 Edge', 4000); return; }
  const stream = VC.captureStream(fps);
  if (V.audio) V.audio.dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m));
  let rec;
  try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: videoBitrate() }); }
  catch (e) { endExportUi(); toast('無法開始錄製：' + e.message, 4000); return; }
  const chunks = [], ext = mime && mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    stream.getVideoTracks().forEach(t => t.stop());
    const cancelled = V.cancelled;
    endExportUi();
    if (cancelled) { toast('已取消匯出'); return; }
    saveFile('剪輯作品.' + ext, new Blob(chunks, { type: 'video/' + ext }));
    toast('這個瀏覽器只能匯出相容性較差的格式，傳到 LINE 可能會變成檔案。建議改用電腦版 Chrome 或 Edge 匯出。', 7000);
  };
  V.rec = rec;
  setTimeout(() => { if (V.exporting && V.rec === rec) { rec.start(1000); play(); } }, 500);
}
async function exportVideo() {
  if (V.exporting) return;
  if (totalDur() <= 0) { toast('先加入影片或圖片'); return; }
  pause();
  const fps = +EXP.video.fps;
  V.res = +EXP.video.res;
  setVideoSize();
  ensureAudio();
  V.exporting = true; V.cancelled = false; V.rec = null; V.enc = null;
  $('#exportBar').style.width = '0%';
  $('#exportOverlay').hidden = false;
  seek(0);
  const E = await makeMp4Encoder(VC.width, VC.height, fps, videoBitrate());
  if (!V.exporting) { if (E) closeEncoder(E); return; }   // 準備期間被取消了
  if (!E) { exportWithRecorder(fps); return; }
  V.enc = E;
  // 等第一格畫面就緒再開始
  setTimeout(() => {
    if (!V.exporting || V.enc !== E) return;
    E.t0 = performance.now(); E.on = true;
    play();
  }, 500);
}
$('#cancelExport').addEventListener('click', () => {
  V.cancelled = true;
  pause();
  if (V.rec && V.rec.state !== 'inactive') V.rec.stop();
  else {
    if (V.enc) closeEncoder(V.enc);
    endExportUi();
    toast('已取消匯出');
  }
});
const V_BPP = { std: 0.07, high: 0.12, max: 0.2 };
function videoBitrate() {
  const [w, hh] = videoDims(+EXP.video.res);
  return Math.min(80e6, Math.round(w * hh * +EXP.video.fps * V_BPP[EXP.video.br]));
}
function snapshotToPhoto() {
  if (!V.clips.length) { toast('先加入影片或圖片'); return; }
  pause();
  V.res = 1440; setVideoSize();
  const shot = cloneCanvas(VC);
  V.res = 720; setVideoSize();
  setPhotoImage(shot);
  setMode('photo');
  toast('已把畫面送到修圖');
}
function exportSrt() {
  const rows = [];
  let cs = 0;
  for (const c of V.clips) {
    for (const tx of V.texts) {
      if (tx.clip !== c.id) continue;
      const sp = textLocal(tx, c);
      if (sp) rows.push([cs + sp.s, cs + sp.e, tx.text]);
    }
    cs += clipDur(c);
  }
  if (!rows.length) { toast('目前沒有文字或字幕'); return; }
  rows.sort((a, b) => a[0] - b[0]);
  const p = (n, l) => String(n).padStart(l || 2, '0');
  const ts = t => { const ms = Math.round(t * 1000); return p(Math.floor(ms / 3600000)) + ':' + p(Math.floor(ms / 60000) % 60) + ':' + p(Math.floor(ms / 1000) % 60) + ',' + p(ms % 1000, 3); };
  const body = rows.map((r, i) => (i + 1) + '\n' + ts(r[0]) + ' --> ' + ts(r[1]) + '\n' + r[2] + '\n').join('\n');
  // Claude 頁面的存檔只接受特定副檔名，那邊改存 .txt
  saveFile(window.claude && window.claude.use ? '字幕.txt' : '字幕.srt', new Blob([body], { type: 'text/plain' }));
}

// ── 復原／重做：每次操作結束時比對狀態，有變才記一步 ──
const VH = { undo: [], redo: [], last: null, key: '' };
function vState() {
  return { clips: V.clips.map(c => ({ ...c, cap: { ...c.cap } })), texts: V.texts.map(t => ({ ...t })), aspect: V.aspect };
}
function vKey() {
  return JSON.stringify([V.clips.map(c => [c.id, c.in, c.out, c.speed, c.vol, c.filter, c.b, c.c, c.s, c.fit, c.rot, c.flip, c.zoom, c.fade, c.trans, c.kb, c.vig, c.capOn, c.cap]), V.texts, V.aspect]);
}
function vCommit() {
  const k = vKey();
  if (k === VH.key) return;
  if (VH.last) { VH.undo.push(VH.last); if (VH.undo.length > 40) VH.undo.shift(); VH.redo = []; }
  VH.last = vState(); VH.key = k;
  syncHistButtons();
}
function vRestore(st) {
  pause();
  V.clips = st.clips.map(c => ({ ...c, cap: { ...c.cap } })); V.texts = st.texts.map(t => ({ ...t }));
  V.aspect = st.aspect; V.sel = V.selText = null;
  VH.last = vState(); VH.key = vKey();
  setVideoSize(); rebuildTL(); vPanel(); seek(Math.min(V.t, totalDur()));
  syncHistButtons();
}
function vUndo() { if (VH.undo.length) { VH.redo.push(VH.last); vRestore(VH.undo.pop()); } }
function vRedo() { if (VH.redo.length) { VH.undo.push(VH.last); vRestore(VH.redo.pop()); } }

function initVideo() {
  $('#videoEmptyBtn').addEventListener('click', async () => addMedia(await pickFiles($('#fileMedia'))));
  setVideoSize();
  rebuildTL(); vPanel();
  vCommit();
}
