// 模式切換、上方工具列、匯出設定
let MODE = 'home';
const OPEN_LABEL = { photo: '開啟圖片', collage: '加入圖片', video: '加入素材' };

// 匯出設定會記在瀏覽器裡，下次打開沿用
const EXP = {
  photo: { fmt: 'jpg', q: 95, size: '0' },
  collage: { fmt: 'jpg', q: 95, side: '3600' },
  video: { res: '1080', fps: '30', br: 'high' }
};
try {
  const saved = JSON.parse(localStorage.getItem('exp') || '{}');
  for (const k in EXP) Object.assign(EXP[k], saved[k] || {});
} catch (e) { /* 沒有儲存空間就用預設值 */ }
function saveExp() {
  try { localStorage.setItem('exp', JSON.stringify(EXP)); } catch (e) { /* 略過 */ }
}

function setMode(mode) {
  if (MODE === 'video' && mode !== 'video') pause();
  MODE = mode;
  $('#app').dataset.mode = mode;
  for (const id of ['home', 'photo', 'collage', 'video']) $('#' + id).hidden = id !== mode;
  $('#barActions').hidden = mode === 'home';
  $$('.modes button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  $('#undoBtn').hidden = $('#redoBtn').hidden = mode === 'collage';
  $('#openBtn').textContent = OPEN_LABEL[mode] || '';
  syncHistButtons();
  refit();
}
function refit() {
  if (MODE === 'home') return;
  if (MODE === 'photo') { fit(PV); syncCropBox(); }
  else if (MODE === 'collage') drawCollage();
  else { fit(VC); rebuildTL(); drawFrame(); }
}

async function openForMode(files) {
  if (MODE === 'home') {
    // 在首頁拖進檔案：依檔案種類決定要進哪個模式
    if (!files) return;
    const imgs = files.filter(f => f.type.startsWith('image/'));
    const media = files.some(f => f.type.startsWith('video/') || f.type.startsWith('audio/'));
    if (!media && !imgs.length) { toast('這裡只能開圖片、影片或音樂檔'); return; }
    setMode(media ? 'video' : imgs.length > 1 ? 'collage' : 'photo');
  }
  if (MODE === 'photo') {
    const f = (files || await pickFiles($('#fileImg'))).find(x => x.type.startsWith('image/'));
    if (!f) return;
    try { setPhotoImage(await fileToCanvas(f, PHOTO_MAX), false); } catch (e) { toast('無法讀取 ' + f.name); }
  } else if (MODE === 'collage') addCollageFiles(files || await pickFiles($('#fileImgs')));
  else addMedia(files || await pickFiles($('#fileMedia')));
}

// ── 匯出視窗：格式、尺寸、畫質都在這裡選 ──
const PHOTO_SIZES = [['0', '原始大小'], ['1080', '長邊 1080'], ['1920', '長邊 1920'], ['2560', '長邊 2560'], ['3840', '長邊 3840（4K）'], ['x2', '放大 2 倍']];
function closeExportDialog() { $('#dlg').hidden = true; stopMusicPreview(); }
function openExportDialog() {
  const mode = MODE, e = EXP[mode], card = $('#dlgCard');
  if (mode === 'video' && totalDur() <= 0) { toast('先加入影片或圖片'); return; }
  if (mode === 'collage' && !C.imgs.length) { toast('先加入圖片'); return; }
  card.style.maxWidth = '';
  card.replaceChildren();
  const pick = (key, options) => chips(card, options, e[key], v => { e[key] = v; saveExp(); openExportDialog(); });
  card.append(h('h2', { text: mode === 'video' ? '匯出影片' : '匯出圖片' }));

  if (mode !== 'video') {
    card.append(h('h3', { text: '格式' }));
    pick('fmt', [['jpg', 'JPG'], ['png', 'PNG（不失真）'], ['webp', 'WebP']]);
    if (e.fmt !== 'png') slider(card, { label: '畫質', min: 50, max: 100, value: e.q, def: 95, fmt: v => v + '%', onInput: v => { e.q = v; }, onEnd: saveExp });
    card.append(h('h3', { text: '尺寸' }));
    if (mode === 'photo') {
      pick('size', PHOTO_SIZES);
      const [w, hh] = photoExportSize();
      card.append(h('p', { text: '輸出 ' + w + ' × ' + hh + ' 像素。放大不會多出原圖沒有的細節，但文字和貼圖會以新尺寸重畫，邊緣比較銳利。' }));
    } else {
      pick('side', [['2400', '標準 2400'], ['3600', '高 3600'], ['4800', '超高 4800']]);
      const k = +e.side / COLLAGE_SIDE, [w, hh] = collageSize().map(v => Math.round(v * k));
      card.append(h('p', { text: '輸出 ' + w + ' × ' + hh + ' 像素。' }));
    }
  } else {
    card.append(h('h3', { text: '解析度' }));
    pick('res', [['720', '720p'], ['1080', '1080p'], ['1440', '2K'], ['2160', '4K']]);
    card.append(h('h3', { text: '每秒格數' }));
    pick('fps', [['24', '24'], ['30', '30'], ['60', '60（更流暢）']]);
    card.append(h('h3', { text: '畫質' }));
    pick('br', [['std', '標準'], ['high', '高'], ['max', '最高']]);
    const [w, hh] = videoDims(+e.res), mbps = videoBitrate() / 1e6, mb = mbps * totalDur() / 8;
    card.append(h('p', { text: '輸出 ' + w + ' × ' + hh + '，約 ' + mbps.toFixed(1) + ' Mbps，檔案大約 ' + (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB。' }));
    card.append(h('p', { text: '影片會照實際速度錄一次，需要 ' + fmtTime(totalDur()) + '。4K 和 60 格比較吃效能，電腦跟不上時畫面會掉格，可以降一級再試。' }));
  }
  card.append(h('div', { class: 'actions' },
    h('button', { class: 'btn', text: '取消', onclick: closeExportDialog }),
    h('button', {
      class: 'btn primary', text: '開始匯出', onclick: () => {
        closeExportDialog();
        if (mode === 'photo') exportPhoto(); else if (mode === 'collage') exportCollage(); else exportVideo();
      }
    })));
  $('#dlg').hidden = false;
}
$('#dlg').addEventListener('pointerdown', e => { if (e.target.id === 'dlg') closeExportDialog(); });

$$('.modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('#homeBtn').addEventListener('click', () => setMode('home'));
$$('.home-card').forEach(b => b.addEventListener('click', () => setMode(b.dataset.go)));
function drawHomePreviews() {
  const cover = (id, src) => {
    const c = $(id), s = Math.max(c.width / src.width, c.height / src.height);
    c.getContext('2d').drawImage(src, (c.width - src.width * s) / 2, (c.height - src.height * s) / 2, src.width * s, src.height * s);
  };
  cover('#homePhoto', makeSample(0, 480, 300));
  // 首頁的拼圖示意圖：暫時放四張範例圖畫一次，不留在拼圖裡
  const col = mk(4, 4), keep = C.imgs;
  C.imgs = [0, 1, 2, 3].map(i => ({ cv: makeSample(i, 300, 300), ox: 0.5, oy: 0.5, zoom: 1 }));
  renderCollage(col, 0.2, true);
  C.imgs = keep;
  cover('#homeCollage', col);
  cover('#homeVideo', makeSample(2, 480, 300));
}
$('#openBtn').addEventListener('click', () => openForMode());
$('#exportBtn').addEventListener('click', openExportDialog);
$('#undoBtn').addEventListener('click', () => (MODE === 'video' ? vUndo() : undo()));
$('#redoBtn').addEventListener('click', () => (MODE === 'video' ? vRedo() : redo()));

// 剪輯模式：每次操作結束後檢查有沒有變動，有就記一步復原
for (const ev of ['pointerup', 'keyup', 'change']) {
  document.addEventListener(ev, () => { if (MODE === 'video' && !V.exporting) setTimeout(vCommit, 0); });
}

// 拖放檔案、貼上圖片
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
  if (files.length) openForMode(files);
});
window.addEventListener('paste', e => {
  const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => f.type.startsWith('image/'));
  if (files.length && MODE !== 'video') { e.preventDefault(); openForMode(files); }
});

window.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  const typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && e.target.type !== 'range');
  if (e.key === 'Escape') closeExportDialog();
  if (typing || V.exporting || !$('#dlg').hidden || MODE === 'home') return;
  const key = e.key.toLowerCase(), cmd = e.ctrlKey || e.metaKey, video = MODE === 'video';
  if (MODE !== 'collage' && cmd && key === 'z') { e.preventDefault(); e.shiftKey ? (video ? vRedo() : redo()) : (video ? vUndo() : undo()); }
  else if (MODE !== 'collage' && cmd && key === 'y') { e.preventDefault(); video ? vRedo() : redo(); }
  else if (MODE === 'photo' && (key === 'delete' || key === 'backspace') && P.sel) { e.preventDefault(); deleteSelected(); }
  else if (video && key === ' ' && tag !== 'BUTTON') { e.preventDefault(); V.playing ? pause() : play(); }
  else if (video && key === 'delete' && (V.sel || V.selText)) { e.preventDefault(); deleteVideoSelection(); }
});

new ResizeObserver(refit).observe($('#app'));

initPhoto();
initCollage();
initVideo();
drawHomePreviews();
setMode('home');
