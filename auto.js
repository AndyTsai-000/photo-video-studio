// 智能剪輯：使用者丟素材、選風格和比例，程式自動排出一支影片（結果放進「剪輯」，可以再微調或直接匯出）
// 這裡的「智能」是規則加分析：聽聲音挑影片裡最有內容的片段、抓配樂節拍來決定每段長度、
// 依風格套轉場／濾鏡／鏡頭推移。不是生成式 AI，不會憑空產生畫面。
const AUTO_STYLES = [
  ['vlog', '旅行 Vlog', '節奏適中，滑入與淡化交替，色調清新', { d: [2, 3], trans: ['slide', 'fade', 'push'], filter: 'fresh', kb: 'alt', vig: 0, anim: 'up' }],
  ['energetic', '活力快剪', '每段很短、切換快，顏色鮮豔，適合運動、派對', { d: [1.2, 2], trans: ['push', 'zoom', 'slide', 'wipe'], filter: 'vivid', kb: 'alt', vig: 0, anim: 'pop' }],
  ['warm', '溫馨回憶', '每段停留久一點，慢慢推近，暖色調，適合家庭、紀念', { d: [3, 4], trans: ['fade'], filter: 'warm', kb: 'alt', vig: 20, anim: 'fade' }],
  ['cinematic', '電影感', '膠片色調加暗角，淡化轉場，沉穩', { d: [2.8, 3.6], trans: ['fade', 'zoom'], filter: 'film', kb: 'in', vig: 45, anim: 'fade' }],
  ['clean', '簡潔', '不加濾鏡和轉場，只把素材乾淨地接起來', { d: [2.5, 3], trans: ['none'], filter: 'none', kb: 'none', vig: 0, anim: 'none' }]
];
const AU = {
  items: [], style: 'vlog', aspect: '9:16', length: 'auto', order: 'added',
  music: null, musicMeta: null, beat: true, title: '', ending: '', audio: 'low', captions: true, busy: false
};

function addAutoFiles(files) {
  let skipped = 0;
  for (const f of files) {
    if (f.type.startsWith('image/') || f.type.startsWith('video/')) AU.items.push({ file: f, url: URL.createObjectURL(f), kind: f.type.startsWith('video/') ? 'video' : 'image' });
    else if (f.type.startsWith('audio/')) { AU.music = f; AU.musicMeta = null; }
    else skipped++;
  }
  if (skipped) toast('有 ' + skipped + ' 個檔案不是圖片、影片或音樂，已略過');
  autoPanel();
}

// 把聲音切成每 hop 個取樣一格，算每一格的音量
function energyEnvelope(a, hop) {
  const n = Math.floor(a.length / hop), env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop, e = j + hop; j < e; j += 4) s += a[j] * a[j];
    env[i] = Math.sqrt(s / (hop / 4));
  }
  return env;
}
// 抓配樂的節拍：看音量突然變大的時間點，找出最常重複的間隔。回傳一拍幾秒，抓不到回傳 0
async function detectBeat(file) {
  const a = await decodeAudio16k(file);
  if (!a || a.length < 16000 * 4) return 0;
  const hop = 256, hopSec = hop / 16000, env = energyEnvelope(a.subarray(0, Math.min(a.length, 16000 * 60)), hop);
  const on = new Float32Array(env.length);
  for (let i = 1; i < env.length; i++) on[i] = Math.max(0, env[i] - env[i - 1]);
  let best = 0, bestScore = 0;
  const lo = Math.round(60 / 180 / hopSec), hi = Math.round(60 / 70 / hopSec);
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = lag; i < on.length; i++) s += on[i] * on[i - lag];
    if (s > bestScore) { bestScore = s; best = lag; }
  }
  return best ? best * hopSec : 0;
}
// 從一支影片裡挑 k 段長度 len 的片段：優先聲音比較有內容的地方，沒有聲音就取中間
async function pickSegments(c, len, k) {
  const D = c.srcDur;
  if (D <= len + 0.2) return [0];
  let env = null;
  try {
    if (c.file && c.file.size < 400e6) { const a = await decodeAudio16k(c.file); if (a) env = energyEnvelope(a, 4000); }
  } catch (e) { env = null; }
  const step = 0.25, nWin = Math.floor((D - len) / step) + 1, score = new Float32Array(nWin);
  let mx = 1e-6;
  if (env) for (let i = 0; i < env.length; i++) if (env[i] > mx) mx = env[i];
  for (let w = 0; w < nWin; w++) {
    const s = w * step, mid = (s + len / 2) / D;
    let e = 0, cnt = 0;
    if (env) for (let i = Math.floor(s / 0.25); i < Math.min(env.length, Math.ceil((s + len) / 0.25)); i++) { e += env[i]; cnt++; }
    // 稍微偏好中段（開頭結尾常是拿起、放下鏡頭的晃動）
    score[w] = (cnt ? e / cnt / mx : 0) + 0.2 * (1 - Math.abs(mid - 0.5) * 2);
  }
  const picked = [];
  for (let n = 0; n < k; n++) {
    let bi = -1, bs = -1;
    for (let w = 0; w < nWin; w++) {
      if (picked.some(p => Math.abs(p - w * step) < len)) continue;   // 不跟已經選的片段重疊
      if (score[w] > bs) { bs = score[w]; bi = w; }
    }
    if (bi < 0) break;
    picked.push(bi * step);
  }
  return picked.sort((p, q) => p - q);
}

