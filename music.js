// 配樂：搜尋免費授權音樂、貼上音樂檔網址、或從電腦選檔
// 音樂庫用 Openverse（彙整 Freesound、維基共享資源），只找可自由使用並可改作的授權
const MUSIC_MOODS = [['upbeat', '輕快'], ['calm piano', '鋼琴'], ['acoustic guitar', '吉他'], ['lofi', 'Lo-fi'], ['cinematic', '電影感'], ['electronic', '電子'], ['jazz', '爵士'], ['ukulele happy', '可愛'], ['ambient', '氛圍'], ['rock', '搖滾']];
const MUSIC_LENGTHS = [['', '不限長度'], ['short,medium,long', '30 秒以上'], ['medium,long', '2 分鐘以上']];
const BLOCKED_HOSTS = /(^|\.)(youtube\.com|youtu\.be|spotify\.com|instagram\.com|tiktok\.com|music\.apple\.com|soundcloud\.com|kkbox\.com|facebook\.com|fb\.watch)$/;
const MS = { lib: [], q: '', len: 'short,medium,long', results: null, loading: false, err: '', preview: null, playing: '', urlMsg: '', busy: false };

function stopMusicPreview() {
  if (MS.preview) { MS.preview.pause(); MS.preview = null; }
  MS.playing = '';
}
function togglePreview(r) {
  const same = MS.playing === r.id;
  stopMusicPreview();
  if (!same) {
    MS.preview = new Audio(r.url);
    MS.playing = r.id;
    MS.preview.onended = () => { if (MS.playing === r.id) { MS.playing = ''; renderMusicDialog(); } };
    MS.preview.play().catch(() => { toast('這首無法試聽'); });
  }
  renderMusicDialog();
}

async function searchMusic(q) {
  q = q.trim();
  if (!q) return;
  stopMusicPreview();
  MS.q = q; MS.loading = true; MS.err = ''; MS.results = null;
  renderMusicDialog();
  try {
    const params = { q, source: 'wikimedia_audio,freesound', license: 'cc0,pdm,by,by-sa', page_size: '20' };
    if (MS.len) params.length = MS.len;
    const res = await fetch('https://api.openverse.org/v1/audio/?' + new URLSearchParams(params));
    if (res.status === 429) throw new Error('rate');
    if (!res.ok) throw new Error('http');
    const j = await res.json();
    MS.results = (j.results || []).filter(r => r.url).map(r => ({
      id: r.id, url: r.url, title: r.title || '未命名', creator: r.creator || '不詳', sec: Math.round((r.duration || 0) / 1000),
      license: (r.license === 'pdm' ? '公有領域' : r.license === 'cc0' ? 'CC0' : 'CC ' + String(r.license).toUpperCase()),
      needCredit: r.license !== 'cc0' && r.license !== 'pdm', credit: r.attribution || '', ext: r.filetype || 'mp3'
    }));
  } catch (e) {
    MS.err = e.message === 'rate' ? '搜尋太頻繁了，請等一分鐘再試。'
      : '連不上音樂庫。請確認網路；如果你是在 Claude 頁面裡使用，搜尋音樂要改用獨立網址版本。';
  }
  MS.loading = false;
  renderMusicDialog();
}

