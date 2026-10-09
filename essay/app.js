'use strict';
/* 小作家樂園 — 主程式（純前端，資料存在瀏覽器 localStorage） */

const STORE_KEY = 'kidEssay_v1';
const GRADE_NAMES = ['', '一', '二', '三', '四', '五', '六'];
const RUBRIC = [['content', '內容', '切題、內容豐富'], ['structure', '結構', '段落分明、條理清楚'], ['wording', '用詞', '用詞恰當、生動'], ['punct', '標點與錯字', '標點正確、沒有錯字']];
const STICKERS = ['👍', '❤️', '🌟', '👏', '😆'];
const QUICK_COMMENTS = ['用詞很生動！', '段落分明，很棒！', '感情真摯，讀了很感動。', '開頭很吸引人！', '可以再多描寫自己的感受。', '注意標點符號的使用。', '有幾個錯字，再檢查一次。', '結尾可以再呼應題目。'];
const RHETORIC = [
  { k: 'simile', n: '譬喻', re: /好像|像是|彷彿|如同|好比|宛如|似的|像.{1,10}一樣/ },
  { k: 'question', n: '設問', re: /[？?]/ },
  { k: 'exclaim', n: '感嘆', re: /[！!]/ },
  { k: 'onomato', n: '狀聲詞', re: /嘩啦|叮噹|叮咚|汪汪|咕嚕|轟隆|滴答|喵|呼呼|沙沙|撲通|砰|嘰嘰/ }
];

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
let S = loadState();
let teacherOK = false;
let saveTimer = null;

/* ---------- 資料 ---------- */
function defaultState() {
  return {
    profiles: [], essays: [], activeId: null, pin: null,
    rewards: [
      { id: 'r1', name: '當一天小老師', cost: 100 },
      { id: 'r2', name: '自己選座位一天', cost: 80 },
      { id: 'r3', name: '多 10 分鐘遊戲時間', cost: 60 }
    ],
    redemptions: []
  };
}
function loadState() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d && Array.isArray(d.profiles)) return Object.assign(defaultState(), d);
  } catch (e) { /* 沒有資料或無法讀取 */ }
  return defaultState();
}
function save() {
  clearTimeout(saveTimer); saveTimer = null;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { toast('⚠️ 無法儲存，請確認瀏覽器沒有封鎖網站資料'); }
}

/* ---------- 小工具 ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDate = ts => { const d = new Date(ts); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
const me = () => S.profiles.find(p => p.id === S.activeId) || null;
const profileById = id => S.profiles.find(p => p.id === id);
const essayById = id => S.essays.find(e => e.id === id);
const topicById = id => TOPICS.find(t => t.id === id);
const badgeById = id => BADGES.find(b => b.id === id);
const bandOf = g => (g <= 2 ? 'low' : g <= 4 ? 'mid' : 'high');
const bandFor = p => BANDS[bandOf(p.grade)];
const avgScore = sc => RUBRIC.reduce((s, [k]) => s + sc[k], 0) / RUBRIC.length;
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const typeOf = e => (topicById(e.topicId) || { type: '自由寫作' }).type;
const paragraphs = t => t.split(/\n+/).filter(s => s.trim()).map(s => `<p>${esc(s)}</p>`).join('');
const authorLine = a => (a ? `${a.avatar} ${esc(a.name)}・${GRADE_NAMES[a.grade]}年級` : '');

// 字數：中文字、注音各算一個字，英文單字或數字算一個字
function countWords(t) {
  const m = String(t).match(/[㐀-鿿豈-﫿ㄅ-ㄯ]|[A-Za-z0-9]+/g);
  return m ? m.length : 0;
}

// 偵測灌水：同字連打、單一字比例過高、同一句重複
function paddingIssue(t) {
  if (/([㐀-鿿A-Za-z])\1{4,}/.test(t)) return '有同一個字連續重複很多次';
  const chars = t.match(/[㐀-鿿]/g) || [];
  if (chars.length >= 40) {
    const f = {}; let mx = 0;
    for (const c of chars) { f[c] = (f[c] || 0) + 1; mx = Math.max(mx, f[c]); }
    if (mx / chars.length > 0.25) return '某個字出現太多次了';
  }
  const seen = {};
  for (const s of t.split(/[。！？!?，,\n]/).map(x => x.trim()).filter(x => x.length >= 4)) {
    seen[s] = (seen[s] || 0) + 1;
    if (seen[s] >= 3) return '有句子重複了好幾次';
  }
  return null;
}

const detectRhetoric = t => RHETORIC.filter(r => r.re.test(t));

function levelOf(total) {
  let i = 0;
  LEVELS.forEach((l, j) => { if (total >= l[0]) i = j; });
  const [min, name, icon] = LEVELS[i], next = LEVELS[i + 1];
  return { i, name, icon, min, next: next ? next[0] : null, nextName: next ? next[1] : null };
}

function streak(p) {
  const days = new Set(p.days), d = new Date();
  if (!days.has(ymd(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(ymd(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function award(p, amount, text) {
  p.ink += amount; p.totalInk += amount;
  p.log.unshift({ t: Date.now(), text, amount });
  p.log = p.log.slice(0, 40);
  return { amount, text };
}
function spend(p, amount, text) {
  p.ink -= amount;
  p.log.unshift({ t: Date.now(), text, amount: -amount });
  p.log = p.log.slice(0, 40);
}
function giveBadge(p, id, list) {
  if (!p.badges.includes(id)) { p.badges.push(id); list.push(id); }
}

function greet() {
  const h = new Date().getHours();
  return h < 11 ? '早安' : h < 18 ? '午安' : '晚安';
}

/* ---------- 交作文、批改：獎勵規則都在這裡 ---------- */
function submitEssay(e) {
  const p = me(), b = bandFor(p), gains = [], badges = [];
  const levelBefore = levelOf(p.totalInk).i;
  e.words = countWords(e.content);
  e.submittedAt = Date.now();
  if (!e.firstSubmitAt) {
    e.firstSubmitAt = Date.now();
    gains.push(award(p, 10, `完成作文〈${e.title}〉`));
    if (e.words >= b.min && !paddingIssue(e.content)) gains.push(award(p, 5, '達到建議字數'));
  } else if (e.status === 'revising') {
    gains.push(award(p, 8, `依評語修改〈${e.title}〉`));
  }
  e.status = 'submitted';

  const today = ymd();
  if (!p.days.includes(today)) {
    p.days.push(today);
    const st = streak(p);
    if (st === 3) gains.push(award(p, 15, '連續寫作 3 天'));
    if (st === 7) gains.push(award(p, 40, '連續寫作 7 天'));
  }

  const done = S.essays.filter(x => x.pid === p.id && x.firstSubmitAt);
  if (done.length >= 1) giveBadge(p, 'first', badges);
  if (done.length >= 5) giveBadge(p, 'five', badges);
  if (done.length >= 10) giveBadge(p, 'ten', badges);
  const st = streak(p);
  if (st >= 3) giveBadge(p, 'streak3', badges);
  if (st >= 7) giveBadge(p, 'streak7', badges);
  if (detectRhetoric(e.content).length >= 3) giveBadge(p, 'rhetoric', badges);
  if (new Set(done.map(typeOf)).size >= 4) giveBadge(p, 'allround', badges);
  if (e.words >= b.max && !paddingIssue(e.content)) giveBadge(p, 'longwriter', badges);

  save();
  const lv = levelOf(p.totalInk);
  const extra = lv.i > levelBefore ? `<p class="level-up">⬆️ 升級了！你現在是「${lv.icon} ${lv.name}」</p>` : '';
  return { gains, badges, extra };
}

