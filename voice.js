// 手動剪輯的「錄音」和「虛擬人聲」：跟配樂一樣疊在影片上的聲音，可以有很多段，各自有開始時間和音量
const VO = { text: '', gender: 'f', lang: 'zh', busy: false, rec: null, sync: true, t0: 0, timer: 0, startAt: 0, masterWas: 1 };

// 把一段聲音加進影片。一律先解碼再轉成 WAV：麥克風錄下來的檔案常常沒有長度資訊，直接用會沒辦法跳到指定時間
async function addVoice(blob, name, kind, start, text) {
  const pcm = await decodeMono48k(blob), el = new Audio();
  el.preload = 'auto';
  el.src = URL.createObjectURL(pcmToWav(pcm, 48000));
  const v = { id: ++vid, kind, el, name, vol: 1, dur: pcm.length / 48000, start: clamp(start, 0, Math.max(0, totalDur() - 0.1)), text: text || '' };
  V.voices.push(v);
  V.sel = V.selText = null; V.selVoice = v.id;
  rebuildTL(); vPanel();
  return v;
}

function closeVoiceDialog() { $('#dlg').hidden = true; voiceDialogClosed(); }
// 視窗被關掉（包含點背景、按 Esc）：錄到一半的話直接放棄
function voiceDialogClosed() {
  if (!VO.rec) return;
  VO.rec.discard = true;
  VO.rec.stop();
}

// ── 錄音 ──
function openRecordDialog() {
  if (!V.clips.length) { toast('先加入影片或圖片'); return; }
  pause();
  renderRecordDialog();
  $('#dlg').hidden = false;
}
function renderRecordDialog() {
  const card = $('#dlgCard');
  card.style.maxWidth = '';
  card.replaceChildren();
  card.append(h('h2', { text: '加入錄音' }));
  if (VO.rec) {
    card.append(h('p', { class: 'rec-time', id: 'recTime', text: '錄音中　0:00.0' }));
    card.append(h('button', { class: 'btn primary wide big', text: '停止並加入影片', onclick: () => VO.rec.stop() }));
    card.append(h('button', { class: 'btn wide', text: '放棄這次錄音', onclick: closeVoiceDialog }));
    return;
  }
  card.append(h('p', { text: '錄好的聲音會從播放頭現在的位置（' + fmtTime(V.t) + '）開始，之後可以在時間軸上調整位置和音量。' }));
  card.append(h('button', { class: 'btn primary wide big', text: '用麥克風開始錄音', onclick: startVoiceRecording }));
  card.append(h('button', { class: 'btn wide', 'aria-pressed': String(VO.sync), text: VO.sync ? '錄音時同步播放影片：開' : '錄音時同步播放影片：關', onclick: () => { VO.sync = !VO.sync; renderRecordDialog(); } }));
  card.append(h('p', { text: '同步播放可以邊看畫面邊講。錄音期間影片會靜音，避免把喇叭的聲音錄進去。' }));
  card.append(h('button', {
    class: 'btn wide', text: '選已經錄好的聲音檔', onclick: async () => {
      const [f] = await pickFiles($('#fileAudio'));
      if (!f) return;
      try { await addVoice(f, f.name, 'rec', V.t); closeVoiceDialog(); toast('已加入錄音'); }
      catch (e) { toast('這個聲音檔讀不了，請換 mp3、m4a 或 wav'); }
    }
  }));
  card.append(h('div', { class: 'actions' }, h('button', { class: 'btn', text: '關閉', onclick: closeVoiceDialog })));
}
async function startVoiceRecording() {
  if (VO.rec) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { toast('這個瀏覽器不能錄音，請改用「選已經錄好的聲音檔」'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { toast('沒有取得麥克風的使用權限。請在瀏覽器網址列旁允許麥克風，或改選錄好的聲音檔。在 Claude 頁面裡不能錄音。', 7000); return; }
  const chunks = [], rec = new MediaRecorder(stream);
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    clearInterval(VO.timer);
    pause();
    if (V.audio) V.audio.master.gain.value = VO.masterWas;
    const discard = rec.discard, start = VO.startAt;
    VO.rec = null;
    if (discard) { seek(start); return; }
    try {
      const n = V.voices.filter(v => v.kind === 'rec').length + 1;
      await addVoice(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), '錄音 ' + n, 'rec', start);
      $('#dlg').hidden = true;
      seek(start);
      toast('已加入錄音，按播放聽聽看');
    } catch (e) { renderRecordDialog(); toast('錄音沒有成功，請再試一次'); }
  };
  VO.rec = rec; VO.startAt = V.t; VO.t0 = performance.now();
  rec.start();
  renderRecordDialog();
  VO.timer = setInterval(() => { const el = $('#recTime'); if (el) el.textContent = '錄音中　' + fmtTime((performance.now() - VO.t0) / 1000); }, 100);
  if (VO.sync) {
    // 邊播邊錄：影片的聲音先關掉，免得從喇叭出來又被麥克風錄進去
    ensureAudio();
    if (V.audio) { VO.masterWas = V.audio.master.gain.value; V.audio.master.gain.value = 0; }
    play();
  }
}

