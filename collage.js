// 拼圖模式
const CV2 = $('#cv2');
const COLLAGE_SIDE = 2400;
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
  9: [R([3, 3, 3]), R([2, 3, 4]), K([2, 3, 4]), R([4, 5]), R([1, 4, 4]), K([1, 4, 4]), R([4, 1, 4], [1, 2, 1]), R([3, 3, 3], [2, 1, 1]), K([3, 3, 3], [2, 1, 1]), R([2, 2, 2, 3])]
};
function layoutList() {
  return LAYOUTS[clamp(C.imgs.length, 1, 9)];
}
function currentLayout() {
  const list = layoutList();
  return list[C.layout % list.length];
}
function collageSize() {
  const [a, b] = RATIOS[C.ratio], s = COLLAGE_SIDE / Math.max(a, b);
  return [Math.round(a * s), Math.round(b * s)];
}
function cellRects(W, H) {
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
    if (!final && i === C.sel) {
      ctx.save();
      ctx.lineWidth = Math.max(3, W / 200); ctx.strokeStyle = '#ff5d8f';
      roundRectPath(ctx, r.x, r.y, r.w, r.h, rad); ctx.stroke();
      ctx.restore();
    }
  });
}
function drawCollage() {
  // 還沒有照片時跟剪輯一樣只顯示引導，不畫空格子
  const empty = !C.imgs.length;
  $('#collageEmpty').hidden = !empty;
  CV2.parentElement.hidden = empty;
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
    if (C.imgs.length >= 9) { toast('一張拼圖最多放 9 張圖'); break; }
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
let cDrag = null;
CV2.addEventListener('pointerdown', e => {
  const hit = cellAt(e);
  if (hit.empty) { pickFiles($('#fileImgs')).then(addCollageFiles); return; }
  if (C.sel !== hit.i) { C.sel = hit.i; collagePanel(); }
  drawCollage();
  if (hit.i < 0) return;
  CV2.setPointerCapture(e.pointerId);
  cDrag = { ...hit, x: e.clientX, y: e.clientY, it: C.imgs[hit.i] };
});
CV2.addEventListener('pointermove', e => {
  if (!cDrag) return;
  const { it, rect, k } = cDrag, [dw, dh] = drawnSize(it, rect);
  const dx = (e.clientX - cDrag.x) * k, dy = (e.clientY - cDrag.y) * k;
  cDrag.x = e.clientX; cDrag.y = e.clientY;
  if (dw - rect.w > 0.5) it.ox = clamp(it.ox - dx / (dw - rect.w), 0, 1);
  if (dh - rect.h > 0.5) it.oy = clamp(it.oy - dy / (dh - rect.h), 0, 1);
  drawCollage();
});
['pointerup', 'pointercancel'].forEach(ev => CV2.addEventListener(ev, () => { cDrag = null; }));

function layoutIcon(rects) {
  const c = mk(40, 40), x = c.getContext('2d');
  x.fillStyle = '#a8a0b6';
  for (const [rx, ry, rw, rh] of rects) x.fillRect(rx * 40 + 1.5, ry * 40 + 1.5, rw * 40 - 3, rh * 40 - 3);
  return c;
}
function collagePanel() {
  const el = $('#collagePanel');
  el.replaceChildren();
  el.append(h('h2', { text: '拼圖' }));
  el.append(h('button', { class: 'btn primary wide', text: '加入圖片（最多 9 張）', onclick: async () => addCollageFiles(await pickFiles($('#fileImgs'))) }));
  if (!C.imgs.length) { el.append(h('p', { text: '先選照片。選了幾張，這裡就會出現那個張數可以用的版型。' })); return; }

  el.append(h('h3', { text: C.imgs.length + ' 張照片的版型' }));
  const lay = h('div', { class: 'layouts' });
  layoutList().forEach((rects, i) => {
    lay.append(h('button', { 'aria-pressed': String(i === C.layout), 'aria-label': '版型 ' + (i + 1), onclick: () => { C.layout = i; collagePanel(); drawCollage(); } }, layoutIcon(rects)));
  });
  el.append(lay);
  el.append(h('h3', { text: '畫布比例' }));
  chips(el, Object.keys(RATIOS).map(k => [k, k]), C.ratio, v => { C.ratio = v; drawCollage(); });
  slider(el, { label: '間距', min: 0, max: 8, step: 0.5, value: C.gap, def: 2, onInput: v => { C.gap = v; drawCollage(); } });
  slider(el, { label: '圓角', min: 0, max: 12, step: 0.5, value: C.radius, def: 2, onInput: v => { C.radius = v; drawCollage(); } });
  el.append(h('h3', { text: '底色' }));
  swatches(el, ['#ffffff', '#1a1a1a', '#f3e9dc', '#ffd9e4', '#d9f2ee'], C.bg, c => { C.bg = c; drawCollage(); });

  el.append(h('hr'));
  const it = C.imgs[C.sel];
  if (!it) el.append(h('p', { text: '點一格可以選取那張照片；按住拖曳可以調整照片在格子裡的位置。' }));
  else {
    el.append(h('h3', { text: '選取的照片（第 ' + (C.sel + 1) + ' 格）' }));
    slider(el, { label: '放大', min: 100, max: 300, value: Math.round(it.zoom * 100), def: 100, fmt: v => v + '%', onInput: v => { it.zoom = v / 100; drawCollage(); } });
    const swap = d => {
      const j = (C.sel + d + C.imgs.length) % C.imgs.length;
      [C.imgs[C.sel], C.imgs[j]] = [C.imgs[j], C.imgs[C.sel]];
      C.sel = j; collagePanel(); drawCollage();
    };
    el.append(h('div', { class: 'chips' },
      h('button', { class: 'btn', text: '換到前一格', onclick: () => swap(-1) }),
      h('button', { class: 'btn', text: '換到後一格', onclick: () => swap(1) }),
      h('button', {
        class: 'btn', text: '換一張圖', onclick: async () => {
          const [f] = await pickFiles($('#fileImg'));
          if (!f) return;
          try { it.cv = await fileToCanvas(f, 2400); it.ox = it.oy = 0.5; it.zoom = 1; drawCollage(); } catch (e) { toast('無法讀取 ' + f.name); }
        }
      }),
      h('button', { class: 'btn danger', text: '移除', onclick: () => { C.imgs.splice(C.sel, 1); C.sel = -1; C.layout = 0; collagePanel(); drawCollage(); } })));
  }
  el.append(h('hr'));
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