async function runAutoEdit() {
  if (AU.busy) return;
  if (!AU.items.length) { toast('先加入照片或影片'); return; }
  AU.busy = true;
  autoPanel();
  const st = AUTO_STYLES.find(s => s[0] === AU.style)[3], sttWas = STT.auto, skipped = [];
  try {
    pause();
    if (V.music) V.music.el.pause();
    V.clips = []; V.texts = []; V.music = null; V.sel = V.selText = null; V.t = 0;
    V.aspect = AU.aspect;
    STT.auto = false;   // 字幕等片段挑好之後再處理，這裡先不要自動跑
    let items = AU.items.slice();
    if (AU.order === 'time') items.sort((a, b) => a.file.lastModified - b.file.lastModified);
    else if (AU.order === 'random') for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
    for (let i = 0; i < items.length; i++) {
      const f = items[i].file;
      aiStatus('正在讀取素材 ' + (i + 1) + ' / ' + items.length + '…', i / items.length * 0.5);
      try {
        if (items[i].kind === 'video') await addVideoFile(f);
        else { const cv = await fileToCanvas(f, 3840); V.clips.push(newClip('image', cv, f.name, 3, thumbOf(cv, cv.width, cv.height))); }
      } catch (e) { skipped.push(f.name); }
    }
    if (!V.clips.length) throw new Error('empty');

    let beat = 0;
    if (AU.music) {
      setMusicFile(AU.music, AU.musicMeta);
      V.music.fadeOut = true; V.music.vol = 0.7;
      if (AU.beat) {
        aiStatus('正在分析音樂節拍…', 0.55);
        try { beat = await detectBeat(AU.music); } catch (e) { beat = 0; }
      }
    }
    // 每一段的長度：指定總長就平均分，否則照風格；有節拍就對齊到拍子上
    const src = V.clips.slice(), n = src.length, T = AU.length === 'auto' ? 0 : +AU.length;
    const base = T ? clamp(T / n, 0.8, 6) : (st.d[0] + st.d[1]) / 2;
    const minBeat = beat ? beat * (beat < 0.45 ? 2 : 1) : 0;
    const snap = x => (beat ? Math.max(minBeat, Math.round(x / beat) * beat) : x);
    const perVideo = T && n * base < T * 0.8 ? 3 : 1;   // 素材少、目標長：同一支影片多取幾段
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = src[i], vary = T ? 0 : (i % 3 - 1) * (st.d[1] - st.d[0]) * 0.3;
      let len = snap(clamp(base + vary, 0.6, 8));
      if (c.kind === 'image') { c.out = len; out.push(c); continue; }
      aiStatus('正在挑選影片裡的精彩片段 ' + (i + 1) + ' / ' + n + '…', 0.6 + 0.35 * i / n);
      len = Math.min(len, c.srcDur);
      const starts = await pickSegments(c, len, Math.min(perVideo, Math.max(1, Math.floor(c.srcDur / (len * 1.5)))));
      starts.forEach((s0, j) => {
        const seg = j ? { ...c, id: ++vid, cap: { ...c.cap } } : c;
        seg.in = s0; seg.out = Math.min(c.srcDur, s0 + len);
        out.push(seg);
      });
    }
    // 指定了總長而素材太多：從後面拿掉，直到接近目標
    if (T) {
      let total = out.reduce((s, c) => s + clipDur(c), 0);
      while (out.length > 1 && total - clipDur(out[out.length - 1]) >= T - 0.3) total -= clipDur(out.pop());
    }
    const [ra, rb] = V_ASPECTS[AU.aspect];
    out.forEach((c, i) => {
      c.filter = st.filter; c.vig = st.vig;
      c.trans = i ? st.trans[(i - 1) % st.trans.length] : 'none';
      c.kb = st.kb === 'alt' ? (i % 2 ? 'out' : 'in') : st.kb;
      // 直式素材放進橫式畫面（或反過來）時用模糊背景補滿，不要把主體裁掉一大半
      const sw = c.kind === 'video' ? c.el.videoWidth : c.el.width, sh = c.kind === 'video' ? c.el.videoHeight : c.el.height;
      c.fit = ra !== rb && (sw >= sh) !== (ra >= rb) ? 'blur' : 'cover';
      c.vol = AU.audio === 'mute' ? 0 : AU.music && AU.audio === 'low' ? 0.25 : 1;
    });
    V.clips = out;
    const label = (c, text) => ({ id: ++vid, clip: c.id, at: c.kind === 'video' ? c.in : 0, dur: c.out - (c.kind === 'video' ? c.in : 0), text, pos: 'middle', size: 10, color: '#ffffff', anim: st.anim });
    if (AU.title.trim()) V.texts.push(label(out[0], AU.title.trim()));
    if (AU.ending.trim() && out.length > 1) V.texts.push(label(out[out.length - 1], AU.ending.trim()));

    STT.auto = sttWas;
    aiStatus(null);
    setMode('video');
    setVideoSize(); rebuildTL(); vPanel(); seek(0);
    vCommit();
    if (AU.captions) {
      STT.broken = false;
      const seen = new Set();
      for (const c of out) if (c.kind === 'video' && !seen.has(c.el)) { seen.add(c.el); queueCaptions(c); }
    }
    const total = totalDur();
    toast('剪好了：' + out.length + ' 段、共 ' + total.toFixed(1) + ' 秒' + (beat ? '，已對齊音樂節拍' : '') + (skipped.length ? '（有 ' + skipped.length + ' 個檔案讀不了，已略過）' : '') + '。按「播放」預覽，滿意就按「匯出」。', 7000);
  } catch (e) {
    STT.auto = sttWas;
    aiStatus(null);
    toast(e.message === 'empty' ? '這些檔案都讀不了，可能是瀏覽器不支援的格式。' : '剪輯時發生問題：' + (e.message || '未知原因'), 5000);
  }
  AU.busy = false;
  autoPanel();
}