// ── 虛擬人聲：打字，用語音模型唸出來 ──
function openTtsDialog() {
  if (!V.clips.length) { toast('先加入影片或圖片'); return; }
  pause();
  renderTtsDialog();
  $('#dlg').hidden = false;
}
function renderTtsDialog() {
  const card = $('#dlgCard');
  card.style.maxWidth = '560px';
  card.replaceChildren();
  card.append(h('h2', { text: '加入虛擬人聲' }));
  const ta = h('textarea', { id: 'voText', rows: 4, maxlength: 600, placeholder: '輸入要唸出來的文字，例如：歡迎來到我的頻道，今天帶大家看新家的客廳。' });
  ta.value = VO.text;
  ta.addEventListener('input', () => { VO.text = ta.value; });
  card.append(h('label', { class: 'field', for: 'voText' }, '要唸的文字（最多 600 字）', ta));
  card.append(h('h3', { text: '聲音' }));
  chips(card, [['f', '女聲'], ['m', '男聲']], VO.gender, v => { VO.gender = v; renderTtsDialog(); });
  card.append(h('h3', { text: '語言' }));
  chips(card, AV_LANGS.map(l => [l[0], l[1]]), VO.lang, v => { VO.lang = v; renderTtsDialog(); });
  const voice = voiceFor(VO.lang, VO.gender), langName = AV_LANGS.find(l => l[0] === VO.lang)[1];
  if (!voice) card.append(h('p', { text: langName + '沒有能把文字直接唸出來的語音模型，請改用「加入錄音」自己唸。' }));
  else {
    if (voice.shift !== 1) card.append(h('p', { text: langName + '的' + (VO.gender === 'm' ? '男聲' : '女聲') + '是調整音調模擬出來的，會比較不自然。' }));
    if (VO.lang !== 'zh' && VO.lang !== 'en') card.append(h('p', { text: '請直接輸入' + langName + '，程式不會幫你翻譯。' }));
    card.append(h('p', { text: '唸出來的聲音會從播放頭現在的位置（' + fmtTime(V.t) + '）開始。' }));
  }
  card.append(h('div', { class: 'actions' },
    h('button', { class: 'btn', text: '關閉', onclick: closeVoiceDialog }),
    voice ? h('button', { class: 'btn primary', disabled: VO.busy, text: VO.busy ? '產生中…' : '產生並加入影片', onclick: addTtsVoice }) : null));
}
async function addTtsVoice() {
  const text = VO.text.trim();
  if (VO.busy) return;
  if (!text) { toast('先輸入要唸的文字'); return; }
  VO.busy = true; renderTtsDialog();
  try {
    const wav = await synthSpeech(text, VO.lang, VO.gender);
    aiStatus(null);
    const v = await addVoice(wav, text.replace(/\s+/g, ' ').slice(0, 12), 'tts', V.t, text);
    VO.busy = false;
    $('#dlg').hidden = true;
    seek(v.start);
    toast('已加入虛擬人聲（' + v.dur.toFixed(1) + ' 秒），按播放聽聽看');
  } catch (e) {
    aiStatus(null);
    VO.busy = false;
    renderTtsDialog();
    toast('語音無法產生：下載不到語音模型。請確認網路；在 Claude 頁面裡請改用獨立網址版本。', 6500);
  }
}
