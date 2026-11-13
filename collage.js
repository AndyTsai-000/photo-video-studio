// 拼圖模式
const CV2 = $('#cv2');
const COLLAGE_SIDE = 2400;
const COLLAGE_MAX = 15;   // 一張拼圖最多幾張照片
const COLLAGE_VIDEO_MAX = 4, COLLAGE_VIDEO_SEC = 60;   // 影片同時播放太多段手機會跑不動
const C = {
  imgs: [], layout: 0, gap: 0, radius: 0, bg: '#ffffff', ratio: '1:1', sel: -1
};
const RATIOS = { '1:1': [1, 1], '3:4': [3, 4], '4:3': [4, 3], '9:16': [9, 16], '16:9': [16, 9] };

// 版型用「每一列放幾格」描述。格數可以換成比例陣列（[2, 1] 表示左寬右窄）；
// 第二個參數是各列的高度比例。cols 則是把同一套描述轉成「每一欄」
function rowsLayout(spec, heights) {
  const out = [], hs = heights || spec.map(() => 1), ht = hs.reduce((a, b) => a + b, 0);
  let y = 0;
  spec.forEach((row, r) => {
    const ws = Array.isArray(row) ? row : Array(row).fill(1), wt = ws.reduce((a, b) => a + b, 0), hgt = hs[r] / ht;
    let x = 0;
    for (const w of ws) { out.push([x, y, w / wt, hgt]); x += w / wt; }
    y += hgt;
  });
  return out;
}
function colsLayout(spec, widths) {
  return rowsLayout(spec, widths).map(([x, y, w, hh]) => [y, x, hh, w]);
}
const R = rowsLayout, K = colsLayout, T = 1 / 3;
// 版型依照片張數分組；使用者放了幾張照片，就列出那一組
const LAYOUTS = {
  1: [R([1])],
  2: [R([2]), R([1, 1]), R([[2, 1]]), R([[1, 2]]), R([1, 1], [2, 1]), R([1, 1], [1, 2])],
  3: [K([1, 2]), K([2, 1]), R([1, 2]), R([2, 1]), R([3]), R([1, 1, 1]), K([1, 2], [2, 1]), R([1, 2], [2, 1]), R([[1, 2, 1]]), R([1, 1, 1], [1, 2, 1])],
  4: [R([2, 2]), K([1, 3]), K([3, 1]), R([1, 3]), R([3, 1]), R([4]), R([1, 1, 1, 1]), K([1, 3], [2, 1]), R([1, 3], [2, 1]), R([[2, 1], [1, 2]]), R([1, 2, 1])],
  5: [R([2, 3]), R([3, 2]), K([2, 3]), K([3, 2]), R([1, 2, 2]), K([1, 2, 2]), K([1, 4], [2, 1]), R([1, 4], [2, 1]), R([2, 1, 2]), R([[2, 1], [1, 1, 1]], [3, 2])],
  6: [R([3, 3]), R([2, 2, 2]), K([1, 2, 3]), R([1, 2, 3]),
    [[0, 0, 2 * T, 2 * T], [2 * T, 0, T, T], [2 * T, T, T, T], [0, 2 * T, T, T], [T, 2 * T, T, T], [2 * T, 2 * T, T, T]],
    R([2, 4]), R([3, 3], [2, 1]), K([3, 3], [2, 1]), R([[2, 1], [1, 1], [1, 2]]), R([2, 1, 3])],
  7: [R([2, 3, 2]), R([3, 4]), R([4, 3]), K([2, 3, 2]), K([3, 4]), R([1, 3, 3]), R([3, 1, 3], [1, 2, 1]), R([2, 2, 3]), R([1, 2, 4])],
  8: [R([3, 2, 3]), R([4, 4]), K([4, 4]), R([2, 2, 2, 2]), R([2, 3, 3]), R([3, 3, 2]), K([3, 2, 3]), R([1, 3, 4]), R([2, 4, 2])],
  9: [R([3, 3, 3]), R([2, 3, 4]), K([2, 3, 4]), R([4, 5]), R([1, 4, 4]), K([1, 4, 4]), R([4, 1, 4], [1, 2, 1]), R([3, 3, 3], [2, 1, 1]), K([3, 3, 3], [2, 1, 1]), R([2, 2, 2, 3])],
  10: [R([3, 4, 3]), R([2, 3, 3, 2]), R([5, 5]), K([3, 4, 3]), K([5, 5]), R([1, 3, 3, 3]), R([4, 3, 3]), R([2, 4, 4])],
  11: [R([3, 4, 4]), R([4, 3, 4]), R([4, 4, 3]), R([2, 3, 3, 3]), R([3, 3, 3, 2]), K([4, 3, 4]), R([1, 5, 5])],
  12: [R([4, 4, 4]), R([3, 3, 3, 3]), K([4, 4, 4]), K([3, 3, 3, 3]), R([6, 6]), R([2, 4, 4, 2]), R([3, 4, 5]), R([1, 3, 4, 4])],
  13: [R([4, 5, 4]), R([3, 3, 4, 3]), R([3, 4, 3, 3]), K([4, 5, 4]), R([1, 4, 4, 4]), R([4, 4, 5]), R([2, 3, 4, 4])],
  14: [R([4, 5, 5]), R([5, 4, 5]), R([3, 4, 4, 3]), R([4, 3, 4, 3]), K([5, 4, 5]), R([2, 4, 4, 4]), R([1, 4, 4, 5])],
  15: [R([5, 5, 5]), R([3, 4, 4, 4]), R([4, 4, 4, 3]), R([3, 3, 3, 3, 3]), K([5, 5, 5]), K([3, 3, 3, 3, 3]), R([4, 5, 6]), R([1, 4, 5, 5])]
};
function layoutList() {
  return LAYOUTS[clamp(C.imgs.length, 1, COLLAGE_MAX)];
}
function currentLayout() {
  const list = layoutList();
  return list[C.layout % list.length];
}
// 長圖拼接：每張照片保持原本比例，直的一張接一張（或橫的一張接一張）
function isStitch() { return (C.ratio === 'v' || C.ratio === 'h') && C.imgs.length > 0; }
function stitchLayout(L) {
  const g = L * C.gap / 100, inner = L - 2 * g, rects = [];
  let pos = g;
  for (const it of C.imgs.slice(0, COLLAGE_MAX)) {
    if (C.ratio === 'v') { const hh = inner * it.cv.height / it.cv.width; rects.push({ x: g, y: pos, w: inner, h: hh }); pos += hh + g; }
    else { const w = inner * it.cv.width / it.cv.height; rects.push({ x: pos, y: g, w, h: inner }); pos += w + g; }
  }
  return C.ratio === 'v' ? { W: L, H: Math.round(pos), rects } : { W: Math.round(pos), H: L, rects };
}
function collageSize() {
  if (isStitch()) { const st = stitchLayout(1600); return [st.W, st.H]; }
  if (!RATIOS[C.ratio]) return [COLLAGE_SIDE, COLLAGE_SIDE];
  const [a, b] = RATIOS[C.ratio], s = COLLAGE_SIDE / Math.max(a, b);
  return [Math.round(a * s), Math.round(b * s)];
}
function cellRects(W, H) {
  if (isStitch()) return stitchLayout(C.ratio === 'v' ? W : H).rects;
  const gap = Math.min(W, H) * C.gap / 100;
  return currentLayout().map(([x, y, w, hh]) => ({
    x: gap + x * (W - gap), y: gap + y * (H - gap), w: w * (W - gap) - gap, h: hh * (H - gap) - gap
  }));
}
function drawnSize(it, r) {
  const s = Math.max(r.w / it.cv.width, r.h / it.cv.height) * it.zoom;
  return [it.cv.width * s, it.cv.height * s];
}
function renderCollage(target, scale, final) {
  // 長圖可能非常長，超過瀏覽器畫布上限前先縮小
  { const [w0, h0] = collageSize(); scale *= Math.min(1, 14000 / Math.max(w0 * scale, h0 * scale)); }
  const [W0, H0] = collageSize(), W = Math.round(W0 * scale), H = Math.round(H0 * scale);
  if (target.width !== W || target.height !== H) { target.width = W; target.height = H; }
  const ctx = target.getContext('2d');
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  if (!C.imgs.length) return;
  const rects = cellRects(W, H), rad = Math.min(W, H) * C.radius / 100;
  rects.forEach((r, i) => {
    const it = C.imgs[i];
    if (r.w <= 0 || r.h <= 0) return;
    if (!it) {
      // 還沒放照片的格子：預覽時畫一個加號提示，匯出時留空
      if (final) return;
      ctx.save();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, rad);
      ctx.fillStyle = 'rgba(128,120,140,.28)'; ctx.fill();
      const p = Math.min(r.w, r.h) * 0.12;
      ctx.strokeStyle = 'rgba(128,120,140,.9)'; ctx.lineWidth = Math.max(2, p * 0.18); ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(r.x + r.w / 2 - p, r.y + r.h / 2); ctx.lineTo(r.x + r.w / 2 + p, r.y + r.h / 2);
      ctx.moveTo(r.x + r.w / 2, r.y + r.h / 2 - p); ctx.lineTo(r.x + r.w / 2, r.y + r.h / 2 + p);
      ctx.stroke();
      ctx.restore();
      return;
    }
    const [dw, dh] = drawnSize(it, r);
    ctx.save();
    roundRectPath(ctx, r.x, r.y, r.w, r.h, rad); ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    // 影片格畫當下這一格畫面；還沒載入好就先畫封面
    ctx.drawImage(it.vid && it.vid.readyState >= 2 ? it.vid : it.cv, r.x - (dw - r.w) * it.ox, r.y - (dh - r.h) * it.oy, dw, dh);
    ctx.restore();
    const dropHere = !final && cDrag && cDrag.target === i;
    if (!final && (i === C.sel || dropHere)) {
      ctx.save();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, rad);
      if (dropHere) { ctx.fillStyle = 'rgba(98,210,198,.35)'; ctx.fill(); ctx.setLineDash([W / 60, W / 90]); }
      ctx.lineWidth = Math.max(3, W / 200); ctx.strokeStyle = dropHere ? '#62d2c6' : '#ff5d8f';
      ctx.stroke();
      ctx.restore();
    }
  });
}
function drawCollage() {
  // 還沒有照片時跟剪輯一樣只顯示引導，不畫空格子
  const empty = !C.imgs.length;
  $('#collageEmpty').hidden = !empty;
  CV2.parentElement.hidden = empty;
  // 沒有照片時右邊的設定面板也先收起來，加入照片後才出現
  $('#collagePanel').hidden = empty;
  $('#collage').classList.toggle('is-empty', empty);
  renderCollage(CV2, 0.5, false);
  fit(CV2);
  const k = +EXP.collage.side / COLLAGE_SIDE, [w, hh] = collageSize().map(v => Math.round(v * k));
  const nv = C.imgs.filter(it => it.vid).length;
  $('#collageInfo').textContent = !C.imgs.length ? ''
    : nv ? (C.imgs.length - nv ? (C.imgs.length - nv) + ' 張照片、' : '') + nv + ' 段影片　匯出成 ' + fmtTime(collageVideoDur()) + ' 的影片'
      : C.imgs.length + ' 張照片　輸出 ' + w + ' × ' + hh + ' 像素';
  collageLoop();
}

