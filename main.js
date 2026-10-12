// 模式切換與上方工具列
let MODE = 'photo';
const MODE_UI = {
  photo: { open: '開啟圖片', opts: [['jpg', 'JPG'], ['png', 'PNG']] },
  collage: { open: '加入圖片', opts: [['jpg', 'JPG'], ['png', 'PNG']] },
  video: { open: '加入素材', opts: [['720', '720p'], ['1080', '1080p']] }
};
function setMode(mode) {
  if (MODE === 'video' && mode !== 'video') pause();
  MODE = mode;
  $('#app').dataset.mode = mode;
  for (const id of ['photo', 'collage', 'video']) $('#' + id).hidden = id !== mode;
  $$('.modes button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  $('#undoBtn').hidden = $('#redoBtn').hidden = mode !== 'photo';
  $('#openBtn').textContent = MODE_UI[mode].open;
  $('#exportOpt').replaceChildren(...MODE_UI[mode].opts.map(([v, t]) => h('option', { value: v, text: t })));
  refit();
}
function refit() {
  if (MODE === 'photo') { fit(PV); syncCropBox(); }
  else if (MODE === 'collage') drawCollage();
  else { fit(VC); rebuildTL(); drawFrame(); }
}

async function openForMode(files) {
  if (MODE === 'photo') {
    const f = (files || await pickFiles($('#fileImg'))).find(x => x.type.startsWith('image/'));
    if (!f) return;
    try { setPhotoImage(await fileToCanvas(f, PHOTO_MAX), false); } catch (e) { toast('無法讀取 ' + f.name); }
  } else if (MODE === 'collage') addCollageFiles(files || await pickFiles($('#fileImgs')));
  else addMedia(files || await pickFiles($('#fileMedia')));
}

$$('.modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('#openBtn').addEventListener('click', () => openForMode());
$('#exportBtn').addEventListener('click', () => (MODE === 'photo' ? exportPhoto() : MODE === 'collage' ? exportCollage() : exportVideo()));
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);

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
  if (typing || V.exporting) return;
  const key = e.key.toLowerCase();
  if (MODE === 'photo') {
    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); redo(); }
    else if ((key === 'delete' || key === 'backspace') && P.sel) { e.preventDefault(); deleteSelected(); }
  } else if (MODE === 'video') {
    if (key === ' ' && tag !== 'BUTTON') { e.preventDefault(); V.playing ? pause() : play(); }
    else if (key === 'delete' && (V.sel || V.selText)) { e.preventDefault(); deleteVideoSelection(); }
  }
});

new ResizeObserver(refit).observe($('#app'));

initPhoto();
initCollage();
initVideo();
setMode('photo');
