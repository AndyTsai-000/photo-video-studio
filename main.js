// 模式切換、上方工具列、匯出設定
let MODE = 'home';
const OPEN_LABEL = { photo: '開啟圖片', collage: '加入素材', video: '加入素材' };
const MODES = ['home', 'auto', 'avatar', 'photo', 'collage', 'video'];

// 匯出設定會記在瀏覽器裡，下次打開沿用
const EXP = {
  photo: { fmt: 'jpg', q: 95, size: '0' },
  collage: { fmt: 'jpg', q: 95, side: '3600' },
  video: { res: '1080', fps: '30', br: 'high', fmt: 'mp4', gif: '480' }
};
try {
  const saved = JSON.parse(localStorage.getItem('exp') || '{}');
  for (const k in EXP) Object.assign(EXP[k], saved[k] || {});
} catch (e) { /* 沒有儲存空間就用預設值 */ }
// 圖片匯出畫質只提供幾個常用等級；之前存過的其他數值對到最接近的一級
const QUALITY_PRESETS = [[70, '一般 70%'], [85, '高 85%'], [95, '極高 95%'], [100, '最高 100%']];
for (const k of ['photo', 'collage']) {
  EXP[k].q = QUALITY_PRESETS.map(p => p[0]).reduce((a, b) => (Math.abs(b - EXP[k].q) < Math.abs(a - EXP[k].q) ? b : a));
}
function saveExp() {
  try { localStorage.setItem('exp', JSON.stringify(EXP)); } catch (e) { /* 略過 */ }
}

function setMode(mode) {
  hideDoneBar();
  if (MODE === 'video' && mode !== 'video') pause();
  if (MODE === 'avatar' && mode !== 'avatar') { avatarStop(); if (AV.rec) AV.rec.stop(); }
  MODE = mode;
  $('#app').dataset.mode = mode;
  for (const id of MODES) $('#' + id).hidden = id !== mode;
  $('#barActions').hidden = mode === 'home' || mode === 'auto' || mode === 'avatar';
  if (mode === 'auto') autoPanel();
  if (mode === 'avatar') { syncAvatarEmpty(); avatarPanel(); }
  $$('.modes button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  $('#undoBtn').hidden = $('#redoBtn').hidden = mode === 'collage';
  $('#openBtn').textContent = OPEN_LABEL[mode] || '';
  syncHistButtons();
  syncLinkBtn();
  refit();
}
function refit() {
  if (MODE === 'home' || MODE === 'auto') return;
  if (MODE === 'avatar') { avatarRefresh(); return; }
  if (MODE === 'photo') { fit(PV, P.zoom); syncCropBox(); }
  else if (MODE === 'collage') drawCollage();
  else { fit(VC); rebuildTL(); drawFrame(); }
}

// 右邊工具列可以用箭頭收起來，讓畫面變大；各模式分開記
const PANEL_OFF = { photo: false, collage: false, video: false };
function setPanelOff(mode, off) {
  if (PANEL_OFF[mode] === off) return;
  PANEL_OFF[mode] = off;
  const sec = $('#' + mode), b = $('.panel-toggle', sec);
  sec.classList.toggle('panel-off', off);
  b.setAttribute('aria-expanded', String(!off));
  b.title = off ? '顯示工具列' : '隱藏工具列';
  if (MODE === mode) { refit(); if (mode === 'photo') requestRender(); }
}
async function openForMode(files) {
  if (MODE === 'auto') { if (files) addAutoFiles(files); return; }
  if (MODE === 'avatar') { const f = (files || []).find(x => x.type.startsWith('image/')); if (f) setAvatarPhoto(f); return; }
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
    try { setPhotoImage(await fileToCanvas(f, PHOTO_MAX)); } catch (e) { toast('無法讀取 ' + f.name); }
  } else if (MODE === 'collage') addCollageFiles(files || await pickFiles($('#fileCollage')));
  else addMedia(files || await pickFiles($('#fileMedia')));
}