// ── 影片格：拼圖裡的影片會一直重複播放；匯出時錄成一支影片 ──
function collageHasVideo() { return C.imgs.some(it => it.vid); }
function collageVideoDur() {
  const d = Math.max(0, ...C.imgs.filter(it => it.vid).map(it => isFinite(it.vid.duration) ? it.vid.duration : 0));
  return Math.min(COLLAGE_VIDEO_SEC, d || 5);
}
function collageVideoSize() {
  const [W0, H0] = collageSize(), k = Math.min(1, 1920 / Math.max(W0, H0));
  return [Math.max(2, Math.round(W0 * k) & ~1), Math.max(2, Math.round(H0 * k) & ~1)];
}
// 影片放在畫面外一個看不到的小框裡：有些手機的影片不在網頁上就不會解碼畫面
let cVidHost = null;
function collageVidHost() {
  if (!cVidHost) {
    cVidHost = document.createElement('div');
    cVidHost.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1';
    document.body.appendChild(cVidHost);
  }
  return cVidHost;
}
async function collageVideoItem(f) {
  const v = document.createElement('video');
  v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
  v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
  v.style.cssText = 'width:2px;height:2px';
  collageVidHost().appendChild(v);
  v.src = URL.createObjectURL(f);
  try {
    // 只等「知道影片大小和長度」就好：iPhone 等手機在影片播放前不會先載入畫面，等畫面會一直卡住
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout')), 20000);
      v.onloadedmetadata = () => { clearTimeout(t); res(); };
      v.onerror = () => { clearTimeout(t); rej(new Error('format')); };
    });
  } catch (e) { v.remove(); URL.revokeObjectURL(v.src); throw e; }
  if (!isFinite(v.duration)) await waitSeek(v, 1e7);   // 有些錄製檔一開始不知道長度
  // 沒聲音的影片手機通常允許直接播：播一下再停，讓瀏覽器把畫面載進來
  if (v.readyState < 2) {
    await Promise.race([v.play().then(() => v.pause()).catch(() => {}), new Promise(r => setTimeout(r, 1500))]);
  }
  await waitSeek(v, Math.min(0.1, (isFinite(v.duration) && v.duration) ? v.duration / 2 : 0.1));
  const vw = v.videoWidth || 16, vh = v.videoHeight || 9, s = Math.min(1, 1280 / Math.max(vw, vh));
  const cv = mk(Math.round(vw * s), Math.round(vh * s));
  const it = { cv, vid: v, ox: 0.5, oy: 0.5, zoom: 1, poster: false };
  const grab = () => {
    if (it.poster || v.readyState < 2) return;
    try { cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height); it.poster = true; } catch (e) { /* 下次再試 */ }
  };
  grab();
  // 手機不讓影片自己播時，封面要等使用者點一下、影片開始播才拿得到
  if (!it.poster) { v.addEventListener('loadeddata', grab); v.addEventListener('timeupdate', grab); }
  // 拼圖裡的影片一律不出聲，只看畫面
  return it;
}
function dropCollageVideo(it) {
  if (!it || !it.vid) return;
  it.vid.pause(); URL.revokeObjectURL(it.vid.src); it.vid.remove(); it.vid = null;
}
// 手機省電模式等情況下影片不會自己播：在拼圖畫面點任何地方就開始播
function collagePlayAll() {
  if (MODE !== 'collage' || C.exporting) return;
  for (const it of C.imgs) if (it.vid && it.vid.paused) it.vid.play().catch(() => {});
}
document.addEventListener('pointerdown', collagePlayAll, true);
function collageReset() {
  C.imgs.forEach(dropCollageVideo);
  C.imgs = []; C.sel = -1; C.layout = 0;
}
// 在拼圖畫面而且有影片時，持續重畫讓影片動起來；離開拼圖就停下來
let cLoopOn = false, cLoopAt = 0;
function collageLoop() {
  const want = () => MODE === 'collage' && collageHasVideo() && !document.hidden && !C.exporting;
  if (!want() || cLoopOn) return;
  cLoopOn = true;
  for (const it of C.imgs) if (it.vid) it.vid.play().catch(() => {});
  const step = now => {
    if (!want()) {
      cLoopOn = false;
      if (!C.exporting) for (const it of C.imgs) if (it.vid) it.vid.pause();
      return;
    }
    if (now - cLoopAt > 30) { cLoopAt = now; renderCollage(CV2, 0.5, false); }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) collageLoop(); });

