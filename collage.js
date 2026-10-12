// 拼圖模式
const CV2 = $('#cv2');
const COLLAGE_SIDE = 2400;
const COLLAGE_MAX = 15;   // 一張拼圖最多幾張照片
const C = {
  imgs: [], layout: 0, gap: 2, radius: 2, bg: '#ffffff', ratio: '1:1', sel: -1
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
    ctx.drawImage(it.cv, r.x - (dw - r.w) * it.ox, r.y - (dh - r.h) * it.oy, dw, dh);
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
  $('#collageInfo').textContent = C.imgs.length
    ? C.imgs.length + ' 張照片　輸出 ' + w + ' × ' + hh + ' 像素'
    : '';
}

async function addCollageFiles(files) {
  const imgs = files.filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return;
  const before = C.imgs.length;
  for (const f of imgs) {
    if (C.imgs.length >= COLLAGE_MAX) { toast('一張拼圖最多放 ' + COLLAGE_MAX + ' 張圖'); break; }
    try { C.imgs.push({ cv: await fileToCanvas(f, 2400), ox: 0.5, oy: 0.5, zoom: 1 }); }
    catch (e) { toast('無法讀取 ' + f.name); }
  }
  if (C.imgs.length !== before) C.layout = 0;
  C.sel = -1;
  collagePanel(); drawCollage();
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
  CV2.setPointerCapture(e.pointerId);
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
  el.append(h('button', { class: 'btn primary wide', text: '加入圖片（最多 ' + COLLAGE_MAX + ' 張）', onclick: async () => addCollageFiles(await pickFiles($('#fileImgs'))) }));
  if (!C.imgs.length) { el.append(h('p', { text: '先選照片。選了幾張，這裡就會出現那個張數可以用的版型。' })); return; }

  el = group(root, 'col.layout', C.imgs.length + ' 張照片的版型');
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
  slider(el, { label: '間距', min: 0, max: 8, step: 0.5, value: C.gap, def: 2, onInput: v => { C.gap = v; drawCollage(); } });
  slider(el, { label: '圓角', min: 0, max: 12, step: 0.5, value: C.radius, def: 2, onInput: v => { C.radius = v; drawCollage(); } });
  el = group(root, 'col.bg', '底色');
  swatches(el, ['#ffffff', '#1a1a1a', '#f3e9dc', '#ffd9e4', '#d9f2ee'], C.bg, c => { C.bg = c; drawCollage(); });

  el = root;
  const it = C.imgs[C.sel];
  if (!it) el.append(h('p', { text: '按住照片拖到另一格，放開就會交換位置。在同一格裡拖曳，可以移動照片顯示的範圍。' }));
  else {
    el = group(root, 'col.sel', '選取的照片（第 ' + (C.sel + 1) + ' 格）', true);
    slider(el, { label: '放大', min: 100, max: 300, value: Math.round(it.zoom * 100), def: 100, fmt: v => v + '%', onInput: v => { it.zoom = v / 100; drawCollage(); } });
    el.append(h('div', { class: 'chips' },
      h('button', {
        class: 'btn', text: '換一張圖', onclick: async () => {
          const [f] = await pickFiles($('#fileImg'));
          if (!f) return;
          try { it.cv = await fileToCanvas(f, 2400); it.ox = it.oy = 0.5; it.zoom = 1; drawCollage(); } catch (e) { toast('無法讀取 ' + f.name); }
        }
      }),
      h('button', { class: 'btn danger', text: '移除', onclick: () => { C.imgs.splice(C.sel, 1); C.sel = -1; C.layout = 0; collagePanel(); drawCollage(); } })));
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
  $('#collageEmptyBtn').addEventListener('click', async () => addCollageFiles(await pickFiles($('#fileImgs'))));
  collagePanel();
}
function exportCollage() {
  if (!C.imgs.length) { toast('先加入圖片'); return; }
  const c = mk(4, 4);
  renderCollage(c, +EXP.collage.side / COLLAGE_SIDE, true);
  saveCanvas(c, '拼圖作品', EXP.collage);
}