function autoPanel() {
  const el = $('#autoInner');
  if (!el) return;
  el.replaceChildren();
  const card = (title, hint) => { const c = h('section', { class: 'auto-card' }, h('h2', { text: title }), hint ? h('p', { text: hint }) : null); el.append(c); return c; };
  el.append(h('h1', { text: 'AI 智能剪輯' }), h('p', { class: 'home-lead', text: '放進照片或影片，選好風格和比例，程式會自動挑片段、排順序、加轉場和配樂，剪成一支影片。' }));

  let c = card('1　素材', AU.items.length ? '已加入 ' + AU.items.length + ' 個。會照下面設定的順序排列。' : '照片、影片都可以，可以一次選很多個，也可以直接拖進來。');
  if (AU.items.length) {
    c.append(h('div', { class: 'auto-thumbs' }, AU.items.map((it, i) => {
      const media = it.kind === 'image' ? h('img', { src: it.url, alt: '' }) : h('video', { src: it.url + '#t=0.3', muted: true, preload: 'metadata', playsinline: true });
      return h('div', { class: 'auto-thumb', title: it.file.name }, media, it.kind === 'video' ? h('span', { text: '影片' }) : null,
        h('button', { 'aria-label': '移除 ' + it.file.name, text: '×', onclick: () => { URL.revokeObjectURL(it.url); AU.items.splice(i, 1); autoPanel(); } }));
    })));
  }
  c.append(h('button', { class: 'btn ' + (AU.items.length ? '' : 'primary ') + 'wide', text: AU.items.length ? '再加入照片或影片' : '加入照片或影片', onclick: async () => addAutoFiles(await pickFiles($('#fileMedia'))) }));

  c = card('2　風格');
  c.append(h('div', { class: 'auto-styles' }, AUTO_STYLES.map(([key, name, desc]) => h('button', {
    class: 'auto-style', 'aria-pressed': String(AU.style === key), onclick: () => { AU.style = key; autoPanel(); }
  }, h('strong', { text: name }), h('span', { text: desc })))));

  c = card('3　畫面比例與長度');
  c.append(h('h3', { text: '比例' }));
  chips(c, [['9:16', '直式 9:16（短影音）'], ['16:9', '橫式 16:9'], ['1:1', '方形 1:1'], ['4:5', '4:5']], AU.aspect, v => { AU.aspect = v; });
  c.append(h('h3', { text: '影片長度' }));
  chips(c, [['auto', '自動（照素材數量）'], ['15', '約 15 秒'], ['30', '約 30 秒'], ['60', '約 60 秒']], AU.length, v => { AU.length = v; });
  c.append(h('h3', { text: '素材順序' }));
  chips(c, [['added', '照加入的順序'], ['time', '照拍攝時間'], ['random', '隨機']], AU.order, v => { AU.order = v; });

  c = card('4　配樂與聲音', AU.music ? '配樂：' + ((AU.musicMeta && AU.musicMeta.title) || AU.music.name) : '不加也可以。加了配樂會自動在結尾淡出。');
  c.append(h('div', { class: 'chips' },
    h('button', { class: 'btn', text: '搜尋免費音樂或貼網址', onclick: () => openMusicDialog((file, meta) => { AU.music = file; AU.musicMeta = meta; autoPanel(); }) }),
    h('button', { class: 'btn', text: '從電腦選音樂', onclick: async () => { const [f] = await pickFiles($('#fileAudio')); if (f) { AU.music = f; AU.musicMeta = null; autoPanel(); } } }),
    AU.music ? h('button', { class: 'btn danger', text: '不要配樂', onclick: () => { AU.music = null; AU.musicMeta = null; autoPanel(); } }) : null));
  if (AU.music) c.append(h('button', { class: 'btn wide', 'aria-pressed': String(AU.beat), text: AU.beat ? '跟著音樂節拍切換畫面：開' : '跟著音樂節拍切換畫面：關', onclick: () => { AU.beat = !AU.beat; autoPanel(); } }));
  c.append(h('h3', { text: '影片原本的聲音' }));
  if (AU.music) chips(c, [['low', '調小聲（襯在配樂下）'], ['keep', '保留原音量'], ['mute', '靜音']], AU.audio, v => { AU.audio = v; });
  else chips(c, [['keep', '保留'], ['mute', '靜音']], AU.audio === 'mute' ? 'mute' : 'keep', v => { AU.audio = v; });

  c = card('5　文字', '影片裡有人說話時，會自動聽出來變成字幕。聽錯的字之後在「剪輯」點那句字幕就能改。');
  const field = (id, label, key, ph) => {
    const input = h('input', { type: 'text', id, placeholder: ph, maxlength: 40 });
    input.value = AU[key];
    input.addEventListener('input', () => { AU[key] = input.value; });
    c.append(h('label', { class: 'field', for: id }, label, input));
  };
  field('autoTitle', '片頭標題（可不填）', 'title', '例如：2026 花蓮三日遊');
  field('autoEnding', '片尾文字（可不填）', 'ending', '例如：謝謝觀看');
  c.append(h('button', { class: 'btn wide', 'aria-pressed': String(AU.captions), text: AU.captions ? '說話聲自動變成字幕：開' : '說話聲自動變成字幕：關', onclick: () => { AU.captions = !AU.captions; autoPanel(); } }));

  const go = h('section', { class: 'auto-card auto-go' });
  if (V.clips.length) go.append(h('p', { text: '「剪輯」裡目前有 ' + V.clips.length + ' 個片段，開始後會被這次的結果取代（之後可以在剪輯按「復原」找回來）。' }));
  go.append(h('button', { class: 'btn primary wide big', disabled: AU.busy || !AU.items.length, text: AU.busy ? '正在剪輯…' : '開始智能剪輯', onclick: runAutoEdit }));
  go.append(h('p', { text: '完成後會自動切到「剪輯」，可以先預覽、微調，再按「匯出」存成影片。' }));
  el.append(go);
}