// 有些手機選出來的影片沒有標檔案種類，再看副檔名
const isCollageVideo = f => f.type.startsWith('video/') || (!f.type && /\.(mp4|mov|m4v|webm|3gp|mkv)$/i.test(f.name));
async function addCollageFiles(files) {
  const imgs = files.filter(f => f.type.startsWith('image/') || isCollageVideo(f));
  if (!imgs.length) return;
  const before = C.imgs.length, pick = [];
  let nv = C.imgs.filter(it => it.vid).length, full = false, many = false;
  for (const f of imgs) {
    if (before + pick.length >= COLLAGE_MAX) { full = true; break; }
    if (isCollageVideo(f)) { if (nv >= COLLAGE_VIDEO_MAX) { many = true; continue; } nv++; }
    pick.push(f);
  }
  const nvNew = pick.filter(isCollageVideo).length;
  if (nvNew) toast('正在讀取 ' + nvNew + ' 段影片…', 20000);
  // 全部同時讀，不用一個等一個
  const items = await Promise.all(pick.map(f => (isCollageVideo(f) ? collageVideoItem(f) : fileToCanvas(f, 2400).then(cv => ({ cv, ox: 0.5, oy: 0.5, zoom: 1 })))
    .catch(() => { toast('無法讀取 ' + f.name + (isCollageVideo(f) ? '，這個瀏覽器可能不支援這種影片格式' : '')); return null; })));
  for (const it of items) if (it) C.imgs.push(it);
  if (C.imgs.length !== before) C.layout = 0;
  C.sel = -1;
  collagePanel(); drawCollage();
  if (full) toast('一張拼圖最多放 ' + COLLAGE_MAX + ' 張');
  else if (many) toast('一張拼圖最多放 ' + COLLAGE_VIDEO_MAX + ' 段影片，太多段手機會播不動');
  else if (nvNew && items.some(Boolean)) {
    $('#toast').hidden = true;
    // 過一下還沒動起來，就是手機不讓影片自己播
    setTimeout(() => { if (MODE === 'collage' && C.imgs.some(it => it.vid && it.vid.paused)) toast('點一下畫面，影片就會開始播放', 4000); }, 1200);
  }
}