function gradeEssay(e, scores, comment, featured) {
  const p = profileById(e.pid), gains = [], badges = [];
  const newly = e.status === 'submitted';
  const avg = avgScore(scores);
  e.scores = scores; e.comment = comment; e.gradedAt = Date.now(); e.status = 'graded';
  if (newly && avg >= 4) gains.push(award(p, 10, `〈${e.title}〉得到老師 4 星以上評價`));
  if (newly && e.prevAvg != null && avg > e.prevAvg) giveBadge(p, 'revise', badges);
  if (RUBRIC.every(([k]) => scores[k] === 5)) giveBadge(p, 'perfect', badges);
  if (featured && !e.featuredAwarded) {
    e.featuredAwarded = true;
    gains.push(award(p, 30, `〈${e.title}〉被選為精選作品`));
    giveBadge(p, 'star', badges);
  }
  e.featured = featured;
  p.inbox.push({ text: `老師${newly ? '批改了' : '更新了'}〈${e.title}〉的評分`, gains, badges });
  save();
  return gains.reduce((s, g) => s + g.amount, 0);
}

/* ---------- 畫面 ---------- */
function render() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  let name = parts[0] || 'home';
  const [, a1, a2] = parts;
  const p = me();
  if (name === 'write' || name === 'essay') {
    const e = essayById(a1);
    if (e) name = (e.status === 'draft' || e.status === 'revising') ? 'write' : 'essay';
  }
  document.body.dataset.paper = p ? p.theme : 'plain';
  renderHeader(name);

  let html;
  if (name === 'teacher') html = viewTeacher(a1, a2);
  else if (name === 'wall') html = viewWall(a1);
  else if (!p || name === 'profiles') html = viewProfiles();
  else {
    const views = { home: viewHome, topics: viewTopics, write: viewWrite, portfolio: viewPortfolio, essay: viewEssay, shop: viewShop };
    html = (views[name] || viewHome)(a1, a2);
  }
  $app.innerHTML = html;
  if (name === 'write' && p) mountEditor(a1);
  if (name === 'home' && p && p.inbox.length) showInbox(p);
}

function renderHeader(cur) {
  const p = me();
  const links = [['home', '🏠', '我的書桌'], ['topics', '✏️', '寫作文'], ['portfolio', '📂', '作品集'], ['wall', '🌟', '精選牆'], ['shop', '🎁', '獎勵商店'], ['teacher', '👩‍🏫', '老師／家長']];
  document.getElementById('nav').innerHTML = links.map(([k, i, t]) =>
    `<a href="#${k}" class="${cur === k ? 'on' : ''}"><span aria-hidden="true">${i}</span>${t}</a>`).join('');
  document.getElementById('who').innerHTML = p
    ? `<a href="#profiles" class="who-chip" title="切換使用者"><span class="ava">${p.avatar}</span><span class="who-name">${esc(p.name)}</span><span class="ink">💧${p.ink}</span></a>`
    : '<a href="#profiles" class="who-chip">👤 選擇使用者</a>';
}

const notFound = () => '<section class="card"><p>找不到這個頁面。</p><a href="#home" class="btn">回首頁</a></section>';

function viewProfiles() {
  const starters = SHOP.filter(i => i.kind === 'avatar' && i.cost === 0);
  return `<section class="card center-card">
    <h1>👋 歡迎來到小作家樂園</h1>
    <p class="muted">點選你的名字開始寫作，或建立一個新的小作家。</p>
    ${S.profiles.length ? `<div class="profile-grid">${S.profiles.map(p => `
      <button class="profile-btn ${p.id === S.activeId ? 'on' : ''}" data-act="pick-profile" data-id="${p.id}">
        <span class="ava big">${p.avatar}</span><b>${esc(p.name)}</b>
        <small>${GRADE_NAMES[p.grade]}年級・${bandFor(p).icon}${bandFor(p).name}</small>
      </button>`).join('')}</div>` : ''}
    <form class="new-profile" data-form="new-profile">
      <h2>➕ 新增小作家</h2>
      <label>暱稱或座號 <input name="name" maxlength="12" required placeholder="例如：小明、5號"></label>
      <label>年級 <select name="grade">${[1, 2, 3, 4, 5, 6].map(g => `<option value="${g}">${GRADE_NAMES[g]}年級</option>`).join('')}</select></label>
      <div class="field-label">選一個頭像</div>
      <div class="ava-pick">${starters.map((a, i) => `<label><input type="radio" name="avatar" value="${a.icon}" ${i === 0 ? 'checked' : ''}><span>${a.icon}</span></label>`).join('')}</div>
      <p class="hint">🔒 為了保護隱私，請不要輸入真實的全名。</p>
      <button class="btn primary" type="submit">建立</button>
    </form>
  </section>`;
}