// ── 匯出視窗：格式、尺寸、畫質都在這裡選 ──
const PHOTO_SIZES = [['0', '原始大小'], ['1080', '長邊 1080'], ['1920', '長邊 1920'], ['2560', '長邊 2560'], ['3840', '長邊 3840（4K）'], ['x2', '放大 2 倍']];
function closeExportDialog() { $('#dlg').hidden = true; stopMusicPreview(); voiceDialogClosed(); }
function openExportDialog() {
  const mode = MODE, e = EXP[mode], card = $('#dlgCard');
  if (mode === 'video' && totalDur() <= 0) { toast('先加入影片或圖片'); return; }
  if (mode === 'collage' && !C.imgs.length) { toast('先加入圖片'); return; }
  if (mode === 'photo' && !P.base) { toast('先開啟一張圖片'); return; }
  card.style.maxWidth = '';
  card.replaceChildren();
  const pick = (key, options) => chips(card, options, e[key], v => { e[key] = v; saveExp(); openExportDialog(); });
  const cVideo = mode === 'collage' && collageHasVideo();
  card.append(h('h2', { text: mode === 'video' || cVideo ? '匯出影片' : '匯出圖片' }));

  if (cVideo) {
    const [w, hh] = collageVideoSize(), sec = collageVideoDur();
    card.append(h('p', { text: '這張拼圖裡有影片，會匯出成 MP4 影片：' + w + ' × ' + hh + '，長度 ' + fmtTime(sec) + '（照最長的那段影片，短的會重複播）。' }));
    card.append(h('p', { text: '拼圖影片不含聲音。' }));
    card.append(h('p', { text: '影片會一格一格錄，大約需要 ' + fmtTime(sec) + '；手機比較慢時會放慢錄，花的時間會長一點，但錄出來不會卡。匯出期間請讓畫面開著。' }));
  } else if (mode !== 'video') {
    card.append(h('h3', { text: '格式' }));
    pick('fmt', [['jpg', 'JPG'], ['png', 'PNG（不失真）'], ['webp', 'WebP']]);
    if (e.fmt !== 'png') { card.append(h('h3', { text: '畫質' })); pick('q', QUALITY_PRESETS); }
    card.append(h('h3', { text: '尺寸' }));
    if (mode === 'photo') {
      pick('size', PHOTO_SIZES);
      const [w, hh] = photoExportSize();
      card.append(h('p', { text: '輸出 ' + w + ' × ' + hh + ' 像素。放大不會多出原圖沒有的細節，但文字和貼圖會以新尺寸重畫，邊緣比較銳利。' }));
      card.append(h('h3', { text: '內容' }));
      chips(card, [['off', '只有成品'], ['on', '前後對比圖']], PHOTO_CMP.on ? 'on' : 'off', v => { PHOTO_CMP.on = v === 'on'; openExportDialog(); });
      if (PHOTO_CMP.on) card.append(h('p', { text: '修圖前和修圖後會並排成一張圖，適合分享修圖成果。' }));
      card.append(h('button', { class: 'btn wide', text: '一次修很多張（把同樣的修圖套到其他照片）', onclick: () => { closeExportDialog(); batchExport(); } }));
    } else {
      pick('side', [['2400', '標準 2400'], ['3600', '高 3600'], ['4800', '超高 4800']]);
      const k = +e.side / COLLAGE_SIDE, [w, hh] = collageSize().map(v => Math.round(v * k));
      card.append(h('p', { text: '輸出 ' + w + ' × ' + hh + ' 像素。' }));
    }
  } else if (e.fmt === 'gif') {
    card.append(h('h3', { text: '格式' }));
    pick('fmt', [['mp4', 'MP4 影片'], ['gif', 'GIF 動圖']]);
    card.append(h('h3', { text: '大小' }));
    pick('gif', [['320', '小 320'], ['480', '中 480'], ['640', '大 640']]);
    const [w, hh] = gifDims(), sec = Math.min(GIF_MAX_SEC, totalDur());
    card.append(h('p', { text: '輸出 ' + w + ' × ' + hh + '，每秒 ' + GIF_FPS + ' 格，長度 ' + fmtTime(sec) + '。GIF 沒有聲音，會自動重複播放，適合做成貼圖或傳到聊天室。' }));
    if (totalDur() > GIF_MAX_SEC) card.append(h('p', { class: 'warn', text: 'GIF 檔案很大，只會做前 ' + GIF_MAX_SEC + ' 秒。想做別段，請先把影片剪到 ' + GIF_MAX_SEC + ' 秒以內。' }));
  } else {
    card.append(h('h3', { text: '格式' }));
    pick('fmt', [['mp4', 'MP4 影片'], ['gif', 'GIF 動圖']]);
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
// ── 匯出完成後的「接下來」：再做一件新作品、繼續修改這件，或回首頁 ──
// 新作品都是先選好檔案才清掉目前的內容；在選檔視窗按取消的話，什麼都不會變
const NEXT_WORK = {
  photo: ['再修一張', async () => { const [f] = await pickFiles($('#fileImg')); if (f) openForMode([f]); }],
  collage: ['再拼一張', async () => {
    const files = (await pickFiles($('#fileCollage'))).filter(f => f.type.startsWith('image/') || isCollageVideo(f));
    if (!files.length) return;
    collageReset();
    addCollageFiles(files);
  }],
  video: ['剪新影片', async () => {
    const files = await pickFiles($('#fileMedia'));
    if (!files.length) return;
    newVideoProject();
    addMedia(files);
  }],
  avatar: ['換照片再做一支', async () => { const [f] = await pickFiles($('#fileImg')); if (f) setAvatarPhoto(f); }]
};
let doneTimer = 0, doneWait = null;
function hideDoneBar() { clearTimeout(doneTimer); if (doneWait) { doneWait.disconnect(); doneWait = null; } $('#doneBar').hidden = true; }
// 剛匯出的檔案可以直接分享（傳 LINE、IG 等）：這時是使用者按按鈕，系統允許叫出分享選單
function shareLast() {
  const o = window.LAST_OUT;
  if (!o) return false;
  const file = new File([o.blob], o.name, { type: o.blob.type });
  try { if (!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }))) return false; } catch (e) { return false; }
  return file;
}
function showDoneBar() {
  const mode = MODE, next = NEXT_WORK[mode];
  if (!next) return;
  // 手機上匯出後會先跳出「存到相簿」的視窗：等那個視窗關掉再顯示，才不會被蓋住、時間到就消失
  if (!$('#dlg').hidden) {
    if (doneWait) doneWait.disconnect();
    doneWait = new MutationObserver(() => { if ($('#dlg').hidden) { doneWait.disconnect(); doneWait = null; if (MODE === mode) showDoneBar(); } });
    doneWait.observe($('#dlg'), { attributes: true, attributeFilter: ['hidden'] });
    return;
  }
  const o = window.LAST_OUT, isVideo = o && o.blob.type.startsWith('video/'), btns = [];
  const btn = (cls, text, fn, title) => btns.push(h('button', { class: 'btn ' + cls, text, title: title || '', onclick: () => { hideDoneBar(); fn(); } }));
  $('#doneText').textContent = isVideo ? '影片已匯出！' : o && o.blob.type === 'image/gif' ? 'GIF 動圖已匯出！' : '作品已匯出！';
  btn('primary', next[0], next[1]);
  if (mode === 'video') {
    if (typeof AU !== 'undefined' && AU.made && AU.items.length) btn('', '換個風格重剪', () => { setMode('auto'); toast('素材都還在，選好新的風格，再按「開始智能剪輯」', 5000); }, '用同樣的素材，換風格、比例或配樂再剪一支');
    if (isVideo) btn('', '另存 GIF 動圖', () => { const was = EXP.video.fmt; EXP.video.fmt = 'gif'; exportVideo(); EXP.video.fmt = was; }, '把影片前 15 秒做成會動的圖片');
    if (V.texts.some(t => t.auto) && isVideo) btn('', '匯出字幕檔', exportSrt, 'SRT 字幕檔，可以上傳到 YouTube');
  }
  if (mode === 'photo') btn('', '拿去拼圖', () => { const c = mk(4, 4); renderPhoto(c, 0, { final: true }); collageReset(); C.imgs = [{ cv: c, ox: 0.5, oy: 0.5, zoom: 1 }]; setMode('collage'); collagePanel(); drawCollage(); toast('再加幾張照片就能拼成一張'); }, '把修好的照片放進拼圖');
  if (shareLast()) btn('', '分享', async () => { try { await navigator.share({ files: [shareLast()] }); } catch (e) { /* 取消 */ } }, '傳到 LINE、Instagram 等 App');
  btn('', '繼續修改', () => {}, '留在這件作品，繼續編輯');
  btn('ghost', '回首頁', () => setMode('home'));
  $('#doneActions').replaceChildren(...btns);
  $('#doneBar').hidden = false;
  clearTimeout(doneTimer);
  doneTimer = setTimeout(hideDoneBar, 60000);
}
$('#doneClose').addEventListener('click', hideDoneBar);
$('#dlg').addEventListener('pointerdown', e => { if (e.target.id === 'dlg') closeExportDialog(); });