// 在格子裡拖曳可以移動照片位置
function cellAt(e) {
  const r = CV2.getBoundingClientRect(), k = CV2.width / r.width;
  const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
  const rects = cellRects(CV2.width, CV2.height);
  const i = rects.findIndex(c => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
  return { i: i < C.imgs.length ? i : -1, empty: i >= C.imgs.length, rect: rects[i], k };
}
// 拖曳照片：拖到另一格放開就交換位置；在自己那格裡拖曳則是移動照片顯示的範圍
let cDrag = null;
CV2.addEventListener('pointerdown', e => {
  const hit = cellAt(e);
  if (C.sel !== hit.i) { C.sel = hit.i; collagePanel(); }
  drawCollage();
  if (hit.i < 0) return;
  try { CV2.setPointerCapture(e.pointerId); } catch (err) { /* 略過 */ }
  const it = C.imgs[hit.i];
  cDrag = { ...hit, x: e.clientX, y: e.clientY, it, ox0: it.ox, oy0: it.oy, target: -1 };
  CV2.style.cursor = 'grabbing';
});
CV2.addEventListener('pointermove', e => {
  if (!cDrag) return;
  const { it, rect, k } = cDrag, over = cellAt(e).i;
  const dx = (e.clientX - cDrag.x) * k, dy = (e.clientY - cDrag.y) * k;
  cDrag.x = e.clientX; cDrag.y = e.clientY;
  if (over >= 0 && over !== cDrag.i) {
    // 已經拖到別格上：標出要交換的那一格，照片在原格的位置還原
    cDrag.target = over;
    it.ox = cDrag.ox0; it.oy = cDrag.oy0;
  } else {
    cDrag.target = -1;
    const [dw, dh] = drawnSize(it, rect);
    if (dw - rect.w > 0.5) it.ox = clamp(it.ox - dx / (dw - rect.w), 0, 1);
    if (dh - rect.h > 0.5) it.oy = clamp(it.oy - dy / (dh - rect.h), 0, 1);
  }
  drawCollage();
});
function endCollageDrag(apply) {
  if (!cDrag) return;
  const { i, target } = cDrag;
  cDrag = null;
  CV2.style.cursor = 'grab';
  if (apply && target >= 0) {
    [C.imgs[i], C.imgs[target]] = [C.imgs[target], C.imgs[i]];
    C.sel = target;
    collagePanel();
  }
  drawCollage();
}
CV2.addEventListener('pointerup', () => endCollageDrag(true));
CV2.addEventListener('pointercancel', () => endCollageDrag(false));
CV2.style.cursor = 'grab';

function layoutIcon(rects) {
  const c = mk(40, 40), x = c.getContext('2d');
  x.fillStyle = '#a8a0b6';
  for (const [rx, ry, rw, rh] of rects) x.fillRect(rx * 40 + 1.5, ry * 40 + 1.5, rw * 40 - 3, rh * 40 - 3);
  return c;
}
function collagePanel() {
  const root = $('#collagePanel');
  let el = root;
  el.replaceChildren();
  el.append(h('h2', { text: '拼圖' }));
  el.append(h('button', { class: 'btn primary wide', text: '加入照片或影片（最多 ' + COLLAGE_MAX + ' 張）', onclick: async () => addCollageFiles(await pickFiles($('#fileCollage'))) }));
  if (!C.imgs.length) { el.append(h('p', { text: '先選照片或影片。選了幾張，這裡就會出現那個張數可以用的版型。' })); return; }

  el = group(root, 'col.layout', C.imgs.length + ' 格的版型');
  const layHead = h('span');
  const lay = h('div', { class: 'layouts' });
  layoutList().forEach((rects, i) => {
    lay.append(h('button', { 'aria-pressed': String(i === C.layout), 'aria-label': '版型 ' + (i + 1), onclick: () => { C.layout = i; collagePanel(); drawCollage(); } }, layoutIcon(rects)));
  });
  el.append(lay);
  if (isStitch()) { layHead.hidden = lay.hidden = true; el.append(h('p', { text: '長圖拼接會讓每張照片保持原本的比例，依序接起來，適合拼對話截圖或步驟圖。' })); }
  el = group(root, 'col.ratio', '畫布比例');
  chips(el, Object.keys(RATIOS).map(k => [k, k]).concat([['v', '直向長圖'], ['h', '橫向長圖']]), C.ratio, v => { C.ratio = v; collagePanel(); drawCollage(); });
  el = group(root, 'col.gap', '間距與圓角');
  slider(el, { label: '間距', min: 0, max: 8, step: 0.5, value: C.gap, def: 0, onInput: v => { C.gap = v; drawCollage(); } });
  slider(el, { label: '圓角', min: 0, max: 12, step: 0.5, value: C.radius, def: 0, onInput: v => { C.radius = v; drawCollage(); } });
  el = group(root, 'col.bg', '底色');
  swatches(el, ['#ffffff', '#1a1a1a', '#f3e9dc', '#ffd9e4', '#d9f2ee'], C.bg, c => { C.bg = c; drawCollage(); });

  el = root;
  const it = C.imgs[C.sel];
  if (!it) el.append(h('p', { text: '按住照片拖到另一格，放開就會交換位置。在同一格裡拖曳，可以移動照片顯示的範圍。' }));
  else {
    el = group(root, 'col.sel', '選取的' + (it.vid ? '影片' : '照片') + '（第 ' + (C.sel + 1) + ' 格）', true);
    slider(el, { label: '放大', min: 100, max: 300, value: Math.round(it.zoom * 100), def: 100, fmt: v => v + '%', onInput: v => { it.zoom = v / 100; drawCollage(); } });
    el.append(h('div', { class: 'chips' },
      h('button', {
        class: 'btn', text: '換一張', onclick: async () => {
          const [f] = await pickFiles($('#fileCollage'));
          if (!f) return;
          const sel = C.sel;
          try {
            const nu = isCollageVideo(f) ? await collageVideoItem(f) : { cv: await fileToCanvas(f, 2400), ox: 0.5, oy: 0.5, zoom: 1 };
            if (nu.vid && !it.vid && C.imgs.filter(x => x.vid).length >= COLLAGE_VIDEO_MAX) { dropCollageVideo(nu); toast('一張拼圖最多放 ' + COLLAGE_VIDEO_MAX + ' 段影片'); return; }
            dropCollageVideo(it); C.imgs[sel] = nu; collagePanel(); drawCollage();
          } catch (e) { toast('無法讀取 ' + f.name); }
        }
      }),
      h('button', { class: 'btn danger', text: '移除', onclick: () => { dropCollageVideo(C.imgs[C.sel]); C.imgs.splice(C.sel, 1); C.sel = -1; C.layout = 0; collagePanel(); drawCollage(); } })));
  }
  el = root;
  el.append(h('button', {
    class: 'btn wide', text: '送到「修圖」繼續編輯',
    onclick: () => {
      const c = mk(4, 4);
      renderCollage(c, 1, true);
      setPhotoImage(c);
      setMode('photo');
      toast('拼圖已送到修圖');
    }
  }));
}
function initCollage() {
  $('#collageEmptyBtn').addEventListener('click', async () => addCollageFiles(await pickFiles($('#fileCollage'))));
  collagePanel();
}
function exportCollage() {
  if (!C.imgs.length) { toast('先加入圖片'); return; }
  if (collageHasVideo()) { exportCollageVideo(); return; }
  const c = mk(4, 4);
  renderCollage(c, +EXP.collage.side / COLLAGE_SIDE, true);
  saveCanvas(c, '拼圖作品', EXP.collage);
}

// 拼圖影片匯出：所有影片從頭一起播，照實際速度把拼好的畫面錄成 MP4。編碼器和剪輯共用
async function exportCollageVideo() {
  if (V.exporting) return;
  const vids = C.imgs.filter(it => it.vid), dur = collageVideoDur(), [w, hh] = collageVideoSize();
  const [W0, H0] = collageSize(), k = Math.max(w / W0, hh / H0);
  // 拼圖影片不含聲音：影片全部靜音，錄音的總音量也關掉（編碼器還是需要一條聲音軌）
  ensureAudio();
  if (V.audio) V.audio.master.gain.value = 0;
  for (const it of vids) it.vid.muted = true;
  C.exporting = true;
  V.exporting = true; V.cancelled = false; V.rec = null; V.enc = null;
  keepAwake(true);
  $('#exportBar').style.width = '0%';
  $('#exportTitle').textContent = '正在匯出拼圖影片';
  $('#exportOverlay').hidden = false;
  const work = mk(4, 4), out = mk(w, hh), ox = out.getContext('2d');
  const paint = () => { renderCollage(work, k, true); ox.drawImage(work, 0, 0); };
  const stopVids = () => { for (const it of vids) if (it.vid) { it.vid.pause(); it.vid.muted = true; } };
  const finish = () => { C.exporting = false; stopVids(); if (V.audio) V.audio.master.gain.value = 1; drawCollage(); };
  // 全部跳回開頭
  for (const it of vids) it.vid.pause();
  await Promise.all(vids.map(it => waitSeek(it.vid, 0)));
  const fps = 30, br = Math.min(40e6, Math.round(w * hh * fps * 0.12)), E = await makeMp4Encoder(w, hh, fps, br, true);
  if (!V.exporting) { if (E) closeEncoder(E); finish(); return; }
  paint();
  if (E) { E.name = '拼圖作品.mp4'; E.manual = true; V.enc = E; collageEncodeLoop(E, vids, dur, fps, out, paint, stopVids, finish); return; }
  let rec = null;
  const chunks = [];
  if (!window.MediaRecorder || !out.captureStream) { finish(); endExportUi(); toast('這個瀏覽器不支援影片匯出，請改用 Chrome 或 Edge', 4000); return; }
  const stream = out.captureStream(fps);
  const mime = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
  try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: br }); }
  catch (e) { finish(); endExportUi(); toast('無法開始錄製：' + e.message, 4000); return; }
  const ext = mime && mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  rec.onstop = () => {
    stream.getVideoTracks().forEach(t => t.stop());
    const cancelled = V.cancelled;
    finish(); endExportUi();
    if (cancelled) { toast('已取消匯出'); return; }
    saveFile('拼圖作品.' + ext, new Blob(chunks, { type: 'video/' + ext }));
  };
  V.rec = rec;
  for (const it of vids) it.vid.play().catch(() => {});
  for (let i = 0; i < 40 && vids.some(it => it.vid.paused || it.vid.currentTime === 0); i++) await new Promise(r => setTimeout(r, 50));
  if (!V.exporting || V.cancelled) { finish(); return; }
  const t0 = performance.now();
  rec.start(1000);
  const step = now => {
    if (!V.exporting || V.cancelled) { finish(); return; }
    const t = (now - t0) / 1000;
    paint();
    $('#exportBar').style.width = Math.min(100, t / dur * 100) + '%';
    if (t >= dur) { stopVids(); if (rec.state !== 'inactive') rec.stop(); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// 逐格錄製：每一格的時間照影片實際播到的位置算，不照時鐘。
// 手機畫不夠快時，把影片放慢播（例如半速），每一格都來得及畫；錄出來的影片還是正常速度，不會掉格
function collageEncodeLoop(E, vids, dur, fps, out, paint, stopVids, finish) {
  const total = Math.max(1, Math.round(dur * fps));
  const master = vids.reduce((a, b) => ((b.vid.duration || 0) > (a.vid.duration || 0) ? b : a)).vid;
  let idx = 0, rate = 1, avg = 1000 / 60, lastNow = 0, lastCT = 0, ended = false, held = false;
  const setRate = r => { rate = r; for (const it of vids) it.vid.playbackRate = r; if (r === 1) master.loop = true; };
  // 最長那段影片當時鐘：錄製期間不重複，播完就停在最後一格
  master.loop = false;
  // 影片真的換到下一格畫面時瀏覽器會通知（mediaTime 是這格畫面的時間），比 currentTime 準，不會抓到還沒換上的舊畫面
  let shown = -1;
  const rvfc = typeof master.requestVideoFrameCallback === 'function';
  if (rvfc) { const cb = (n, m) => { shown = Math.max(shown, m.mediaTime); if (V.exporting) master.requestVideoFrameCallback(cb); }; master.requestVideoFrameCallback(cb); }
  const playAll = () => { for (const it of vids) it.vid.play().catch(() => {}); };
  const done = () => {
    setRate(1); stopVids();
    finishEncode().then(finish);
  };
  E.on = true;
  // 一開始先用比較慢的速度，看手機跑得動再加快
  setRate(0.5);
  playAll();
  const step = now => {
    if (!V.exporting || V.cancelled) { setRate(1); finish(); return; }
    if (E.error) { setRate(1); stopVids(); finishEncode().then(finish); return; }
    if (lastNow) avg = avg * 0.85 + Math.min(500, now - lastNow) * 0.15;
    lastNow = now;
    // 編碼器跟不上：影片先一起暫停等它
    if (E.ve.encodeQueueSize > 6 || (held && E.ve.encodeQueueSize > 1)) {
      if (!held) { held = true; for (const it of vids) it.vid.pause(); }
      requestAnimationFrame(step); return;
    }
    if (held) { held = false; playAll(); }
    const ct = master.currentTime;
    if (ct + 0.5 < lastCT || master.ended) ended = true; else lastCT = Math.max(lastCT, ct);
    // 影片被系統停掉（例如切到別的畫面再回來）就再播一次
    if (!ended && master.paused) playAll();
    const T = ended ? dur : Math.min(dur, rvfc ? Math.max(shown, lastCT - 0.25) : lastCT);
    // 每畫一次大約推進多少影片時間；要讓它不超過一格，必要時放慢
    const want = Math.max(0.1, Math.min(1, (1000 / fps) / avg * 0.8));
    if (Math.abs(want - rate) > rate * 0.2) setRate(want);
    // 影片已經播到下一格的時間才畫，一次只送一格，所以不會有重複的停格
    if (idx / fps <= T + 0.001 || ended) {
      paint();
      const key = idx % (fps * 2) === 0;
      const frame = new VideoFrame(out, { timestamp: Math.round(idx * 1e6 / fps), duration: Math.round(1e6 / fps) });
      try { E.ve.encode(frame, { keyFrame: key }); } catch (e) { E.error = e; }
      frame.close();
      idx++;
      $('#exportBar').style.width = Math.min(100, idx / total * 100) + '%';
      if (idx >= total) { done(); return; }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