function dailyPicks(list, n, seed) {
  let h = 0;
  for (const c of ymd() + seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const notDone = list.filter(t => !S.essays.some(e => e.pid === S.activeId && e.topicId === t.id && e.firstSubmitAt));
  const pool = notDone.length >= n ? notDone : list;
  return Array.from({ length: Math.min(n, pool.length) }, (_, i) => pool[(h + i) % pool.length]);
}

function topicCard(t) {
  const done = S.essays.some(e => e.pid === S.activeId && e.topicId === t.id && e.firstSubmitAt);
  return `<button class="topic" data-act="start-topic" data-id="${t.id}">
    <span class="t-icon">${t.icon}</span><b>${esc(t.title)}</b>
    <small><span class="type">${t.type}</span>${esc(t.desc)}</small>
    ${done ? '<em class="done">✔ 寫過了</em>' : ''}
  </button>`;
}

function badgeHTML(bd, got) {
  return `<div class="badge ${got ? 'got' : ''}"><span>${bd.icon}</span><b>${bd.name}</b><small>${bd.desc}</small></div>`;
}

function viewHome() {
  const p = me(), b = bandFor(p), lv = levelOf(p.totalInk), st = streak(p);
  const pct = lv.next ? Math.round((p.totalInk - lv.min) / (lv.next - lv.min) * 100) : 100;
  const mine = S.essays.filter(e => e.pid === p.id);
  const drafts = mine.filter(e => e.status === 'draft' || e.status === 'revising');
  const done = mine.filter(e => e.firstSubmitAt).length;
  const recs = dailyPicks(TOPICS.filter(t => t.band === b.key), 3, p.id);
  return `
  <section class="hero card">
    <div class="ava huge">${p.avatar}</div>
    <div class="hero-main">
      <h1>${esc(p.name)}，${greet()}！</h1>
      <p class="muted">${GRADE_NAMES[p.grade]}年級・${b.icon} ${b.name}・建議字數 ${b.min}–${b.max} 字</p>
      <div class="level">
        <span class="lv-badge">${lv.icon} ${lv.name}</span>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <small>${lv.next ? `再 ${lv.next - p.totalInk} 滴墨水，就能升級為「${lv.nextName}」` : '你已經是最高等級了！'}</small>
      </div>
    </div>
  </section>
  <section class="stats">
    <div class="stat"><span>💧</span><b>${p.ink}</b><small>墨水（可兌換）</small></div>
    <div class="stat"><span>🔥</span><b>${st}</b><small>連續寫作天數</small></div>
    <div class="stat"><span>📝</span><b>${done}</b><small>完成的作文</small></div>
    <div class="stat"><span>🏅</span><b>${p.badges.length}/${BADGES.length}</b><small>收集的徽章</small></div>
  </section>
  ${drafts.length ? `<section class="card"><h2>📌 還沒寫完的作文</h2><div class="list">${drafts.map(e => `
    <a class="row" href="#write/${e.id}">${e.status === 'revising' ? '<span class="tag blue">修改中</span>' : '<span class="tag gray">草稿</span>'}
    <b>${esc(e.title || '（未命名）')}</b><small>${countWords(e.content)} 字</small></a>`).join('')}</div></section>` : ''}
  <section class="card">
    <h2>💡 今天推薦的題目</h2>
    <div class="topic-grid">${recs.map(topicCard).join('')}</div>
    <p><a class="btn" href="#topics">看更多題目 →</a></p>
  </section>
  <section class="card">
    <h2>🏅 我的徽章</h2>
    <div class="badge-grid">${BADGES.map(bd => badgeHTML(bd, p.badges.includes(bd.id))).join('')}</div>
  </section>
  <section class="card">
    <h2>📜 最近的墨水紀錄</h2>
    ${p.log.length ? `<ul class="log">${p.log.slice(0, 8).map(l => `
      <li><span class="${l.amount >= 0 ? 'plus' : 'minus'}">${l.amount >= 0 ? '+' : ''}${l.amount}</span>${esc(l.text)}<small>${fmtDate(l.t)}</small></li>`).join('')}</ul>`
      : '<p class="muted">還沒有紀錄。寫完第一篇作文就能拿到墨水喔！</p>'}
  </section>`;
}

function viewTopics(bk) {
  const p = me();
  if (!BANDS[bk]) bk = bandOf(p.grade);
  const b = BANDS[bk];
  return `<section class="card">
    <h1>✏️ 選一個題目</h1>
    <div class="tabs">${Object.values(BANDS).map(x => `<a href="#topics/${x.key}" class="${x.key === bk ? 'on' : ''}">${x.icon} ${x.name}<small>${x.grades}</small></a>`).join('')}</div>
    <p class="goal">🎯 ${b.goal}（建議 ${b.min}–${b.max} 字）</p>
    ${bk !== bandOf(p.grade) ? '<p class="hint">這不是你年級的題目，想挑戰也可以喔！字數獎勵會依照你的年級計算。</p>' : ''}
    <div class="topic-grid">
      ${TOPICS.filter(t => t.band === bk).map(topicCard).join('')}
      <button class="topic free" data-act="start-topic" data-id="free"><span class="t-icon">🖍️</span><b>自由寫作</b><small>自己訂題目，寫你想寫的事</small></button>
    </div>
  </section>`;
}

function viewWrite(id) {
  const p = me(), e = essayById(id);
  if (!e || e.pid !== p.id) return notFound();
  const t = topicById(e.topicId), b = bandFor(p);
  return `<div class="write-layout">
  <section class="card editor-card">
    <div class="topic-head">
      <span class="t-icon">${t ? t.icon : '🖍️'}</span>
      <div><small class="type">${t ? t.type : '自由寫作'}</small><p>${t ? esc(t.desc) : '自己訂一個題目吧！'}</p></div>
    </div>
    ${t ? `<details class="questions" open><summary>🤔 動筆前，先想一想</summary><ul>${t.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul></details>` : ''}
    ${e.status === 'revising' && e.comment ? `<div class="teacher-note">👩‍🏫 老師的評語：${esc(e.comment)}</div>` : ''}
    <input id="ed-title" class="ed-title" maxlength="30" placeholder="請輸入題目" value="${esc(e.title)}" aria-label="題目">
    <div class="paper"><textarea id="ed-body" placeholder="從這裡開始寫……" aria-label="作文內容">${esc(e.content)}</textarea></div>
    <div class="ed-foot">
      <div class="counter"><span><b id="wc">0</b> 字 <span class="muted">／建議 ${b.min}–${b.max} 字</span></span><div class="bar small"><i id="wc-bar"></i></div></div>
      <div id="rh" class="rh"></div>
      <p id="pad-warn" class="warn" hidden></p>
      <div class="ed-actions">
        <span id="saved" class="muted">已自動儲存 ✓</span>
        ${e.status === 'draft' ? `<button class="btn" data-act="discard" data-id="${e.id}">🗑️ 刪除草稿</button>` : ''}
        <button class="btn primary" data-act="open-submit" data-id="${e.id}">📮 交出作文</button>
      </div>
    </div>
  </section>
  <aside class="card helper">
    <div class="tabs small">
      <button data-act="help-tab" data-tab="steps" class="on">寫作步驟</button>
      <button data-act="help-tab" data-tab="tpl">句型修辭</button>
      <button data-act="help-tab" data-tab="words">好詞庫</button>
    </div>
    <div class="help-pane" data-pane="steps">${b.steps.map((s, i) => `<div class="step"><b>${i + 1}. ${s.t}</b><p>${s.d}</p><p class="eg">例：${s.eg}</p></div>`).join('')}</div>
    <div class="help-pane" data-pane="tpl" hidden>
      <p class="hint">點一下就會放進作文裡，再把＿＿換成你自己的內容。</p>
      ${b.templates.map(x => `<button class="chip block" data-act="insert" data-text="${esc(x.replace(/^[^：]*：/, ''))}">${esc(x)}</button>`).join('')}
    </div>
    <div class="help-pane" data-pane="words" hidden>
      <p class="hint">點一下就能放進作文裡。</p>
      ${Object.entries(b.words).map(([k, ws]) => `<h4>${k}</h4><div>${ws.map(w => `<button class="chip" data-act="insert" data-text="${w}">${w}</button>`).join('')}</div>`).join('')}
    </div>
  </aside>
  </div>`;
}

function mountEditor(id) {
  const e = essayById(id);
  const ta = document.getElementById('ed-body'), ti = document.getElementById('ed-title');
  if (!e || !ta) return;
  const update = () => {
    e.content = ta.value; e.title = ti.value.trim(); e.updatedAt = Date.now();
    refreshEditorStats(e);
    document.getElementById('saved').textContent = '儲存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      save();
      const s = document.getElementById('saved');
      if (s) s.textContent = '已自動儲存 ✓';
    }, 600);
  };
  ta.addEventListener('input', update);
  ti.addEventListener('input', update);
  refreshEditorStats(e);
}