// 從首頁進修圖、拼圖、手動剪輯時，如果上次的作品還在，先問要接著做還是開新的
const WORK_NAME = { photo: '修圖', collage: '拼圖', video: '剪輯' };
function hasWork(mode) {
  return mode === 'photo' ? !!P.base : mode === 'collage' ? C.imgs.length > 0 : mode === 'video' ? V.clips.length > 0 : false;
}
function freshStart(mode) {
  if (mode === 'photo') { P.base = null; P.paint = null; P.objects = []; P.sel = null; P.link = null; P.hist = []; P.redo = []; syncPhotoEmpty(); }
  else if (mode === 'collage') { collageReset(); collagePanel(); drawCollage(); }
  else if (mode === 'video') newVideoProject();
}
function enterMode(mode) {
  if (MODE !== 'home' || !hasWork(mode)) { setMode(mode); return; }
  const card = $('#dlgCard'), go = fresh => { $('#dlg').hidden = true; if (fresh) freshStart(mode); setMode(mode); };
  card.style.maxWidth = '';
  card.replaceChildren(
    h('h2', { text: '上次的' + WORK_NAME[mode] + '還在' }),
    h('p', { text: '要接著做，還是開始一個新的？開新的會把上次的' + WORK_NAME[mode] + '清掉，還沒匯出的話請先選「接著做」匯出。' }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', text: '接著做', onclick: () => go(false) }),
      h('button', { class: 'btn primary', text: '開新的', onclick: () => go(true) })));
  $('#dlg').hidden = false;
}
$$('.modes button').forEach(b => b.addEventListener('click', () => enterMode(b.dataset.mode)));
$('#homeBtn').addEventListener('click', () => setMode('home'));
$$('.panel-toggle').forEach(b => b.addEventListener('click', () => { const m = b.closest('.mode').id; setPanelOff(m, !PANEL_OFF[m]); }));
$$('.home-card').forEach(b => b.addEventListener('click', () => enterMode(b.dataset.go)));
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
  // 智能剪輯的示意圖：幾張素材排成一條，像被剪在一起
  const strip = mk(480, 300), sx = strip.getContext('2d');
  sx.fillStyle = '#15131a'; sx.fillRect(0, 0, 480, 300);
  [3, 1, 0, 2].forEach((v, i) => { sx.save(); sx.translate(70 + i * 113, 150); sx.rotate((i - 1.5) * 0.07); sx.drawImage(makeSample(v, 150, 220), -75, -110); sx.restore(); });
  cover('#homeAuto', strip);
  // 虛擬人的示意圖：一個簡單的人像加上說話的聲波
  const av = mk(480, 300), ax = av.getContext('2d'), bgG = ax.createLinearGradient(0, 0, 480, 300);
  bgG.addColorStop(0, '#2b2a66'); bgG.addColorStop(1, '#7a4f9f');
  ax.fillStyle = bgG; ax.fillRect(0, 0, 480, 300);
  ax.fillStyle = '#f2c9a5'; ax.beginPath(); ax.arc(170, 135, 62, 0, Math.PI * 2); ax.fill();                      // 臉
  ax.fillStyle = '#3a2a4a'; ax.beginPath(); ax.arc(170, 112, 66, Math.PI, 0); ax.fill();                           // 頭髮
  ax.fillStyle = '#62d2c6'; ax.beginPath(); ax.ellipse(170, 300, 110, 95, 0, Math.PI, 0); ax.fill();               // 肩膀
  ax.fillStyle = '#2a1a30'; ax.beginPath(); ax.arc(148, 132, 6, 0, Math.PI * 2); ax.arc(192, 132, 6, 0, Math.PI * 2); ax.fill();
  ax.fillStyle = '#8a2a3a'; ax.beginPath(); ax.ellipse(170, 166, 15, 10, 0, 0, Math.PI * 2); ax.fill();             // 張開的嘴
  ax.strokeStyle = '#ffffff'; ax.lineCap = 'round'; ax.lineWidth = 7;
  [22, 46, 70, 38, 58, 26, 44].forEach((hgt, i) => { const x = 285 + i * 24; ax.globalAlpha = 0.9 - i * 0.07; ax.beginPath(); ax.moveTo(x, 150 - hgt / 2); ax.lineTo(x, 150 + hgt / 2); ax.stroke(); });
  ax.globalAlpha = 1;
  cover('#homeAvatar', av);
}
$('#openBtn').addEventListener('click', () => openForMode());
$('#exportBtn').addEventListener('click', openExportDialog);
$('#backToVideoBtn').addEventListener('click', updateVideoFromPhoto);
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
  if (files.length && MODE !== 'video' && MODE !== 'auto' && MODE !== 'avatar') { e.preventDefault(); openForMode(files); }
});

