// 共用工具：DOM、提示、存檔、讀圖、範例圖
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

window.addEventListener('error', e => {
  document.documentElement.dataset.err = e.message;
  toast('程式發生錯誤：' + e.message);
});

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return e;
}

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function mk(w, h2) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h2));
  return c;
}
function cloneCanvas(src) {
  const c = mk(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

// 讓畫布在舞台裡等比例縮到最大
function fit(canvas, zoom) {
  const wrap = canvas.parentElement, box = wrap.parentElement;
  const bw = box.clientWidth - 24, bh = box.clientHeight - 24;
  if (bw <= 0 || bh <= 0) return;
  const s = Math.min(bw / canvas.width, bh / canvas.height) * (zoom || 1);
  wrap.style.width = Math.floor(canvas.width * s) + 'px';
  wrap.style.height = Math.floor(canvas.height * s) + 'px';
}

// ── 存檔：在 Claude 的頁面裡走 downloads 能力，其他地方用一般下載 ──
async function saveFile(filename, blob, note) {
  if (!blob) { toast('產生檔案失敗'); return; }
  if (window.claude && window.claude.use) {
    let d = null;
    try { d = await window.claude.use('downloads'); } catch (e) { d = null; }
    if (d) {
      try {
        await d.save({ filename, data: blob });
        toast('已儲存 ' + filename);
      } catch (e) {
        toast(e && e.code === 'declined' ? '已取消儲存' : '這個畫面無法儲存檔案（' + ((e && e.code) || '未知原因') + '）');
      }
      return;
    }
  }
  // 手機、平板：先問要存到相簿／分享到其他 App，還是下載成檔案
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (isTouchDevice() && /^(image|video)\//.test(file.type)) {
    // 網頁不能直接寫進相簿，這裡做到各系統允許的最短路徑：
    //   Android：直接存檔（進「下載」資料夾，相簿 App 的「下載」相簿看得到），不跳視窗
    //   iPhone／iPad：直接叫出系統選單，點「儲存影像／儲存影片」就進相簿
    // 需要提醒（相容性較差的格式、LINE 內建瀏覽器）或系統選單叫不出來時，才顯示自己的視窗
    if (note || inAppBrowser()) { openSaveDialog(file, note); return; }
    if (!isIOS()) {
      downloadBlob(filename, blob);
      toast('已存到手機。打開相簿，在「下載」相簿裡可以看到。', 6000);
      return;
    }
    let canShare = false;
    try { canShare = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { canShare = false; }
    // 匯出很快（圖片）時，使用者剛按過按鈕，可以直接叫出選單；影片要錄很久，系統會要求再按一次
    if (canShare && (!navigator.userActivation || navigator.userActivation.isActive)) {
      try { await navigator.share({ files: [file] }); toast('完成'); return; } catch (e) { /* 被取消或被系統擋下：改顯示視窗，讓使用者可以再按一次 */ }
    }
    openSaveDialog(file, note);
    return;
  }
  downloadBlob(filename, blob);
}
// LINE、Facebook、Instagram 點連結時開的是它們自己內建的瀏覽器，這種瀏覽器常常不能下載、也不能分享檔案
function inAppBrowser() {
  const m = /\b(Line|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger)\b/i.exec(navigator.userAgent);
  return m ? ({ line: 'LINE', fban: 'Facebook', fbav: 'Facebook', fb_iab: 'Facebook', instagram: 'Instagram', micromessenger: '微信' })[m[1].toLowerCase()] : '';
}
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isTouchDevice() {
  return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}
function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  toast('已下載 ' + filename);
}
// 匯出完成後的視窗（手機、平板）。分享一定要由使用者親手按按鈕觸發，
// 所以不能在匯出跑完時自動跳出系統的分享選單
function openSaveDialog(file, note) {
  const card = $('#dlgCard'), url = URL.createObjectURL(file), isVideo = file.type.startsWith('video/'), isImage = file.type.startsWith('image/');
  const ios = isIOS();
  const close = () => { $('#dlg').hidden = true; setTimeout(() => URL.revokeObjectURL(url), 30000); };
  card.style.maxWidth = '';
  card.replaceChildren();
  card.append(h('h2', { text: isVideo ? '影片做好了' : isImage ? '圖片做好了' : '檔案做好了' }));
  if (isImage) card.append(h('img', { class: 'save-preview', src: url, alt: '' }));
  else if (isVideo) card.append(h('video', { class: 'save-preview', src: url, controls: true, playsinline: true, preload: 'metadata' }));
  if (note) card.append(h('p', { class: 'warn', text: note }));
  const app = inAppBrowser();
  if (app) card.append(h('p', { class: 'warn', text: '你現在是用 ' + app + ' 內建的瀏覽器開啟，這裡常常不能儲存或分享檔案。請點右上角的選單，選「用預設瀏覽器開啟」（Safari 或 Chrome）再匯出一次。' }));
  let canShare = false;
  try { canShare = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { canShare = false; }
  if (!canShare) card.append(h('p', { text: '這個瀏覽器不能直接叫出分享選單，請用下面的「下載成檔案」。' + (isImage ? '也可以長按上面的圖片，選「加入照片」或「儲存影像」。' : '') }));
  else card.append(h('button', {
    class: 'btn primary wide big', text: '存到相簿',
    onclick: async () => {
      try {
        await navigator.share({ files: [file] });
        close();
        toast('完成');
      } catch (e) {
        // 使用者在系統選單按取消不算錯誤，留在這個視窗讓他可以再選
        if (e && e.name === 'AbortError') return;
        toast('這台裝置沒辦法直接分享這個檔案，請改按「下載成檔案」', 4500);
      }
    }
  }));
  if (canShare) card.append(h('p', {
    text: ios ? '按下後會跳出系統選單，點「儲存' + (isVideo ? '影片' : '影像') + '」就會進相簿。同一個選單也可以直接傳到 LINE、Instagram。'
      : '按下後會跳出系統選單，可以選 LINE、Instagram、相簿、雲端硬碟等 App。'
  }));
  card.append(h('button', { class: 'btn wide' + (canShare ? '' : ' primary big'), text: '下載成檔案', onclick: () => { downloadBlob(file.name, file); close(); } }));
  card.append(h('p', { text: ios ? '下載的檔案會放在「檔案」App 的下載項目裡。' : '下載的檔案會放在「下載」資料夾，通常相簿裡也看得到。' }));
  card.append(h('div', { class: 'actions' }, h('button', { class: 'btn', text: '關閉', onclick: close })));
  $('#dlg').hidden = false;
}

// 把畫布存成圖片檔；opt 是 { fmt: 'jpg'|'png'|'webp', q: 50..100 }
function saveCanvas(c, name, opt) {
  const mime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[opt.fmt] || 'image/jpeg';
  c.toBlob(b => {
    if (!b) { toast('圖片太大，瀏覽器無法產生檔案，請選小一點的尺寸', 4000); return; }
    const ext = b.type === 'image/jpeg' ? 'jpg' : b.type === 'image/webp' ? 'webp' : 'png';
    saveFile(name + '.' + ext, b);
  }, mime, opt.q / 100);
}

// 讀圖並縮到指定長邊以內，回傳 canvas
async function fileToCanvas(file, maxSide) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    src = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('無法讀取圖片'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width, h2 = src.height;
  const s = Math.min(1, maxSide / Math.max(w, h2));
  const c = mk(w * s, h2 * s);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// 剛加入的文字：游標直接放進輸入框並全選，打字就會取代預設的「輸入文字」，不用自己先刪
function selectAllIn(sel) {
  const ta = $(sel);
  if (!ta) return;
  ta.focus();
  ta.select();
}
function pickFiles(input) {
  return new Promise(res => {
    input.value = '';
    input.onchange = () => res([...input.files]);
    input.click();
  });
}

function roundRectPath(ctx, x, y, w, h2, r) {
  r = Math.min(r, w / 2, h2 / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h2, r);
  ctx.arcTo(x + w, y + h2, x, y + h2, r);
  ctx.arcTo(x, y + h2, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const HAS_FILTER = (() => {
  try { return typeof document.createElement('canvas').getContext('2d').filter === 'string'; } catch (e) { return false; }
})();
function blurCanvas(src, r) {
  const c = mk(src.width, src.height), x = c.getContext('2d');
  if (r <= 0.05) { x.drawImage(src, 0, 0); return c; }
  if (HAS_FILTER) {
    x.filter = 'blur(' + r + 'px)';
    x.drawImage(src, 0, 0);
    x.filter = 'none';
  } else {
    // 不支援 filter 的瀏覽器：縮小再放大，效果接近
    const f = Math.max(1, r / 1.2);
    const t = mk(src.width / f, src.height / f);
    const tx = t.getContext('2d');
    tx.imageSmoothingQuality = 'high';
    tx.drawImage(src, 0, 0, t.width, t.height);
    x.imageSmoothingQuality = 'high';
    x.drawImage(t, 0, 0, c.width, c.height);
  }
  return c;
}

// ── 介面小元件 ──
let uid = 0;
function slider(parent, o) {
  const id = 'sl' + (++uid);
  const fmt = o.fmt || (v => String(v));
  const out = h('output', { for: id, text: fmt(o.value) });
  const inp = h('input', { type: 'range', id, min: o.min, max: o.max, step: o.step || 1, value: o.value });
  let dirty = false;
  const start = () => { if (!dirty) { dirty = true; if (o.onStart) o.onStart(); } };
  inp.addEventListener('input', () => {
    start();
    const v = +inp.value;
    out.textContent = fmt(v);
    o.onInput(v);
  });
  inp.addEventListener('change', () => { dirty = false; if (o.onEnd) o.onEnd(+inp.value); });
  inp.addEventListener('dblclick', () => {
    if (o.def == null) return;
    start();
    inp.value = o.def;
    out.textContent = fmt(o.def);
    o.onInput(o.def);
    dirty = false;
    if (o.onEnd) o.onEnd(o.def);
  });
  parent.append(h('div', { class: 'row' }, h('label', { for: id, text: o.label }), out, inp));
  return inp;
}
// 可收合的分類：回傳放內容的容器。預設收著，使用者點箭頭才展開；展開狀態在面板重畫後保留
const GROUP_OPEN = {};
function group(parent, id, title, open) {
  const body = h('div', { class: 'group-body' });
  const box = h('details', { class: 'group', open: id in GROUP_OPEN ? GROUP_OPEN[id] : !!open }, h('summary', { text: title }), body);
  box.addEventListener('toggle', () => { GROUP_OPEN[id] = box.open; });
  parent.append(box);
  return body;
}
function chips(parent, options, current, onPick) {
  const box = h('div', { class: 'chips' });
  for (const [value, label] of options) {
    box.append(h('button', {
      class: 'btn', 'aria-pressed': String(value === current), text: label,
      onclick: e => {
        $$('button', box).forEach(b => b.setAttribute('aria-pressed', 'false'));
        e.currentTarget.setAttribute('aria-pressed', 'true');
        onPick(value);
      }
    }));
  }
  parent.append(box);
  return box;
}
function swatches(parent, colors, current, onPick) {
  const box = h('div', { class: 'inline' });
  const pick = h('input', { type: 'color', id: 'col' + (++uid), value: current, 'aria-label': '自訂顏色', oninput: e => onPick(e.target.value) });
  for (const c of colors) {
    box.append(h('button', {
      class: 'swatch', style: 'background:' + c, 'aria-label': c, 'aria-pressed': String(c === current),
      onclick: () => { pick.value = c; onPick(c); }
    }));
  }
  box.append(pick);
  parent.append(box);
}

// ── 範例圖：用程式畫的風景，讓工具一打開就有東西可以試 ──
const SAMPLE_PALETTES = [
  { sky: ['#2b2a66', '#d9548a', '#ffc76b'], sun: '#fff1c2', hills: ['#6b3f7d', '#472a61', '#2a1a40'], water: '#3a2a66' },
  { sky: ['#0f6f9c', '#69c8d8', '#f4f1d0'], sun: '#ffffff', hills: ['#3f8f9a', '#2c6f80', '#1c4c5f'], water: '#1f6f8f' },
  { sky: ['#8fc7a0', '#e6efb5', '#fff6d6'], sun: '#fffbe0', hills: ['#6ea86a', '#42804f', '#235238'], water: '#3d7f6b' },
  { sky: ['#0b0d2e', '#28286e', '#7a4f9f'], sun: '#e8e6ff', hills: ['#2a2a66', '#1b1a48', '#0e0d2a'], water: '#16153d' }
];
function makeSample(variant, w, h2) {
  const p = SAMPLE_PALETTES[variant % SAMPLE_PALETTES.length];
  const c = mk(w, h2), x = c.getContext('2d');
  let seed = 7 + variant * 131;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const horizon = h2 * 0.66;
  const g = x.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, p.sky[0]); g.addColorStop(0.6, p.sky[1]); g.addColorStop(1, p.sky[2]);
  x.fillStyle = g; x.fillRect(0, 0, w, horizon);
  const sx = w * (0.3 + 0.4 * rnd()), sy = horizon * (0.5 + 0.25 * rnd()), sr = Math.min(w, h2) * 0.07;
  const glow = x.createRadialGradient(sx, sy, 0, sx, sy, sr * 6);
  glow.addColorStop(0, p.sun); glow.addColorStop(0.16, p.sun + 'cc'); glow.addColorStop(1, p.sun + '00');
  x.fillStyle = glow; x.fillRect(0, 0, w, horizon);
  if (variant % 4 === 3) {
    x.fillStyle = '#ffffff';
    for (let i = 0; i < 140; i++) { x.globalAlpha = 0.3 + rnd() * 0.7; x.fillRect(rnd() * w, rnd() * horizon * 0.8, 2, 2); }
    x.globalAlpha = 1;
  }
  p.hills.forEach((col, i) => {
    const base = horizon - h2 * (0.16 - i * 0.05), amp = h2 * (0.1 - i * 0.02);
    const f1 = 1.5 + rnd() * 2, f2 = 4 + rnd() * 4, ph = rnd() * 6;
    x.fillStyle = col; x.beginPath(); x.moveTo(0, horizon);
    for (let px = 0; px <= w; px += 8) {
      const t = px / w;
      x.lineTo(px, base - amp * (0.6 * Math.sin(t * f1 * Math.PI + ph) + 0.4 * Math.sin(t * f2 * Math.PI + ph * 2)));
    }
    x.lineTo(w, horizon); x.closePath(); x.fill();
  });
  const wg = x.createLinearGradient(0, horizon, 0, h2);
  wg.addColorStop(0, p.sky[2]); wg.addColorStop(0.25, p.sky[1]); wg.addColorStop(1, p.water);
  x.fillStyle = wg; x.fillRect(0, horizon, w, h2 - horizon);
  x.strokeStyle = p.sun; x.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const t = rnd(), y = horizon + 6 + t * (h2 - horizon - 10), len = w * (0.01 + 0.07 * t), cx = sx + (rnd() - 0.5) * w * 0.3 * (0.3 + t);
    x.globalAlpha = 0.15 + 0.45 * (1 - t); x.lineWidth = 1 + 3 * t;
    x.beginPath(); x.moveTo(cx - len, y); x.lineTo(cx + len, y); x.stroke();
  }
  x.globalAlpha = 1;
  return c;
}