function refreshEditorStats(e) {
  const b = bandFor(me()), n = countWords(e.content);
  document.getElementById('wc').textContent = n;
  const bar = document.getElementById('wc-bar');
  bar.style.width = Math.min(100, n / b.min * 100) + '%';
  bar.classList.toggle('ok', n >= b.min);
  const found = detectRhetoric(e.content);
  document.getElementById('rh').innerHTML = found.length
    ? `✨ 偵測到的修辭：${found.map(r => `<span class="tag purple">${r.n}</span>`).join('')}` : '';
  const pad = paddingIssue(e.content), w = document.getElementById('pad-warn');
  w.hidden = !pad;
  w.textContent = pad ? `⚠️ ${pad}，這樣不會拿到字數獎勵喔！` : '';
}

function viewEssay(id) {
  const p = me(), e = essayById(id);
  if (!e || e.pid !== p.id) return notFound();
  return `<section class="card">
    <a href="#portfolio" class="back">← 回作品集</a>
    <article class="paper read"><h1 class="essay-title">${esc(e.title)}</h1><div class="essay-body">${paragraphs(e.content)}</div></article>
    <p class="muted">${statusTag(e)} ${e.words} 字・${fmtDate(e.submittedAt)} 交出</p>
    ${e.status === 'graded' ? gradeBlock(e) : '<p class="hint">⏳ 已經交給老師，等待批改中……</p>'}
    ${e.status === 'graded' ? `<button class="btn" data-act="revise" data-id="${e.id}">✏️ 依評語修改，再交一次（+8 💧）</button>` : ''}
    ${e.featured ? reactionsBar(e) : ''}
  </section>`;
}

function gradeBlock(e) {
  return `<div class="grade-box">
    <h3>👩‍🏫 老師的評分 <span class="avg">平均 ${avgScore(e.scores).toFixed(1)} ★</span></h3>
    <div class="rubric-view">${RUBRIC.map(([k, n]) => `<div><span>${n}</span><b class="stars">${stars(e.scores[k])}</b></div>`).join('')}</div>
    ${e.comment ? `<p class="comment">💬 ${esc(e.comment)}</p>` : ''}
    ${e.featured ? '<p class="featured-tag">🌟 這篇被選為精選作品！</p>' : ''}
  </div>`;
}

function statusTag(e) {
  const [t, c] = { draft: ['草稿', 'gray'], submitted: ['等待批改', 'yellow'], graded: ['已批改', 'green'], revising: ['修改中', 'blue'] }[e.status];
  return `<span class="tag ${c}">${t}</span>`;
}

function essayCard(e, href) {
  href = href || ((e.status === 'draft' || e.status === 'revising') ? `#write/${e.id}` : `#essay/${e.id}`);
  return `<a class="essay-card" href="${href}">
    <div class="ec-top">${statusTag(e)}${e.featured ? '<span class="tag star">🌟 精選</span>' : ''}</div>
    <b>${esc(e.title || '（未命名）')}</b>
    <p>${esc(e.content.slice(0, 50))}${e.content.length > 50 ? '…' : ''}</p>
    <small>${countWords(e.content)} 字・${fmtDate(e.updatedAt)}${e.scores ? `・${avgScore(e.scores).toFixed(1)} ★` : ''}</small>
  </a>`;
}