// ── 用過的音樂 ──
// 下載、選過的音樂留在這台裝置的瀏覽器裡（最多 12 首，最近用的排最前面），下次不用再找、再下載
function musicDb() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open('studio-music', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('tracks', { keyPath: 'title' });
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
}
async function loadMusicLib() {
  try {
    const db = await musicDb(), all = await new Promise((res, rej) => { const rq = db.transaction('tracks').objectStore('tracks').getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
    MS.lib = all.sort((a, b) => b.used - a.used).map(t => ({ title: t.title, credit: t.credit || '', file: new File([t.blob], t.name || t.title, { type: t.type || 'audio/mpeg' }) }));
    if (typeof vPanel === 'function' && MODE === 'video') vPanel();
  } catch (e) { /* 這個瀏覽器不能存，就只記在這次開啟的期間 */ }
}
async function rememberMusic(file, meta) {
  const title = (meta && meta.title) || file.name, credit = (meta && meta.credit) || '';
  MS.lib = [{ title, credit, file }].concat(MS.lib.filter(t => t.title !== title)).slice(0, 12);
  try {
    const db = await musicDb(), store = db.transaction('tracks', 'readwrite').objectStore('tracks');
    store.put({ title, credit, name: file.name, type: file.type, blob: file, used: Date.now() });
    const keep = new Set(MS.lib.map(t => t.title));
    store.getAllKeys().onsuccess = e => { for (const k of e.target.result) if (!keep.has(k)) store.delete(k); };
  } catch (e) { /* 存不了就算了 */ }
}
async function forgetMusic(title) {
  MS.lib = MS.lib.filter(t => t.title !== title);
  try { (await musicDb()).transaction('tracks', 'readwrite').objectStore('tracks').delete(title); } catch (e) { /* 略過 */ }
}
// 預設把選好的音樂放進剪輯；智能剪輯開啟這個視窗時會傳入自己的接收函式
let musicCb = null;
function finishMusic(file, meta) {
  rememberMusic(file, meta);
  if (musicCb) {
    const cb = musicCb;
    musicCb = null;
    stopMusicPreview();
    $('#dlg').hidden = true;
    cb(file, meta);
    return;
  }
  pause();
  setMusicFile(file, meta);
  stopMusicPreview();
  $('#dlg').hidden = true;
  rebuildTL(); vPanel();
}
async function useTrack(r) {
  if (MS.busy) return;
  MS.busy = true;
  stopMusicPreview();
  toast('正在下載「' + r.title + '」…', 8000);
  try {
    const res = await fetch(r.url);
    if (!res.ok) throw new Error('http');
    const blob = await res.blob();
    finishMusic(new File([blob], r.title + '.' + r.ext, { type: blob.type || 'audio/mpeg' }), { title: r.title + '（' + r.creator + '）', credit: r.needCredit ? r.credit : '' });
    toast(r.needCredit ? '已加入配樂。公開發表時記得標示作者，面板裡可以複製標示文字。' : '已加入配樂', 4500);
  } catch (e) { toast('下載失敗，換一首試試'); }
  MS.busy = false;
}
async function loadMusicUrl(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch (e) { MS.urlMsg = '這不是完整的網址，要以 https:// 開頭。'; renderMusicDialog(); return; }
  if (BLOCKED_HOSTS.test(u.hostname)) {
    MS.urlMsg = 'YouTube、Spotify、Instagram 這類平台不開放把音樂取出來，而且上面的音樂大多有版權，放進影片公開發表可能被下架。請改用上面的搜尋，或用你自己有權使用的音樂檔。';
    renderMusicDialog(); return;
  }
  MS.urlMsg = '正在載入…';
  renderMusicDialog();
  try {
    const res = await fetch(u.href);
    if (!res.ok) throw new Error('http');
    const blob = await res.blob();
    const looksAudio = /^(audio|video)\//.test(blob.type) || /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|webm|mp4)$/i.test(u.pathname);
    if (!looksAudio) throw new Error('type');
    const name = decodeURIComponent(u.pathname.split('/').pop() || '網路音樂');
    MS.urlMsg = '';
    finishMusic(new File([blob], name, { type: blob.type || 'audio/mpeg' }), { title: name, credit: '' });
    toast('已加入配樂');
  } catch (e) {
    MS.urlMsg = e.message === 'type' ? '這個網址不是音樂檔（可能是網頁）。請貼上 .mp3、.m4a、.wav 這類檔案的直接網址。'
      : '無法取得這個網址的音樂：對方網站不允許其他網頁直接讀取，或網址已失效。請先把檔案下載到電腦，再按「從電腦選檔」。';
    renderMusicDialog();
  }
}

function openMusicDialog(cb) {
  musicCb = typeof cb === 'function' ? cb : null;
  MS.urlMsg = '';
  renderMusicDialog();
  $('#dlg').hidden = false;
  if (MS.results == null && !MS.loading && !MS.err) searchMusic('upbeat');
}
function renderMusicDialog() {
  const card = $('#dlgCard');
  card.style.maxWidth = '580px';
  card.replaceChildren();
  card.append(h('h2', { text: '加入配樂' }));

  if (MS.lib.length) {
    card.append(h('h3', { text: '用過的音樂（點「使用」直接套用，不用再下載）' }));
    card.append(h('div', { class: 'music-list lib' }, MS.lib.map(t => h('div', { class: 'music-row' },
      h('button', { class: 'btn small', title: '從清單移除', 'aria-label': '移除 ' + t.title, text: '×', onclick: async () => { await forgetMusic(t.title); renderMusicDialog(); } }),
      h('div', { class: 'music-meta' }, h('strong', { text: t.title }), h('span', { text: t.credit ? '需標示作者' : '已存在這台裝置' })),
      h('button', { class: 'btn small primary', text: '使用', onclick: () => { finishMusic(t.file, { title: t.title, credit: t.credit }); toast('已套用「' + t.title + '」'); } })))));
  }
  card.append(h('h3', { text: '搜尋免費音樂' }));
  const input = h('input', { type: 'text', id: 'musicQuery', placeholder: '英文關鍵字，例如 piano、travel、happy', 'aria-label': '搜尋音樂' });
  input.value = MS.q;
  const form = h('form', { class: 'music-form' }, input, h('button', { class: 'btn primary', type: 'submit', text: '搜尋' }));
  form.addEventListener('submit', e => { e.preventDefault(); searchMusic(input.value); });
  card.append(form);
  card.append(h('div', { class: 'chips' }, MUSIC_MOODS.map(([q, label]) => h('button', { class: 'btn', 'aria-pressed': String(MS.q === q), text: label, onclick: () => searchMusic(q) }))));
  chips(card, MUSIC_LENGTHS, MS.len, v => { MS.len = v; if (MS.q) searchMusic(MS.q); });

  const list = h('div', { class: 'music-list' });
  if (MS.loading) list.append(h('p', { text: '搜尋中…' }));
  else if (MS.err) list.append(h('p', { text: MS.err }));
  else if (MS.results && !MS.results.length) list.append(h('p', { text: '找不到符合的音樂。這個音樂庫是用英文標示的，請改用英文關鍵字，或點上面的分類。' }));
  else for (const r of MS.results || []) {
    list.append(h('div', { class: 'music-row' },
      h('button', { class: 'btn small', 'aria-pressed': String(MS.playing === r.id), text: MS.playing === r.id ? '停止' : '試聽', onclick: () => togglePreview(r) }),
      h('div', { class: 'music-meta' }, h('strong', { text: r.title }), h('span', { text: r.creator + '　' + fmtTime(r.sec).replace(/\.0$/, '') + '　' + r.license + (r.needCredit ? '（需標示作者）' : '') })),
      h('button', { class: 'btn small primary', text: '使用', onclick: () => useTrack(r) })));
  }
  card.append(list);
  card.append(h('p', { text: '這些都是創作者開放免費使用的音樂（可商用、可剪輯），不是 Instagram 上的流行歌。' }));

  card.append(h('h3', { text: '貼上音樂檔網址' }));
  const urlInput = h('input', { type: 'text', id: 'musicUrl', placeholder: 'https://…/song.mp3', 'aria-label': '音樂檔網址' });
  const urlForm = h('form', { class: 'music-form' }, urlInput, h('button', { class: 'btn', type: 'submit', text: '載入' }));
  urlForm.addEventListener('submit', e => { e.preventDefault(); if (urlInput.value.trim()) loadMusicUrl(urlInput.value); });
  card.append(urlForm);
  if (MS.urlMsg) card.append(h('p', { text: MS.urlMsg }));

  card.append(h('div', { class: 'actions' },
    h('button', {
      class: 'btn', text: '從電腦選檔', onclick: async () => {
        const [f] = await pickFiles($('#fileAudio'));
        if (f) { finishMusic(f, null); toast('已加入配樂'); }
      }
    }),
    h('button', { class: 'btn', text: '關閉', onclick: () => { stopMusicPreview(); $('#dlg').hidden = true; } })));
}