window.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  const typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && e.target.type !== 'range');
  if (e.key === 'Escape') closeExportDialog();
  if (typing || V.exporting || !$('#dlg').hidden || MODE === 'home' || MODE === 'auto' || MODE === 'avatar') return;
  const key = e.key.toLowerCase(), cmd = e.ctrlKey || e.metaKey, video = MODE === 'video';
  if (MODE !== 'collage' && cmd && key === 'z') { e.preventDefault(); e.shiftKey ? (video ? vRedo() : redo()) : (video ? vUndo() : undo()); }
  else if (MODE !== 'collage' && cmd && key === 'y') { e.preventDefault(); video ? vRedo() : redo(); }
  else if (MODE === 'photo' && (key === 'delete' || key === 'backspace') && P.sel) { e.preventDefault(); deleteSelected(); }
  else if (video && key === ' ' && tag !== 'BUTTON') { e.preventDefault(); V.playing ? pause() : play(); }
  else if (video && key === 'delete' && (V.sel || V.selText)) { e.preventDefault(); deleteVideoSelection(); }
});

new ResizeObserver(refit).observe($('#app'));

// 首頁最下面顯示版本；用 LINE 等內建瀏覽器開啟時提醒換瀏覽器
$('#verLine').textContent = '版本 ' + (window.APP_VERSION || '?');
if (inAppBrowser()) {
  // 還留在 LINE、Facebook 這類 App 內建的瀏覽器裡：每個畫面上方都提醒，並提供複製網址
  const app = inAppBrowser();
  $('#inAppBar').hidden = false;
  $('#inAppText').textContent = '你現在是用 ' + app + ' 內建的瀏覽器開啟，做好的圖片和影片存不下來。請點右上角的選單，選「用預設瀏覽器開啟」；或複製網址，貼到 Safari、Chrome。';
  $('#inAppCopy').addEventListener('click', () => {
    const link = location.origin + location.pathname;
    const done = () => toast('網址已複製，請打開 Safari 或 Chrome 貼上'), fail = () => toast('請手動複製：' + link, 8000);
    try { navigator.clipboard.writeText(link).then(done, fail); } catch (e) { fail(); }
  });
}
// 瀏覽器有時會留著舊的首頁檔，導致看到的還是舊版：開啟時向伺服器確認一次，有新版就自動重新載入
if (/github\.io$/.test(location.hostname)) {
  fetch(location.pathname + '?check=' + Date.now(), { cache: 'no-store' }).then(r => r.text()).then(html => {
    const m = /var VERSION = '(\d+)'/.exec(html);
    if (!m || m[1] === window.APP_VERSION) return;
    let tried = '';
    try { tried = sessionStorage.getItem('reloadedFor') || ''; sessionStorage.setItem('reloadedFor', m[1]); } catch (e) { tried = ''; }
    if (tried !== m[1]) location.replace(location.pathname + '?v=' + m[1]);
    else $('#verLine').textContent += '（有新版 ' + m[1] + '，請關掉這個分頁重新開啟）';
  }).catch(() => {});
}

initPhoto();
initCollage();
initVideo();
initAvatar();
loadMusicLib();
drawHomePreviews();
setMode('home');