function viewPortfolio() {
  const p = me();
  const mine = S.essays.filter(e => e.pid === p.id).sort((a, b) => b.updatedAt - a.updatedAt);
  const graded = mine.filter(e => e.scores).sort((a, b) => a.gradedAt - b.gradedAt).slice(-10);
  return `<section class="card">
    <h1>📂 我的作品集</h1>
    ${graded.length >= 2 ? `<div class="growth"><h3>📈 我的進步（老師評分平均）</h3><div class="bars">${graded.map(e => {
      const a = avgScore(e.scores);
      return `<div class="bcol" title="${esc(e.title)}：${a.toFixed(1)} ★"><small>${a.toFixed(1)}</small><i style="height:${a / 5 * 100}%"></i></div>`;
    }).join('')}</div></div>` : ''}
    ${mine.length ? `<div class="essay-grid">${mine.map(e => essayCard(e)).join('')}</div>` : '<p class="empty">還沒有作品，<a href="#topics">去寫第一篇吧！</a></p>'}
  </section>`;
}

function reactionsBar(e) {
  const p = me();
  return `<div class="reactions"><span class="muted">送個鼓勵：</span>${STICKERS.map(s => {
    const arr = e.reactions[s] || [];
    return `<button class="react ${p && arr.includes(p.id) ? 'on' : ''}" data-act="react" data-id="${e.id}" data-s="${s}" ${p ? '' : 'disabled'}>${s} <b>${arr.length}</b></button>`;
  }).join('')}</div>`;
}

function viewWall(id) {
  const list = S.essays.filter(e => e.featured).sort((a, b) => (b.gradedAt || 0) - (a.gradedAt || 0));
  if (id) {
    const e = list.find(x => x.id === id);
    if (!e) return notFound();
    return `<section class="card">
      <a href="#wall" class="back">← 回精選牆</a>
      <article class="paper read"><h1 class="essay-title">${esc(e.title)}</h1><p class="author">${authorLine(profileById(e.pid))}</p><div class="essay-body">${paragraphs(e.content)}</div></article>
      ${e.comment ? `<p class="comment">👩‍🏫 老師說：${esc(e.comment)}</p>` : ''}
      ${reactionsBar(e)}
    </section>`;
  }
  return `<section class="card">
    <h1>🌟 精選作品牆</h1>
    <p class="muted">老師挑選出來的好文章，一起來欣賞，再送上鼓勵貼圖吧！</p>
    ${list.length ? `<div class="essay-grid">${list.map(e => `
      <a class="essay-card wall" href="#wall/${e.id}">
        <b>${esc(e.title)}</b><small>${authorLine(profileById(e.pid))}</small>
        <p>${esc(e.content.slice(0, 60))}…</p>
        <div class="mini-react">${STICKERS.map(s => { const n = (e.reactions[s] || []).length; return n ? `<span>${s}${n}</span>` : ''; }).join('')}</div>
      </a>`).join('')}</div>` : '<p class="empty">還沒有精選作品。老師批改時，可以把好文章選為精選喔！</p>'}
  </section>`;
}

