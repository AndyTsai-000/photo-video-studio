// 臉部網格：把照片貼在一張由臉部定位點組成的三角網格上，移動網格的頂點就能讓臉做出動作。
// 頭的轉動用定位點的深度做 3D 旋轉，所以鼻子、臉頰移動的幅度不一樣，看起來是真的在轉頭；
// 臉以外用幾圈逐漸不動的控制點接到畫面邊緣，頭髮跟著頭動、肩膀和背景留在原地。
const RIG = {
  oval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
  upOut: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291], loOut: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
  upIn: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308], loIn: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308],
  // 眼皮：上眼瞼、它上面那一排、對應的下眼瞼（順序一一對應）
  eyes: [
    { up: [246, 161, 160, 159, 158, 157, 173], up2: [247, 30, 29, 27, 28, 56, 190], lo: [7, 163, 144, 145, 153, 154, 155] },
    { up: [398, 384, 385, 386, 387, 388, 466], up2: [414, 286, 258, 257, 259, 260, 467], lo: [382, 381, 380, 374, 373, 390, 249] }
  ],
  brows: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46, 300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
  // 眼睛的開口：上緣和下緣（含兩個眼角），順序一一對應
  eyeHoles: [[[33, 246, 161, 160, 159, 158, 157, 173, 133], [33, 7, 163, 144, 145, 153, 154, 155, 133]], [[362, 398, 384, 385, 386, 387, 388, 466, 263], [362, 382, 381, 380, 374, 373, 390, 249, 263]]],
  rings: [[1.14, 0.96], [1.38, 0.72], [1.75, 0.36], [2.3, 0]]   // [離臉中心的倍數, 跟著頭動的比例]，由內到外漸漸不動
};
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('script')); document.head.append(s); });
}
// 建立網格與 WebGL 繪圖環境；瀏覽器不支援時回傳 null（外面會退回舊的做法）
async function buildRig(img, lm, conns) {
  if (!window.Delaunator) await loadScript('https://cdn.jsdelivr.net/npm/delaunator@5.0.1/delaunator.min.js');
  const W = img.width, H = img.height, NF = 468, P = [];
  for (let i = 0; i < NF; i++) P.push({ x: lm[i].x * W, y: lm[i].y * H, z: lm[i].z * W, src: -1, w: 1 });
  let cx = 0, cy = 0, cz = 0;
  for (const i of RIG.oval) { cx += P[i].x; cy += P[i].y; }
  cx /= RIG.oval.length; cy /= RIG.oval.length;
  for (let i = 0; i < NF; i++) cz += P[i].z;
  cz /= NF;
  // 臉外面的幾圈控制點
  for (const [scale, w] of RIG.rings) for (const i of RIG.oval) {
    const x = cx + (P[i].x - cx) * scale, y = cy + (P[i].y - cy) * scale, inside = x > 1 && y > 1 && x < W - 1 && y < H - 1;
    P.push({ x: clamp(x, 0, W), y: clamp(y, 0, H), z: 0, src: i, w: inside ? w : 0 });
  }
  // 畫面四邊固定不動的點
  const nx = 8, ny = Math.max(4, Math.round(8 * H / W));
  for (let i = 0; i <= nx; i++) { P.push({ x: W * i / nx, y: 0, z: 0, src: -2, w: 0 }, { x: W * i / nx, y: H, z: 0, src: -2, w: 0 }); }
  for (let j = 1; j < ny; j++) { P.push({ x: 0, y: H * j / ny, z: 0, src: -2, w: 0 }, { x: W, y: H * j / ny, z: 0, src: -2, w: 0 }); }

  const line = ids => ids.map(i => P[i]).sort((a, b) => a.x - b.x);
  const loLine = line(RIG.loIn), xL = loLine[0].x, xR = loLine[loLine.length - 1].x, mw = xR - xL, chinY = P[152].y;
  const lipMid = (P[13].y + P[14].y) / 2, gap = Math.abs(P[14].y - P[13].y);
  const closed = gap < mw * 0.07;   // 照片裡嘴巴是閉著的：張開時要自己畫出口腔
  const inner = new Set([...RIG.upIn, ...RIG.loIn]);

  // 臉的部分用臉部模型本身定義的連接方式（每三條連線圍成一個三角形）。
  // 不能靠頂點的位置自動連：嘴巴閉著時上下唇的點在畫面上幾乎重疊，自動連會出現橫跨上下唇的三角形，
  // 一張嘴就把嘴唇的皮膚拉成一條一條的。模型的連接方式知道哪些點是上唇、哪些是下唇
  const tri = [];
  if (conns && conns.length % 3 === 0) {
    for (let k = 0; k + 2 < conns.length; k += 3) {
      const a = conns[k], b = conns[k + 1], c = conns[k + 2];
      if (a.end !== b.start || b.end !== c.start || c.end !== a.start) { tri.length = 0; break; }
      if (!(inner.has(a.start) && inner.has(b.start) && inner.has(c.start))) tri.push(a.start, b.start, c.start);
    }
  }
  if (!tri.length) return null;
  // 模型的網格在眼睛的位置是空的，用上下眼瞼之間的一排三角形補起來（眨眼時這一排會被壓扁）
  for (const [up, lo] of RIG.eyeHoles) for (let k = 0; k < up.length - 1; k++) tri.push(up[k], up[k + 1], lo[k], up[k + 1], lo[k + 1], lo[k]);
  // 臉以外（頭髮、脖子、背景）沒有重疊的問題，照位置自動連；全部頂點都在臉部輪廓上的三角形是臉的內部，不要
  const outerIdx = RIG.oval.slice();
  for (let k = NF; k < P.length; k++) outerIdx.push(k);
  const ovalSet = new Set(RIG.oval), od = window.Delaunator.from(outerIdx, k => P[k].x, k => P[k].y).triangles;
  for (let k = 0; k < od.length; k += 3) {
    const a = outerIdx[od[k]], b = outerIdx[od[k + 1]], c = outerIdx[od[k + 2]];
    if (!(ovalSet.has(a) && ovalSet.has(b) && ovalSet.has(c))) tri.push(a, b, c);
  }
  const seamUp = [], seamLo = [];
  for (let k = 0; k < RIG.upIn.length; k++) {
    const u = P[RIG.upIn[k]], l = P[RIG.loIn[k]], mid = { x: (u.x + l.x) / 2, y: (u.y + l.y) / 2 };
    seamUp.push(P.length); P.push({ x: mid.x, y: mid.y, z: u.z, src: RIG.upIn[k], w: 1 });
    seamLo.push(P.length); P.push({ x: mid.x, y: mid.y, z: l.z, src: RIG.loIn[k], w: 1 });
  }
  for (let k = 0; k < RIG.upIn.length - 1; k++) {
    tri.push(RIG.upIn[k], RIG.upIn[k + 1], seamUp[k], RIG.upIn[k + 1], seamUp[k + 1], seamUp[k]);
    tri.push(seamLo[k], seamLo[k + 1], RIG.loIn[k], seamLo[k + 1], RIG.loIn[k + 1], RIG.loIn[k]);
  }
  const N = P.length;

  // 每個頂點受各種動作影響的程度，建立時算好
  const wJaw = new Float32Array(N), wUp = new Float32Array(N), wCL = new Float32Array(N), wCR = new Float32Array(N), wBrow = new Float32Array(N), wCheek = new Float32Array(N);
  const lowerLip = new Set([...RIG.loOut, ...RIG.loIn]), upperLip = new Set([...RIG.upOut, ...RIG.upIn]);
  const prof = x => { const u = (x - xL) / mw; return u > 0 && u < 1 ? Math.pow(Math.sin(Math.PI * u), 0.75) : 0; };
  for (let i = 0; i < NF; i++) {
    const p = P[i], ly = lineY(loLine, p.x), u = (p.x - xL) / mw;
    if (lowerLip.has(i)) wJaw[i] = prof(p.x);
    else if (!upperLip.has(i) && p.y > ly + 1) {
      // 下唇以下：越往下巴底部動得越少，越往兩側也越少
      const D = Math.max(12, (chinY - ly) * 1.5), q = clamp((p.y - ly) / D, 0, 1), g = (1 - q) * (1 - q) * (1 + 2 * q);
      const side = u < 0 ? -u : u > 1 ? u - 1 : 0, jaw = side >= 0.6 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * side / 0.6), m = Math.min(1, q / 0.3);
      wJaw[i] = g * (prof(p.x) + (jaw - prof(p.x)) * m);
    }
    if (upperLip.has(i)) wUp[i] = prof(p.x);
    const dl = Math.hypot(p.x - P[61].x, p.y - P[61].y) / mw, dr = Math.hypot(p.x - P[291].x, p.y - P[291].y) / mw;
    wCL[i] = Math.exp(-dl * dl / 0.05); wCR[i] = Math.exp(-dr * dr / 0.05);
    wCheek[i] = Math.exp(-dl * dl / 0.35) + Math.exp(-dr * dr / 0.35);
  }
  // 眉毛和它周圍一小圈（額頭下緣跟著被帶動）
  for (let i = 0; i < NF; i++) {
    let best = 1e9;
    for (const b of RIG.brows) best = Math.min(best, Math.hypot(P[i].x - P[b].x, P[i].y - P[b].y));
    const aboveEye = P[i].y < Math.min(P[159].y, P[386].y);
    wBrow[i] = aboveEye ? Math.exp(-(best / (mw * 0.45)) * (best / (mw * 0.45))) : 0;
  }
  for (const b of RIG.brows) wBrow[b] = 1;

  // WebGL
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const gl = cv.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: true });
  if (!gl) return null;
  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, 'attribute vec2 a_pos; attribute vec2 a_uv; varying vec2 v_uv; void main() { v_uv = a_uv; gl_Position = vec4(a_pos, 0.0, 1.0); }'));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, 'precision mediump float; varying vec2 v_uv; uniform sampler2D u_tex; uniform vec4 u_color; void main() { gl_FragColor = u_color.a > 0.0 ? u_color : texture2D(u_tex, v_uv); }'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const uv = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { uv[i * 2] = P[i].x / W; uv[i * 2 + 1] = P[i].y / H; }
  const uvBuf = gl.createBuffer(), posBuf = gl.createBuffer(), idxBuf = gl.createBuffer(), extraBuf = gl.createBuffer();
  const aPos = gl.getAttribLocation(prog, 'a_pos'), aUv = gl.getAttribLocation(prog, 'a_uv');
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(tri), gl.STATIC_DRAW);
  gl.viewport(0, 0, W, H);
  return {
    W, H, P, N, NF, tri, cx, cy, cz, mw, chinY, lipMid, closed, size: Math.abs(P[454].x - P[234].x),
    wJaw, wUp, wCL, wCR, wBrow, wCheek, pos: new Float32Array(N * 2), cur: new Float32Array(N * 2),
    seamUp, seamLo, cv, gl, prog, posBuf, uvBuf, idxBuf, extraBuf, aPos, aUv, uColor: gl.getUniformLocation(prog, 'u_color'), nTri: tri.length
  };
}
// 依姿勢算出每個頂點的位置並畫出來，回傳畫好的畫布。
// pose：jaw 下巴張開的像素、wide 嘴角往外(+)或往內(-)、smile 微笑、brow 挑眉、blink 眨眼（都是 0..1 左右），
//       yaw / pitch / roll 轉頭、點頭、歪頭的角度，tx / ty 整顆頭的平移
function rigRender(r, pose) {
  const { P, N, NF, cur, mw } = r, rad = Math.PI / 180;
  const cyw = Math.cos(pose.yaw * rad), syw = Math.sin(pose.yaw * rad), cp = Math.cos(pose.pitch * rad), sp = Math.sin(pose.pitch * rad), cr = Math.cos(pose.roll * rad), sr = Math.sin(pose.roll * rad);
  for (let i = 0; i < NF; i++) {
    const p = P[i];
    let x = p.x, y = p.y;
    y += pose.jaw * r.wJaw[i] - pose.jaw * 0.14 * r.wUp[i];
    x += (r.wCR[i] - r.wCL[i]) * (pose.wide * mw * 0.07 + pose.smile * mw * 0.05);
    y -= (r.wCR[i] + r.wCL[i]) * pose.smile * mw * 0.07 + r.wCheek[i] * pose.smile * mw * 0.018;
    y -= r.wBrow[i] * pose.brow * r.size * 0.03;
    cur[i * 2] = x; cur[i * 2 + 1] = y;
  }
  // 眨眼：上眼瞼往下眼瞼靠，上面那一排跟著動一半
  if (pose.blink > 0.01) {
    for (const e of RIG.eyes) for (let k = 0; k < e.up.length; k++) {
      const u = e.up[k], u2 = e.up2[k], lo = e.lo[k], dy = (cur[lo * 2 + 1] - cur[u * 2 + 1]) * pose.blink * 0.96;
      cur[u * 2 + 1] += dy; cur[u2 * 2 + 1] += dy * 0.5;
    }
  }
  // 整顆頭的 3D 旋轉。轉軸放在臉的後方（大約是脖子的位置），整張臉會往同一邊移動、鼻子動得比輪廓多，像真人轉頭。
  // 臉的起伏只用七成：一張平面的照片沒辦法表現「臉頰轉到後面被擋住」，起伏用足的話
  // 臉頰的點會越過輪廓的點，網格就翻面、出現鋸齒狀的破圖
  const back = r.size * 0.3, py = r.cy + r.size * 0.25;
  for (let i = 0; i < NF; i++) {
    // 靠近耳朵的輪廓點深度很大，直接用的話會往反方向移動；限制在轉軸前方，整張臉才會一致地往同一邊動
    const dx = cur[i * 2] - r.cx, dy = cur[i * 2 + 1] - py, dz = Math.min(-back * 0.35, (P[i].z - r.cz) * 0.6 - back);
    const x1 = dx * cyw + dz * syw, z1 = -dx * syw + dz * cyw, y1 = dy * cp - (z1 + back) * sp;
    cur[i * 2] = r.cx + x1 * cr - y1 * sr + pose.tx; cur[i * 2 + 1] = py + x1 * sr + y1 * cr + pose.ty;
  }
  for (let i = NF; i < N; i++) {
    const p = P[i];
    if (p.w > 0) { cur[i * 2] = p.x + (cur[p.src * 2] - P[p.src].x) * p.w; cur[i * 2 + 1] = p.y + (cur[p.src * 2 + 1] - P[p.src].y) * p.w; }
    else { cur[i * 2] = p.x; cur[i * 2 + 1] = p.y; }
  }
  const gl = r.gl, pos = r.pos, toClip = (x, y, out, o) => { out[o] = x / r.W * 2 - 1; out[o + 1] = 1 - y / r.H * 2; };
  for (let i = 0; i < N; i++) toClip(cur[i * 2], cur[i * 2 + 1], pos, i * 2);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disableVertexAttribArray(r.aUv);
  gl.vertexAttrib2f(r.aUv, 0, 0);
  const solid = (pts, color) => {
    // 用扇形把一個多邊形塗成單色（口腔、牙齒）
    const n = pts.length / 2, data = new Float32Array((n + 2) * 2);
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += pts[i * 2]; my += pts[i * 2 + 1]; }
    toClip(mx / n, my / n, data, 0);
    for (let i = 0; i <= n; i++) toClip(pts[(i % n) * 2], pts[(i % n) * 2 + 1], data, (i + 1) * 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.extraBuf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(r.aPos); gl.vertexAttribPointer(r.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4f(r.uColor, color[0], color[1], color[2], 1);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, n + 2);
  };
  // 先畫口腔（深色），再把臉的網格蓋上去：上下兩排接縫分開的地方才看得到裡面
  const ring = [], su = r.seamUp, sl = r.seamLo;
  for (const i of su) ring.push(cur[i * 2], cur[i * 2 + 1]);
  for (let k = sl.length - 2; k > 0; k--) ring.push(cur[sl[k] * 2], cur[sl[k] * 2 + 1]);
  solid(ring, [0.13, 0.04, 0.05]);
  // 照片裡嘴巴閉著時沒有牙齒可以用。試過自己畫一排牙齒，看起來像兩顆白點、很假，所以只留深色的口腔
  gl.uniform4f(r.uColor, 0, 0, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, r.posBuf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(r.aPos); gl.vertexAttribPointer(r.aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, r.uvBuf);
  gl.enableVertexAttribArray(r.aUv); gl.vertexAttribPointer(r.aUv, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.idxBuf);
  gl.drawElements(gl.TRIANGLES, r.nTri, gl.UNSIGNED_SHORT, 0);
  return r.cv;
}