function viewShop(tab) {
  const p = me();
  if (!['avatar', 'paper', 'real'].includes(tab)) tab = 'avatar';
  const tabs = [['avatar', '😺 頭像'], ['paper', '📜 稿紙'], ['real', '🎁 老師的獎勵']];
  let body;
  if (tab === 'real') {
    body = S.rewards.length ? `<div class="shop-grid">${S.rewards.map(r => `
      <div class="item"><span class="item-icon">🎁</span><b>${esc(r.name)}</b>
      <button class="btn primary" data-act="redeem" data-id="${r.id}" ${p.ink < r.cost ? 'disabled' : ''}>💧${r.cost} 兌換</button></div>`).join('')}</div>`
      : '<p class="empty">老師還沒有設定獎勵。</p>';
    const mine = S.redemptions.filter(x => x.pid === p.id);
    if (mine.length) body += `<h3>我的兌換紀錄</h3><ul class="log">${mine.map(x => `<li>${esc(x.name)}<small>${x.done ? '✅ 已兌現' : '⏳ 等老師兌現'}</small></li>`).join('')}</ul>`;
  } else {
    body = `<div class="shop-grid">${SHOP.filter(i => i.kind === tab).map(i => {
      const own = i.cost === 0 || p.owned.includes(i.id);
      const using = tab === 'avatar' ? p.avatar === i.id : p.theme === i.id;
      const btn = using ? '<button class="btn" disabled>使用中</button>'
        : own ? `<button class="btn" data-act="use-item" data-id="${i.id}">使用</button>`
        : `<button class="btn primary" data-act="buy" data-id="${i.id}" ${p.ink < i.cost ? 'disabled' : ''}>💧${i.cost} 購買</button>`;
      const icon = tab === 'paper' ? `<span class="swatch" data-paper="${i.id}">${i.icon}</span>` : `<span class="item-icon">${i.icon}</span>`;
      return `<div class="item ${using ? 'using' : ''}">${icon}<b>${i.name}</b>${btn}</div>`;
    }).join('')}</div>`;
  }
  return `<section class="card">
    <div class="t-head"><h1>🎁 獎勵商店</h1><span class="wallet">你有 💧 <b>${p.ink}</b> 滴墨水</span></div>
    <div class="tabs">${tabs.map(([k, t]) => `<a href="#shop/${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</div>
    ${body}
  </section>`;
}

/* ---------- 老師／家長專區 ---------- */
function viewTeacher(tab, arg) {
  if (!S.pin) return `<section class="card center-card narrow">
    <h1>👩‍🏫 老師／家長專區</h1>
    <p class="muted">第一次使用，請設定 4 位數密碼，避免小朋友自己批改作文。</p>
    <form data-form="pin-setup">
      <label>設定密碼 <input name="a" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" required></label>
      <label>再輸入一次 <input name="b" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" required></label>
      <button class="btn primary" type="submit">設定</button>
    </form></section>`;
  if (!teacherOK) return `<section class="card center-card narrow">
    <h1>🔒 老師／家長專區</h1>
    <form data-form="pin-login">
      <label>請輸入密碼 <input name="pin" type="password" inputmode="numeric" maxlength="4" required autofocus></label>
      <button class="btn primary" type="submit">進入</button>
    </form></section>`;

  const pending = S.essays.filter(e => e.status === 'submitted');
  const openRedeem = S.redemptions.filter(r => !r.done).length;
  const tabs = [['pending', `📥 待批改 (${pending.length})`], ['all', '📚 全部作品'], ['students', '👧 學生管理'], ['rewards', `🎁 獎勵兌換${openRedeem ? ` (${openRedeem})` : ''}`], ['settings', '⚙️ 設定']];
  const views = { grade: () => teacherGrade(arg), all: teacherAll, students: teacherStudents, rewards: teacherRewards, settings: teacherSettings };
  const body = (views[tab] || (() => teacherTable(pending, '目前沒有待批改的作文 🎉')))();
  const curTab = tab === 'grade' ? null : views[tab] ? tab : 'pending';
  return `<section class="card">
    <div class="t-head"><h1>👩‍🏫 老師／家長專區</h1><button class="btn" data-act="lock">🔒 離開</button></div>
    <div class="tabs">${tabs.map(([k, t]) => `<a href="#teacher/${k}" class="${k === curTab ? 'on' : ''}">${t}</a>`).join('')}</div>
    ${body}
  </section>`;
}

function teacherTable(list, empty) {
  if (!list.length) return `<p class="empty">${empty}</p>`;
  return `<div class="table-wrap"><table><thead><tr><th>學生</th><th>題目</th><th>字數</th><th>交出日期</th><th>狀態</th><th></th></tr></thead><tbody>
    ${list.map(e => `<tr><td>${authorLine(profileById(e.pid))}</td><td>${esc(e.title)}</td><td>${e.words}</td><td>${fmtDate(e.submittedAt)}</td>
    <td>${statusTag(e)}${e.featured ? ' 🌟' : ''}</td><td><a class="btn small ${e.status === 'submitted' ? 'primary' : ''}" href="#teacher/grade/${e.id}">${e.status === 'submitted' ? '批改' : '查看'}</a></td></tr>`).join('')}
  </tbody></table></div>`;
}

function teacherAll() {
  const list = S.essays.filter(e => e.firstSubmitAt).sort((a, b) => b.submittedAt - a.submittedAt);
  return teacherTable(list, '還沒有學生交作文。');
}

function teacherGrade(id) {
  const e = essayById(id);
  if (!e || !e.firstSubmitAt) return notFound();
  const a = profileById(e.pid), t = topicById(e.topicId);
  const paper = `<article class="paper read"><h1 class="essay-title">${esc(e.title)}</h1>
    <p class="author">${authorLine(a)}・${e.words} 字・${t ? t.type : '自由寫作'}</p><div class="essay-body">${paragraphs(e.content)}</div></article>`;
  if (e.status === 'revising') return `<a href="#teacher/all" class="back">← 返回</a>${paper}<p class="hint">✏️ 學生正在依評語修改中，交出後就可以再批改。</p>`;
  return `<a href="#teacher/pending" class="back">← 返回</a>
  <div class="grade-layout">
    ${paper}
    <form class="grade-form" data-form="grade" data-id="${e.id}">
      <h3>評分量規</h3>
      ${RUBRIC.map(([k, n, hint]) => `<div class="rubric-row"><span>${n}<small>${hint}</small></span>
        <div class="star-pick">${[5, 4, 3, 2, 1].map(v => `<input type="radio" id="s-${k}${v}" name="${k}" value="${v}" ${e.scores && e.scores[k] === v ? 'checked' : ''}><label for="s-${k}${v}" title="${v} 星">★</label>`).join('')}</div></div>`).join('')}
      <h3>評語</h3>
      <div class="quick">${QUICK_COMMENTS.map(c => `<button type="button" class="chip" data-act="quick-comment" data-text="${c}">${c}</button>`).join('')}</div>
      <textarea name="comment" rows="4" placeholder="給孩子一些鼓勵和具體的建議……">${esc(e.comment || '')}</textarea>
      <label class="check"><input type="checkbox" name="featured" ${e.featured ? 'checked' : ''}> 🌟 選為精選作品（放上精選牆，學生 +30 💧）</label>
      <p class="hint">平均 4 星以上，學生可以獲得 +10 💧。</p>
      <button class="btn primary" type="submit">送出批改</button>
    </form>
  </div>`;
}

function teacherStudents() {
  if (!S.profiles.length) return '<p class="empty">還沒有學生。<a href="#profiles">新增學生</a></p>';
  return `<div class="table-wrap"><table><thead><tr><th>學生</th><th>年級</th><th>完成篇數</th><th>墨水</th><th>等級</th><th></th></tr></thead><tbody>
    ${S.profiles.map(p => {
      const lv = levelOf(p.totalInk);
      return `<tr><td>${p.avatar} ${esc(p.name)}</td>
      <td><select data-change="set-grade" data-id="${p.id}" aria-label="年級">${[1, 2, 3, 4, 5, 6].map(g => `<option value="${g}" ${g === p.grade ? 'selected' : ''}>${GRADE_NAMES[g]}年級</option>`).join('')}</select></td>
      <td>${S.essays.filter(e => e.pid === p.id && e.firstSubmitAt).length}</td><td>💧${p.ink}</td><td>${lv.icon} ${lv.name}</td>
      <td class="nowrap"><button class="btn small" data-act="gift" data-id="${p.id}">🎁 送墨水</button> <button class="btn small danger" data-act="del-profile" data-id="${p.id}">刪除</button></td></tr>`;
    }).join('')}
  </tbody></table></div>
  <p><a class="btn" href="#profiles">➕ 新增學生</a></p>`;
}

function teacherRewards() {
  const open = S.redemptions.filter(r => !r.done);
  return `<h3>⏳ 等待兌現</h3>
  ${open.length ? `<ul class="log">${open.map(r => `<li>${authorLine(profileById(r.pid))} 兌換了「${esc(r.name)}」<small>${fmtDate(r.at)}</small>
    <button class="btn small primary" data-act="redeem-done" data-id="${r.id}">✅ 已兌現</button></li>`).join('')}</ul>` : '<p class="muted">目前沒有待兌現的獎勵。</p>'}
  <h3>🎁 獎勵清單</h3>
  <ul class="log">${S.rewards.map(r => `<li>${esc(r.name)}<small>💧${r.cost}</small><button class="btn small danger" data-act="del-reward" data-id="${r.id}">刪除</button></li>`).join('')}</ul>
  <form class="inline-form" data-form="add-reward">
    <input name="name" maxlength="20" placeholder="獎勵名稱，例如：週末多看一集卡通" required>
    <input name="cost" type="number" min="1" max="9999" placeholder="墨水" required>
    <button class="btn primary" type="submit">新增</button>
  </form>`;
}

function teacherSettings() {
  return `<h3>🔑 更改密碼</h3>
  <form class="inline-form" data-form="pin-change">
    <input name="pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" placeholder="新的 4 位數密碼" required>
    <button class="btn primary" type="submit">更改</button>
  </form>
  <h3>💾 備份資料</h3>
  <p class="muted">所有資料都存在這台裝置的瀏覽器裡。換電腦或清除瀏覽器資料前，請先下載備份。</p>
  <p><button class="btn" data-act="export">⬇️ 下載備份</button>
  <label class="btn">⬆️ 匯入備份<input type="file" accept="application/json" data-change="import" hidden></label></p>`;
}

/* ---------- 彈出視窗、提示 ---------- */
function showModal(html) {
  $modal.querySelector('.modal-box').innerHTML = html;
  $modal.hidden = false;
}
function closeModal() { $modal.hidden = true; }

function showCelebrate(title, gains, badgeIds, extra = '') {
  const total = gains.reduce((s, g) => s + g.amount, 0);
  const confetti = Array.from({ length: 24 }, (_, i) =>
    `<i style="left:${(i * 37) % 100}%;animation-delay:${(i % 8) * 0.15}s">${['🎉', '✨', '🌟', '💧', '🎊'][i % 5]}</i>`).join('');
  showModal(`<div class="celebrate"><div class="confetti" aria-hidden="true">${confetti}</div>
    <h2>${title}</h2>${extra}
    ${gains.length ? `<ul class="gains">${gains.map(g => `<li><b>+${g.amount}</b> 💧 ${esc(g.text)}</li>`).join('')}</ul><p class="total">共獲得 <b>${total}</b> 滴墨水！</p>` : ''}
    ${badgeIds.length ? `<h3>🏅 獲得新徽章！</h3><div class="badge-grid">${badgeIds.map(id => badgeHTML(badgeById(id), true)).join('')}</div>` : ''}
    <button class="btn primary" data-act="close-modal">太棒了！</button></div>`);
}

function showInbox(p) {
  const items = p.inbox.splice(0);
  save();
  showCelebrate('📬 你有新消息！', items.flatMap(i => i.gains), items.flatMap(i => i.badges),
    `<ul class="notes">${items.map(i => `<li>${esc(i.text)}</li>`).join('')}</ul>`);
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- 按鈕動作 ---------- */
const A = {
  'pick-profile'(el) { S.activeId = el.dataset.id; save(); location.hash = '#home'; },
  'start-topic'(el) {
    const p = me(), tid = el.dataset.id;
    let e = tid !== 'free' && S.essays.find(x => x.pid === p.id && x.topicId === tid && (x.status === 'draft' || x.status === 'revising'));
    if (!e) {
      const t = topicById(tid);
      e = { id: uid(), pid: p.id, topicId: tid, title: t ? t.title : '', content: '', status: 'draft', createdAt: Date.now(), updatedAt: Date.now(), reactions: {} };
      S.essays.push(e);
      save();
    }
    location.hash = '#write/' + e.id;
  },
  'help-tab'(el) {
    const aside = el.closest('.helper');
    aside.querySelectorAll('[data-act="help-tab"]').forEach(b => b.classList.toggle('on', b === el));
    aside.querySelectorAll('.help-pane').forEach(p => { p.hidden = p.dataset.pane !== el.dataset.tab; });
  },
  insert(el) {
    const ta = document.getElementById('ed-body');
    ta.focus();
    ta.setRangeText(el.dataset.text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  },
  discard(el) {
    if (!confirm('確定要刪除這篇草稿嗎？')) return;
    S.essays = S.essays.filter(e => e.id !== el.dataset.id);
    save();
    location.hash = '#home';
  },
  'open-submit'(el) {
    const e = essayById(el.dataset.id), b = bandFor(me()), n = countWords(e.content);
    if (!e.title) return toast('請先寫上題目喔！');
    if (n < 10) return toast('作文太短了，再多寫一點吧！');
    const pad = paddingIssue(e.content);
    showModal(`<h2>📋 交作文前，檢查一下</h2>
      <div class="checklist">${b.checklist.map(c => `<label><input type="checkbox" class="ck"> ${c}</label>`).join('')}</div>
      ${n < b.min && !e.firstSubmitAt ? `<p class="hint">目前 ${n} 字，還沒達到建議的 ${b.min} 字。還是可以交，但不會拿到字數獎勵喔。</p>` : ''}
      ${pad ? `<p class="warn">⚠️ ${pad}，這篇不會拿到字數獎勵。</p>` : ''}
      <div class="modal-actions"><button class="btn" data-act="close-modal">再改一下</button>
      <button class="btn primary" id="do-submit" data-act="do-submit" data-id="${e.id}" disabled>確定交出 📮</button></div>`);
    $modal.querySelectorAll('.ck').forEach(c => c.addEventListener('change', () => {
      document.getElementById('do-submit').disabled = ![...$modal.querySelectorAll('.ck')].every(x => x.checked);
    }));
  },
  'do-submit'(el) {
    const e = essayById(el.dataset.id);
    const r = submitEssay(e);
    location.hash = '#essay/' + e.id;
    showCelebrate('🎉 作文交出去了！', r.gains, r.badges, r.extra);
  },
  revise(el) {
    const e = essayById(el.dataset.id);
    e.prevAvg = avgScore(e.scores);
    e.status = 'revising';
    save();
    location.hash = '#write/' + e.id;
  },
  react(el) {
    const p = me(), e = essayById(el.dataset.id), s = el.dataset.s;
    const arr = e.reactions[s] = e.reactions[s] || [];
    const i = arr.indexOf(p.id);
    if (i >= 0) arr.splice(i, 1); else arr.push(p.id);
    save(); render();
  },
  buy(el) {
    const p = me(), item = SHOP.find(i => i.id === el.dataset.id);
    if (p.ink < item.cost) return toast('墨水不夠喔，多寫幾篇作文吧！');
    spend(p, item.cost, `購買「${item.name}」`);
    p.owned.push(item.id);
    A['use-item'](el);
    toast(`🎉 買到「${item.name}」了！`);
  },
  'use-item'(el) {
    const p = me(), item = SHOP.find(i => i.id === el.dataset.id);
    if (item.kind === 'avatar') p.avatar = item.id; else p.theme = item.id;
    save(); render();
  },
  redeem(el) {
    const p = me(), r = S.rewards.find(x => x.id === el.dataset.id);
    if (p.ink < r.cost) return toast('墨水不夠喔！');
    if (!confirm(`要用 ${r.cost} 滴墨水兌換「${r.name}」嗎？`)) return;
    spend(p, r.cost, `兌換「${r.name}」`);
    S.redemptions.push({ id: uid(), pid: p.id, name: r.name, cost: r.cost, at: Date.now(), done: false });
    save(); render();
    toast('已送出兌換，請告訴老師或家長喔！');
  },
  lock() { teacherOK = false; location.hash = '#home'; },
  'quick-comment'(el) {
    const ta = el.closest('form').comment;
    ta.value = (ta.value ? ta.value.trimEnd() + ' ' : '') + el.dataset.text;
  },
  gift(el) {
    const p = profileById(el.dataset.id);
    const n = parseInt(prompt(`要送 ${p.name} 幾滴墨水？`, '10'), 10);
    if (!(n > 0 && n <= 999)) return;
    const reason = (prompt('原因（會顯示給學生看）', '表現很棒！') || '表現很棒！').slice(0, 30);
    p.inbox.push({ text: `老師送你墨水：${reason}`, gains: [award(p, n, `老師獎勵：${reason}`)], badges: [] });
    save(); render();
    toast(`已送給 ${p.name} ${n} 滴墨水`);
  },
  'del-profile'(el) {
    const p = profileById(el.dataset.id);
    if (!confirm(`確定要刪除「${p.name}」和他的所有作文嗎？這個動作無法復原。`)) return;
    S.profiles = S.profiles.filter(x => x.id !== p.id);
    S.essays = S.essays.filter(e => e.pid !== p.id);
    S.redemptions = S.redemptions.filter(r => r.pid !== p.id);
    if (S.activeId === p.id) S.activeId = null;
    save(); render();
  },
  'redeem-done'(el) { S.redemptions.find(r => r.id === el.dataset.id).done = true; save(); render(); },
  'del-reward'(el) { S.rewards = S.rewards.filter(r => r.id !== el.dataset.id); save(); render(); },
  export() {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `小作家樂園備份-${ymd()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  'close-modal'() { closeModal(); }
};

const FORMS = {
  'new-profile'(f) {
    const name = f.name.value.trim();
    if (!name) return;
    const p = { id: uid(), name, grade: +f.grade.value, avatar: f.avatar.value, theme: 'plain', ink: 0, totalInk: 0, badges: [], owned: [], days: [], log: [], inbox: [], createdAt: Date.now() };
    S.profiles.push(p);
    S.activeId = p.id;
    save();
    location.hash = '#home';
  },
  'pin-setup'(f) {
    if (!/^\d{4}$/.test(f.a.value)) return toast('請輸入 4 位數字');
    if (f.a.value !== f.b.value) return toast('兩次輸入的密碼不一樣');
    S.pin = f.a.value; teacherOK = true; save(); render();
  },
  'pin-login'(f) {
    if (f.pin.value === S.pin) { teacherOK = true; render(); } else { toast('密碼不正確'); f.pin.value = ''; }
  },
  'pin-change'(f) {
    if (!/^\d{4}$/.test(f.pin.value)) return toast('請輸入 4 位數字');
    S.pin = f.pin.value; save(); f.reset(); toast('密碼已更改');
  },
  grade(f) {
    const scores = {};
    for (const [k, n] of RUBRIC) {
      const v = f.querySelector(`input[name="${k}"]:checked`);
      if (!v) return toast(`請幫「${n}」打分數`);
      scores[k] = +v.value;
    }
    const e = essayById(f.dataset.id);
    const got = gradeEssay(e, scores, f.comment.value.trim().slice(0, 500), f.featured.checked);
    toast(`批改完成！${got ? `${profileById(e.pid).name} 獲得 ${got} 滴墨水` : ''}`);
    location.hash = '#teacher/pending';
  },
  'add-reward'(f) {
    const cost = parseInt(f.cost.value, 10);
    if (!f.name.value.trim() || !(cost > 0)) return;
    S.rewards.push({ id: uid(), name: f.name.value.trim(), cost });
    save(); render();
  }
};

const CHANGES = {
  'set-grade'(el) { profileById(el.dataset.id).grade = +el.value; save(); toast('已更新年級'); },
  import(el) {
    const file = el.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!d || !Array.isArray(d.profiles) || !Array.isArray(d.essays)) throw new Error('bad');
        if (!confirm('匯入會取代目前所有資料，確定嗎？')) return;
        S = Object.assign(defaultState(), d);
        save(); render();
        toast('匯入完成！');
      } catch (err) { toast('這不是正確的備份檔'); }
    };
    reader.readAsText(file);
  }
};

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (el && A[el.dataset.act] && !el.disabled) A[el.dataset.act](el, ev);
});
document.addEventListener('submit', ev => {
  const f = ev.target.closest('[data-form]');
  if (!f) return;
  ev.preventDefault();
  FORMS[f.dataset.form](f);
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-change]');
  if (el) CHANGES[el.dataset.change](el);
});
$modal.addEventListener('click', ev => { if (ev.target === $modal) closeModal(); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeModal(); });
window.addEventListener('hashchange', () => { if (saveTimer) save(); render(); window.scrollTo(0, 0); });
window.addEventListener('beforeunload', () => { if (saveTimer) save(); });

render();
