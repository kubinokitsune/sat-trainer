/* ══════════════════════════════════════════════════════════════════
   app.js — screens, adaptive session engine, Bluebook-style runner
   ══════════════════════════════════════════════════════════════════ */
(() => {
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const DIFFS = ['Easy', 'Medium', 'Hard'];
const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const paras = t => String(t || '').split(/\n{2,}/).filter(p => p.trim())
  .map(p => `<p${p.startsWith('• ') ? ' class="bul"' : ''}>${esc(p)}</p>`).join('');
const imgs = list => (list || []).map(src =>
  `<img src="${esc(src)}" alt="" loading="lazy">`).join('');
/** Chart passages: full-width render plus a click-to-enlarge affordance. */
const figure = list => !list || !list.length ? '' :
  '<div class="figbox"><button class="figzoom" data-zoom="' + esc(list.join('|')) +
  '">🔍 Enlarge figure</button>' + imgs(list) + '</div>';
const pct = v => v == null ? '—' : Math.round(v * 100) + '%';

/* ══════════════════ data ══════════════════ */
const BANK = { rw: [], math: [] };
const SUBJ = { rw: 'Reading and Writing', math: 'Math' };

function prepare() {
  BANK.rw = (window.SAT_ENGLISH || []).filter(q => q.choices && Object.keys(q.choices).length === 4);
  BANK.math = (window.SAT_MATH || []);
  for (const k in BANK) for (const q of BANK[k]) q._s = k;
}

/* ══════════════════ answer checking ══════════════════ */
function numOf(str) {
  const s = String(str).replace(/\s|\$|,/g, '');
  if (/^-?\d*\.?\d+$/.test(s) && s !== '' && s !== '-' && s !== '.') return parseFloat(s);
  const m = s.match(/^(-?\d*\.?\d+)\/(-?\d*\.?\d+)$/);
  if (m && parseFloat(m[2]) !== 0) return parseFloat(m[1]) / parseFloat(m[2]);
  return null;
}

/** Grid-in checking: exact form, or the College Board rounding/truncation rule. */
function checkSPR(input, answerStr) {
  const given = String(input || '').trim();
  if (!given) return false;
  const accepted = String(answerStr).split(/\s*,\s*/).map(x => x.trim()).filter(Boolean);
  const flat = x => x.replace(/\s/g, '').toLowerCase();
  if (accepted.some(a => flat(a) === flat(given))) return true;

  const v = numOf(given);
  if (v === null) return false;
  for (const a of accepted) {
    const t = numOf(a);
    if (t === null) continue;
    if (Math.abs(v - t) < 1e-9) return true;
    // a decimal answer may be rounded or truncated, but only at 3+ digits
    if (!Number.isInteger(t)) {
      const dp = (given.split('.')[1] || '').length;
      if (dp >= 3 && Math.abs(v - t) <= Math.pow(10, -dp)) return true;
    }
  }
  return false;
}

/* ══════════════════ question selection ══════════════════ */
const RW_ORDER = ['Craft and Structure', 'Information and Ideas',
  'Standard English Conventions', 'Expression of Ideas'];

function pool(subject, filt) {
  filt = filt || {};
  let p = BANK[subject];
  if (filt.domains && filt.domains.length) p = p.filter(q => filt.domains.includes(q.domain));
  if (filt.skills && filt.skills.length) p = p.filter(q => filt.skills.includes(q.skill));
  if (filt.difficulty) p = p.filter(q => q.difficulty === filt.difficulty);
  return p;
}

/** Prefer unseen questions, then questions in the user's weaker skills. */
function pickOne(subject, difficulty, exclude, filt) {
  const seen = Store.state().seen;
  const skillAcc = {};
  for (const g of Store.groupStats(subject, 'k')) skillAcc[g.name] = g.acc;

  let cand = pool(subject, Object.assign({ difficulty }, filt))
    .filter(q => !exclude.has(q.id));
  if (!cand.length) {
    cand = pool(subject, filt).filter(q => !exclude.has(q.id));
    if (!cand.length) cand = pool(subject, filt);
    if (!cand.length) return null;
  }
  const fresh = cand.filter(q => !seen[q.id]);
  const use = fresh.length ? fresh : cand;

  let best = null, bestScore = -Infinity;
  const tries = Math.min(use.length, 60);
  for (let i = 0; i < tries; i++) {
    const q = use[(Math.random() * use.length) | 0];
    const acc = skillAcc[q.skill];
    const weak = acc == null ? 0.35 : (1 - acc);   // unseen skills get a nudge
    const score = weak * 1.2 + Math.random() * 0.9 - (seen[q.id] || 0) * 0.6;
    if (score > bestScore) { bestScore = score; best = q; }
  }
  return best;
}

/** Share of each module the College Board blueprint gives to each domain. */
const BLUEPRINT = {
  rw: { 'Information and Ideas': .26, 'Craft and Structure': .28, 'Expression of Ideas': .20, 'Standard English Conventions': .26 },
  math: { 'Algebra': .35, 'Advanced Math': .35, 'Problem-Solving and Data Analysis': .15, 'Geometry and Trigonometry': .15 }
};

/** Split n into integer parts by weight, largest remainder first. */
function apportion(n, weights) {
  const raw = weights.map(w => n * w);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length][1]]++;
  return out;
}

/** Build a fixed-length module with the real domain blueprint, a realistic
 *  difficulty mix and test-day ordering. */
function buildModule(subject, n, mix, filt) {
  const exclude = new Set();
  const out = [];
  const bp = BLUEPRINT[subject];
  let doms = Object.keys(bp);
  if (filt && filt.domains && filt.domains.length)
    doms = doms.filter(d => filt.domains.includes(d));
  if (!doms.length) doms = Object.keys(bp);

  const domN = apportion(n, doms.map(d => bp[d]));
  doms.forEach((dom, di) => {
    const perDiff = apportion(domN[di], mix);
    DIFFS.forEach((d, i) => {
      for (let k = 0; k < perDiff[i]; k++) {
        const q = pickOne(subject, d, exclude, { domains: [dom] });
        if (q) { exclude.add(q.id); out.push(q); }
      }
    });
  });
  // top up if any bucket ran dry
  while (out.length < n) {
    const q = pickOne(subject, DIFFS[1], exclude, filt);
    if (!q) break;
    exclude.add(q.id); out.push(q);
  }
  // test-day ordering: R&W groups by domain, Math ramps easy -> hard
  if (subject === 'rw') {
    out.sort((a, b) => RW_ORDER.indexOf(a.domain) - RW_ORDER.indexOf(b.domain));
  } else {
    out.sort((a, b) => DIFFS.indexOf(a.difficulty) - DIFFS.indexOf(b.difficulty));
  }
  return out;
}

const MIX = { m1: [.30, .45, .25], hard: [.10, .40, .50], easy: [.55, .38, .07] };

/* ══════════════════ session state ══════════════════ */
let SES = null;
let tick = null;

function mkItem(q, subject) {
  return { q, subject, ans: null, marked: false, ko: {}, checked: false, correct: null, ms: 0, t0: 0 };
}

function startAdaptive(subject, filt) {
  SES = {
    mode: 'adaptive', subject, filt: filt || {},
    items: [], idx: 0, timed: false, title: SUBJ[subject] + ' — adaptive practice'
  };
  nextAdaptive();
  openSession();
}

function nextAdaptive() {
  const lvl = Store.state().level[SES.subject];
  const exclude = new Set(SES.items.map(i => i.q.id));
  const q = pickOne(SES.subject, DIFFS[lvl], exclude, SES.filt);
  if (!q) { toast('No more questions match that filter.'); return false; }
  SES.items.push(mkItem(q, SES.subject));
  SES.idx = SES.items.length - 1;
  return true;
}

function startModule(subject) {
  const qs = buildModule(subject, subject === 'rw' ? 27 : 22, MIX.m1);
  SES = {
    mode: 'module', subject,
    items: qs.map(q => mkItem(q, subject)),
    idx: 0, timed: true,
    endsAt: Date.now() + (subject === 'rw' ? 32 : 35) * 60000,
    title: (subject === 'rw' ? 'Section 1' : 'Section 2') + ', Module 1: ' + SUBJ[subject]
  };
  openSession();
}

function startFullTest() {
  SES = {
    mode: 'full', stage: 0, results: [],
    modules: [
      { subject: 'rw', n: 27, min: 32, name: 'Section 1, Module 1: Reading and Writing' },
      { subject: 'rw', n: 27, min: 32, name: 'Section 1, Module 2: Reading and Writing', adapt: true },
      { brk: true, min: 10, name: 'Break' },
      { subject: 'math', n: 22, min: 35, name: 'Section 2, Module 1: Math' },
      { subject: 'math', n: 22, min: 35, name: 'Section 2, Module 2: Math', adapt: true }
    ]
  };
  loadStage();
  openSession();
}

function loadStage() {
  const m = SES.modules[SES.stage];
  if (m.brk) { showBreak(m); return; }
  let mix = MIX.m1;
  if (m.adapt) {
    const prev = SES.results.filter(r => r.subject === m.subject);
    const acc = prev.length ? prev.at(-1).acc : 0.5;
    m.hard = acc >= 0.65;
    mix = m.hard ? MIX.hard : MIX.easy;
  }
  const qs = buildModule(m.subject, m.n, mix);
  SES.subject = m.subject;
  SES.items = qs.map(q => mkItem(q, m.subject));
  SES.idx = 0;
  SES.timed = true;
  SES.endsAt = Date.now() + m.min * 60000;
  SES.title = m.name;
  SES.reviewing = false;
  paintSession();
  startTimer();
}

/* ══════════════════ session UI ══════════════════ */
function openSession() {
  show('test');
  $('#bbUser').textContent = Store.state().name;
  paintSession();
  startTimer();
}

function paintTimer() {
  const t = $('#bbTimer');
  if (!SES) return;
  if (SES.timed && SES.endsAt) {
    const left = Math.max(0, SES.endsAt - Date.now());
    const mm = Math.floor(left / 60000), ss = Math.floor(left / 1000) % 60;
    t.textContent = mm + ':' + String(ss).padStart(2, '0');
    t.classList.toggle('low', left < 5 * 60000);
    return left;
  }
  // untimed practice: show a running score instead of a countdown
  const done = SES.items.filter(i => i.checked).length;
  const right = SES.items.filter(i => i.correct).length;
  t.textContent = done ? right + '/' + done : '—';
  t.classList.remove('low');
  return null;
}

function startTimer() {
  clearInterval(tick);
  tick = setInterval(() => {
    if (!SES) return;
    if (paintTimer() === 0) { clearInterval(tick); onTimeUp(); }
  }, 250);
}

function onTimeUp() {
  if (SES.mode === 'full' && SES.modules[SES.stage].brk) { SES.stage++; loadStage(); return; }
  toast('Time is up for this module.');
  finishModule();
}

function cur() { return SES.items[SES.idx]; }

function paintSession() {
  if (!SES) return;
  const isMath = SES.subject === 'math';
  $$('.math-only').forEach(b => b.hidden = !isMath);
  $('#bbModule').textContent = SES.title;
  $('#bbTimer').classList.toggle('hidden-t', !!SES.timerHidden);
  // untimed practice shows a running tally instead of a countdown
  $('#btnHideTimer').hidden = !SES.timed;
  paintTimer();

  if (SES.reviewing) { paintReviewPage(); return; }

  $('#btnNavigator').hidden = false;
  const it = cur();
  if (!it) return;
  if (!it.t0 && !it.checked) it.t0 = Date.now();
  const q = it.q;
  const body = $('#bbBody'), L = $('#bbLeft'), R = $('#bbRight');

  // ── left pane: R&W passage only ──
  const twoPane = SES.subject === 'rw';
  body.classList.toggle('single', !twoPane);
  if (twoPane) {
    L.innerHTML = '<div class="psg">' + figure(q.passageImgs) +
      paras(q.passage || (q.passageImgs ? '' : q.stem)) + '</div>';
  } else L.innerHTML = '';

  // ── right pane ──
  const practice = SES.mode === 'adaptive';
  let h = '<div class="q-head">' +
    `<div class="q-num">${SES.idx + 1}</div>` +
    `<button class="q-mark${it.marked ? ' on' : ''}" id="qMark">` +
    `${it.marked ? '🔖' : '🏳️'} Mark for Review</button>` +
    `<button class="q-abc${it.abc ? ' on' : ''}" id="qAbc">ABC</button></div>`;

  h += '<div class="q-stem">' +
    (isMath ? imgs(q.stemImgs) : paras(q.prompt || q.stem)) + '</div>';

  if (q.type === 'spr') {
    h += '<div class="spr">' +
      `<input id="sprIn" type="text" autocomplete="off" spellcheck="false" ` +
      `placeholder="Enter your answer" value="${esc(it.ans || '')}"` +
      `${it.checked ? ' disabled' : ''}>` +
      '<div class="preview" id="sprPrev"></div>' +
      '<div class="hint">Student-produced response. Fractions such as <b>3/17</b> and ' +
      'decimals such as <b>0.176</b> are both accepted. If the answer is a repeating ' +
      'decimal, fill the entry box with digits.</div></div>';
  } else {
    h += `<div class="choices${it.abc ? ' abc-on' : ''}" id="choices">`;
    for (const ltr of ['A', 'B', 'C', 'D']) {
      const has = isMath ? (q.choiceImgs && q.choiceImgs[ltr]) : (q.choices && q.choices[ltr]);
      if (!has) continue;
      let cls = 'choice';
      if (it.ans === ltr) cls += ' sel';
      if (it.ko[ltr]) cls += ' ko';
      if (it.checked) {
        if (ltr === q.answer) cls = 'choice good';
        else if (it.ans === ltr) cls = 'choice bad';
      }
      const inner = isMath ? imgs(q.choiceImgs[ltr]) : esc(q.choices[ltr]);
      h += `<button class="${cls}" data-ltr="${ltr}">` +
        `<span class="ltr">${ltr}</span><span class="ctext">${inner}</span>` +
        `<span class="ko-btn" data-ko="${ltr}">${ltr}</span></button>`;
    }
    h += '</div>';
  }

  if (it.checked) h += feedbackHTML(it);
  R.innerHTML = h;
  R.scrollTop = 0;
  if (twoPane) L.scrollTop = 0;

  wireQuestion(it);
  $('#bbQNum').textContent = SES.idx + 1;
  $('#bbQTot').textContent = SES.items.length;
  const nx = $('#btnNext');
  if (practice) {
    nx.textContent = it.checked ? 'Next' : 'Check';
    nx.disabled = !it.checked && it.ans == null;
  } else {
    nx.textContent = SES.idx === SES.items.length - 1 ? 'Review' : 'Next';
    nx.disabled = false;
  }
  $('#btnBack').disabled = SES.idx === 0 || SES.mode === 'adaptive';
}

function feedbackHTML(it) {
  const q = it.q, ok = it.correct;
  const dcls = { Easy: 'e', Medium: 'm', Hard: 'h' }[q.difficulty] || '';
  let h = `<div class="fb ${ok ? 'ok' : 'no'}">` +
    `<h4>${ok ? '✅ Correct' : '❌ Not quite'}` +
    (ok ? ` <span class="xp">+${it.gained} XP</span>` : '') + '</h4>';
  if (!ok) h += `<div style="margin-bottom:10px"><b>Correct answer: ${esc(q.answer)}</b>` +
    (it.ans ? ` · you answered ${esc(it.ans)}` : ' · you left this blank') + '</div>';
  h += '<div class="rat">' + (q.ratImgs ? imgs(q.ratImgs) : paras(q.rationale || '')) + '</div>';
  h += `<div class="fb-meta"><span class="pill ${dcls}">${esc(q.difficulty)}</span>` +
    `<span class="pill">${esc(q.domain)}</span><span class="pill">${esc(q.skill)}</span>`;
  if (it.move === 1) h += '<span class="pill h">⬆ Difficulty up</span>';
  if (it.move === -1) h += '<span class="pill e">⬇ Difficulty eased</span>';
  h += '</div></div>';
  return h;
}

function wireQuestion(it) {
  const ch = $('#choices');
  if (ch) {
    ch.addEventListener('click', e => {
      const ko = e.target.closest('[data-ko]');
      if (ko) {
        e.stopPropagation();
        const l = ko.dataset.ko;
        it.ko[l] = !it.ko[l];
        if (it.ko[l] && it.ans === l) it.ans = null;
        paintSession();
        return;
      }
      const b = e.target.closest('.choice');
      if (!b || it.checked) return;
      it.ans = b.dataset.ltr;
      it.ko[it.ans] = false;
      paintSession();
    });
  }
  const sp = $('#sprIn');
  if (sp) {
    sp.addEventListener('input', () => {
      it.ans = sp.value;
      const v = numOf(sp.value);
      $('#sprPrev').textContent = v == null ? '' : 'Reads as: ' + (Math.round(v * 1e6) / 1e6);
      $('#btnNext').disabled = SES.mode === 'adaptive' && !sp.value.trim();
    });
    sp.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnNext').click(); });
  }
  const mk = $('#qMark');
  if (mk) mk.onclick = () => { it.marked = !it.marked; paintSession(); };
  const abc = $('#qAbc');
  if (abc) abc.onclick = () => { it.abc = !it.abc; paintSession(); };
}

/* ── grading ── */
function grade(it) {
  const q = it.q;
  it.correct = q.type === 'spr' ? checkSPR(it.ans, q.answer) : it.ans === q.answer;
  return it.correct;
}

/** Bank the time spent on the question being left. */
function stopClock() {
  const it = SES && !SES.reviewing && SES.items && SES.items[SES.idx];
  if (it && it.t0) { it.ms += Date.now() - it.t0; it.t0 = 0; }
}

function onNext() {
  const it = cur();
  if (SES.mode === 'adaptive') {
    if (!it.checked) {
      if (it.ans == null || it.ans === '') return;
      stopClock();
      grade(it);
      const r = Store.record(it.q, SES.subject, it.correct, it.ms);
      it.checked = true; it.gained = r.gained; it.move = r.move;
      if (r.levelUp) toast('🎉 Level ' + r.newLevel + '!', 'gold');
      for (const b of r.badges) toast(b.ic + ' Badge unlocked: ' + b.name, 'gold');
      if (r.move === 1) toast('Difficulty increased → ' + DIFFS[Store.state().level[SES.subject]]);
      if (r.move === -1) toast('Difficulty eased → ' + DIFFS[Store.state().level[SES.subject]]);
      paintSession();
      refreshHome();
    } else {
      if (nextAdaptive()) paintSession();
    }
    return;
  }
  // timed module / full test
  stopClock();
  if (SES.idx < SES.items.length - 1) { SES.idx++; paintSession(); }
  else { SES.reviewing = true; paintSession(); }
}

function onBack() {
  if (SES.reviewing) { SES.reviewing = false; paintSession(); return; }
  stopClock();
  if (SES.idx > 0) { SES.idx--; paintSession(); }
}

/* ── end-of-module review page ── */
function paintReviewPage() {
  $('#bbBody').classList.add('single');
  $('#bbLeft').innerHTML = '';
  const done = SES.items.filter(i => i.ans != null && i.ans !== '').length;
  let h = '<div style="max-width:640px;margin:10px auto;text-align:center">' +
    '<h2 style="font-size:23px;margin-bottom:6px">Check Your Work</h2>' +
    '<p style="color:#48505f;font-size:14.5px;line-height:1.6">On test day you can move ' +
    'freely between questions in a module until time runs out. ' +
    `You have answered <b>${done}</b> of <b>${SES.items.length}</b>.</p>` +
    '<div class="legend" style="display:flex;gap:16px;justify-content:center;font-size:12px;' +
    'color:#48505f;margin:16px 0"><span><i style="display:inline-block;width:11px;height:11px;' +
    'border-radius:3px;background:#1a4fd6;margin-right:5px"></i>Answered</span>' +
    '<span><i style="display:inline-block;width:11px;height:11px;border-radius:3px;' +
    'border:1.5px dashed #9aa3b2;margin-right:5px"></i>Unanswered</span>' +
    '<span>🔖 Marked for review</span></div>' +
    '<div class="navgrid" style="justify-content:center">' +
    SES.items.map((it, i) =>
      `<button data-goto="${i}" class="${it.ans != null && it.ans !== '' ? 'ans' : ''}` +
      `${it.marked ? ' mk' : ''}">${i + 1}</button>`).join('') +
    '</div><div style="margin-top:26px">' +
    '<button class="btn primary" id="btnSubmitModule">Submit module</button></div></div>';
  $('#bbRight').innerHTML = h;
  // onclick, not addEventListener: this element persists between paints
  $('#bbRight').onclick = e => {
    const g = e.target.closest('[data-goto]');
    if (g) { SES.reviewing = false; SES.idx = +g.dataset.goto; paintSession(); }
  };
  $('#btnSubmitModule').onclick = finishModule;
  $('#btnNext').textContent = 'Submit';
  $('#btnNext').disabled = false;
  $('#btnBack').disabled = false;
}

function finishModule() {
  clearInterval(tick);
  let correct = 0;
  for (const it of SES.items) {
    grade(it);
    if (it.correct) correct++;
    Store.record(it.q, it.subject, it.correct, it.ms, { noAdapt: SES.mode === 'full' });
  }
  const acc = correct / SES.items.length;

  if (SES.mode === 'full') {
    const m = SES.modules[SES.stage];
    SES.results.push({
      subject: m.subject, correct, total: SES.items.length, acc,
      hard: !!m.hard, items: SES.items
    });
    SES.stage++;
    if (SES.stage < SES.modules.length) { loadStage(); return; }
    return finishFullTest();
  }
  showModuleResults(correct, acc);
}

function showBreak(m) {
  clearInterval(tick);
  const until = Date.now() + m.min * 60000;
  show('test');
  $('#bbBody').classList.add('single');
  $('#bbLeft').innerHTML = '';
  $('#bbModule').textContent = 'Break';
  $$('.math-only').forEach(b => b.hidden = true);
  $('#btnHideTimer').hidden = true;
  $('#btnNext').disabled = true;
  $('#btnBack').disabled = true;
  $('#btnNavigator').hidden = true;
  const paint = () => {
    const left = Math.max(0, until - Date.now());
    const mm = Math.floor(left / 60000), ss = Math.floor(left / 1000) % 60;
    $('#bbTimer').textContent = mm + ':' + String(ss).padStart(2, '0');
    $('#bbRight').innerHTML =
      '<div style="max-width:560px;margin:40px auto;text-align:center">' +
      '<div style="font-size:60px">☕</div>' +
      '<h2 style="font-size:26px;margin:12px 0 8px">Break time</h2>' +
      '<p style="color:#48505f;font-size:15px;line-height:1.65">Stand up, stretch, have some ' +
      'water. The Math section starts automatically when the timer reaches zero.</p>' +
      `<div style="font-size:52px;font-weight:800;margin:22px 0;font-variant-numeric:tabular-nums">` +
      `${mm}:${String(ss).padStart(2, '0')}</div>` +
      '<button class="btn primary" id="btnSkipBreak">Resume now</button></div>';
    $('#btnSkipBreak').onclick = () => { clearInterval(bt); SES.stage++; loadStage(); };
  };
  paint();
  const bt = setInterval(() => {
    if (Date.now() >= until) { clearInterval(bt); SES.stage++; loadStage(); }
    else paint();
  }, 500);
}

/* ══════════════════ scoring ══════════════════ */
function sectionScore(correct, total, hardModule) {
  const p = total ? correct / total : 0;
  const hi = hardModule ? 800 : 620;
  return Math.min(800, Math.max(200,
    Math.round((200 + (hi - 200) * Math.pow(p, 0.9)) / 10) * 10));
}

function finishFullTest() {
  const rw = SES.results.filter(r => r.subject === 'rw');
  const ma = SES.results.filter(r => r.subject === 'math');
  const sum = a => a.reduce((x, y) => x + y.correct, 0);
  const tot = a => a.reduce((x, y) => x + y.total, 0);
  const rwS = sectionScore(sum(rw), tot(rw), rw.some(r => r.hard));
  const mS = sectionScore(sum(ma), tot(ma), ma.some(r => r.hard));
  const rec = {
    t: Date.now(), rwCorrect: sum(rw), rwTotal: tot(rw),
    mCorrect: sum(ma), mTotal: tot(ma), rw: rwS, math: mS, score: rwS + mS
  };
  Store.recordTest(rec);
  const items = SES.results.flatMap(r => r.items);
  showResults({
    title: 'Full practice test complete', score: rec, items,
    sub: `${rec.rwCorrect}/${rec.rwTotal} Reading and Writing · ${rec.mCorrect}/${rec.mTotal} Math`
  });
}

function showModuleResults(correct, acc) {
  showResults({
    title: SES.title + ' — complete',
    sub: `${correct} of ${SES.items.length} correct`,
    simple: { correct, total: SES.items.length, acc },
    items: SES.items.slice()
  });
}

/* ══════════════════ results screen ══════════════════ */
function showResults(o) {
  clearInterval(tick);
  const items = o.items || [];
  let h = `<div class="pg-head"><h1>${esc(o.title)}</h1>` +
    '<button class="btn ghost" id="resHome">← Dashboard</button></div>';

  if (o.score) {
    h += '<div class="score-hero"><div><div class="lbl">Estimated total</div>' +
      `<div class="big">${o.score.score}</div>` +
      '<div style="opacity:.85;font-size:12.5px;margin-top:4px">out of 1600</div></div>' +
      '<div class="score-split">' +
      `<div><span class="lbl">Reading &amp; Writing</span><b>${o.score.rw}</b></div>` +
      `<div><span class="lbl">Math</span><b>${o.score.math}</b></div></div></div>` +
      '<p style="font-size:12.5px;color:#767f90;margin:10px 2px 0">Scaled scores are an ' +
      'estimate. As on test day, the second module you were routed to caps the range.</p>';
  } else if (o.simple) {
    h += '<div class="score-hero"><div><div class="lbl">Score</div>' +
      `<div class="big">${o.simple.correct}<span style="font-size:26px;opacity:.7">/${o.simple.total}</span></div></div>` +
      `<div class="score-split"><div><span class="lbl">Accuracy</span><b>${pct(o.simple.acc)}</b></div></div></div>`;
  }

  // per-domain breakdown for this sitting
  const byDom = {};
  for (const it of items) {
    const k = it.q.domain;
    (byDom[k] = byDom[k] || { name: k, n: 0, c: 0 }).n++;
    byDom[k].c += it.correct ? 1 : 0;
  }
  const rows = Object.values(byDom).map(d => ({ name: d.name, n: d.n, acc: d.c / d.n }));
  h += '<div class="grid2"><div class="box full"><h3>How each area went</h3>' +
    '<div class="sub">Accuracy by domain in this session</div><div id="resDom"></div></div></div>';

  h += '<div class="box full" style="margin-top:16px"><h3>Review every question</h3>' +
    '<div class="sub">Worked solutions from the College Board rationale</div>' +
    items.map((it, i) => reviewItemHTML(it, i)).join('') + '</div>';

  $('#resWrap').innerHTML = h;
  show('results');
  Charts.hbars($('#resDom'), rows.sort((a, b) => a.acc - b.acc));
  $('#resHome').onclick = () => { SES = null; show('home'); refreshHome(); };
  wireReviewToggles($('#resWrap'));
  refreshHome();
}

function reviewItemHTML(it, i) {
  const q = it.q, isMath = it.subject === 'math';
  return `<div class="rev-item ${it.correct ? 'ok' : 'no'}">` +
    `<div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">` +
    `<b>Question ${i + 1}</b>` +
    `<span class="pill ${{ Easy: 'e', Medium: 'm', Hard: 'h' }[q.difficulty]}">${esc(q.difficulty)}</span>` +
    `<span class="pill">${esc(q.skill)}</span>` +
    `<span style="margin-left:auto;font-weight:700;color:${it.correct ? '#12805c' : '#c62d42'}">` +
    `${it.correct ? 'Correct' : 'Incorrect'}</span></div>` +
    `<div class="rev-q">` +
    (isMath ? imgs(q.stemImgs)
      : figure(q.passageImgs) + paras(q.passage || '') + paras(q.prompt || q.stem)) +
    `</div>` +
    `<div style="font-size:13.5px;color:#48505f">Correct answer: <b>${esc(q.answer)}</b>` +
    (it.ans ? ` · your answer: <b>${esc(it.ans)}</b>` : ' · left blank') + '</div>' +
    `<button class="rev-toggle" data-rev="${i}">Show explanation ▾</button>` +
    `<div class="rev-rat" id="rev${i}" hidden>` +
    (q.ratImgs ? imgs(q.ratImgs) : paras(q.rationale || 'No rationale available.')) +
    '</div></div>';
}

function wireReviewToggles(root) {
  root.onclick = e => {
    const b = e.target.closest('[data-rev]');
    if (!b) return;
    const d = root.querySelector('#rev' + b.dataset.rev);
    d.hidden = !d.hidden;
    b.textContent = d.hidden ? 'Show explanation ▾' : 'Hide explanation ▴';
  };
}

/* ══════════════════ home ══════════════════ */
function refreshHome() {
  const s = Store.state();
  const li = Store.levelInfo(s.xp);
  $('#heroName').textContent = s.name;
  $('#lvlNum').textContent = li.level;
  $('#xpNow').textContent = li.into;
  $('#xpNext').textContent = li.need;
  const arc = $('#lvlArc');
  arc.style.strokeDashoffset = 326.7 * (1 - li.into / li.need);

  const all = Store.summary(null);
  const ds = Store.dayStreak();
  $('#stDay').textContent = ds;
  $('#stAns').textContent = all.n;
  $('#stAcc').textContent = pct(all.acc);
  $('#stBest').textContent = s.bestStreak;
  $('#stBadge').textContent = Object.keys(s.badges).length;

  const doneToday = s.days[Store.today()] || 0;
  const goal = s.cfg.goal;
  $('#goalDone').textContent = doneToday;
  $('#goalTarget').textContent = goal;
  $('#goalPct').textContent = Math.min(100, Math.round(doneToday / goal * 100)) + '%';
  $('#goalFill').style.width = Math.min(100, doneToday / goal * 100) + '%';

  $('#heroSub').textContent = all.n
    ? `${all.n} questions answered · ${pct(all.acc)} accuracy · ${ds} day streak`
    : 'Pick a section below to start. Difficulty adapts to how you answer.';

  for (const [k, ids] of [['rw', ['#rwCount', '#rwLevel', '#rwAcc', '#rwBar']],
  ['math', ['#mCount', '#mLevel', '#mAcc', '#mBar']]]) {
    const sm = Store.summary(k);
    $(ids[0]).textContent = `${BANK[k].length.toLocaleString()} questions available` +
      (sm.n ? ` · ${sm.n} answered so far` : '');
    $(ids[1]).textContent = DIFFS[s.level[k]];
    $(ids[2]).textContent = pct(sm.acc);
    $(ids[3]).style.width = (sm.acc == null ? 0 : sm.acc * 100) + '%';
  }
  $('#bankInfo').textContent =
    `${BANK.rw.length.toLocaleString()} Reading and Writing · ${BANK.math.length.toLocaleString()} Math`;

  // recent tests
  const t = s.tests.slice(-3).reverse();
  $('#homeRecent').innerHTML = t.length
    ? '<div class="box"><h3>Recent full tests</h3><table class="tbl"><tr><th>Date</th>' +
    '<th>R&amp;W</th><th>Math</th><th>Total</th></tr>' +
    t.map(x => `<tr><td>${new Date(x.t).toLocaleDateString()}</td><td>${x.rw}</td>` +
      `<td>${x.math}</td><td><b>${x.score}</b></td></tr>`).join('') + '</table></div>'
    : '';
}

/* ══════════════════ progress screen ══════════════════ */
function showProgress() {
  const s = Store.state();
  const rwT = Store.accuracyTrend('rw', 14, 10);
  const mT = Store.accuracyTrend('math', 14, 10);
  const domRW = Store.groupStats('rw', 'd');
  const domM = Store.groupStats('math', 'd');
  const skills = Store.groupStats(null, 'k').filter(g => g.n >= 4);
  const improving = skills.filter(g => g.delta != null && g.delta > 0.05)
    .sort((a, b) => b.delta - a.delta).slice(0, 6);
  const slipping = skills.filter(g => g.delta != null && g.delta < -0.05)
    .sort((a, b) => a.delta - b.delta).slice(0, 6);
  const weakest = skills.slice().sort((a, b) => a.acc - b.acc).slice(0, 8);

  let h = '<div class="pg-head"><h1>Progress &amp; analytics</h1>' +
    '<button class="btn ghost" id="pgHome">← Dashboard</button></div>';

  h += '<div class="grid2">' +
    '<div class="box full"><h3>Accuracy over time</h3>' +
    '<div class="sub">Each point is a block of 10 answered questions; the right-hand ' +
    'edge is your most recent work</div>' +
    '<div id="cAcc"></div></div>' +

    '<div class="box"><h3>Questions per day</h3><div class="sub">Last 30 days</div>' +
    '<div id="cDaily"></div></div>' +

    '<div class="box"><h3>Accuracy by difficulty</h3>' +
    '<div class="sub">Where the adaptive engine has taken you</div>' +
    '<div id="cDiff"></div></div>' +

    '<div class="box"><h3>Reading and Writing domains</h3><div class="sub">Mastery by area</div>' +
    '<div id="cDomRW"></div></div>' +

    '<div class="box"><h3>Math domains</h3><div class="sub">Mastery by area</div>' +
    '<div id="cDomM"></div></div>';

  h += '<div class="box"><h3>📈 Where you are improving</h3>' +
    '<div class="sub">Recent accuracy vs. the block before it</div>' +
    (improving.length
      ? '<table class="tbl">' + improving.map(g =>
        `<tr><td>${esc(g.name)}</td><td style="text-align:right">${pct(g.acc)}</td>` +
        `<td style="text-align:right"><span class="trend up">▲ ${Math.round(g.delta * 100)}pts</span></td></tr>`
      ).join('') + '</table>'
      : '<p style="color:#767f90;font-size:13.5px">Answer more questions in a skill to see a trend.</p>') +
    '</div>';

  h += '<div class="box"><h3>📉 Needs attention</h3>' +
    '<div class="sub">Slipping, or simply your weakest skills</div>' +
    ((slipping.length ? slipping : weakest).length
      ? '<table class="tbl">' + (slipping.length ? slipping : weakest).map(g =>
        `<tr><td>${esc(g.name)}</td><td style="text-align:right">${pct(g.acc)}</td>` +
        `<td style="text-align:right">` +
        (g.delta != null && g.delta < -0.05
          ? `<span class="trend dn">▼ ${Math.round(-g.delta * 100)}pts</span>`
          : `<span class="trend fl">${g.n} q</span>`) + '</td></tr>'
      ).join('') + '</table>'
      : '<p style="color:#767f90;font-size:13.5px">Not enough data yet.</p>') +
    '</div>';

  h += '<div class="box full"><h3>Every skill</h3>' +
    '<div class="sub">Sorted by accuracy — the top of this list is where points are hiding</div>' +
    '<div id="cSkills"></div></div>';

  if (s.tests.length) {
    h += '<div class="box full"><h3>Full test history</h3><table class="tbl">' +
      '<tr><th>Date</th><th>R&amp;W raw</th><th>Math raw</th><th>R&amp;W</th><th>Math</th><th>Total</th></tr>' +
      s.tests.slice().reverse().map(x =>
        `<tr><td>${new Date(x.t).toLocaleString()}</td>` +
        `<td>${x.rwCorrect}/${x.rwTotal}</td><td>${x.mCorrect}/${x.mTotal}</td>` +
        `<td>${x.rw}</td><td>${x.math}</td><td><b>${x.score}</b></td></tr>`).join('') +
      '</table></div>';
  }
  h += '</div>';

  $('#pgWrap').innerHTML = h;
  show('progress');

  Charts.line($('#cAcc'), [
    { name: 'Reading and Writing', color: '#1a4fd6', points: rwT },
    { name: 'Math', color: '#6b3fd4', points: mT }
  ]);
  const daily = Store.dailyCounts(30);
  Charts.bars($('#cDaily'), daily, { color: '#12805c', everyN: 5 });
  Charts.hbars($('#cDiff'), Store.difficultyMix(null));
  Charts.hbars($('#cDomRW'), domRW.length ? domRW : [{ name: 'No data yet', n: 0, acc: null }]);
  Charts.hbars($('#cDomM'), domM.length ? domM : [{ name: 'No data yet', n: 0, acc: null }]);
  Charts.hbars($('#cSkills'), skills.slice().sort((a, b) => a.acc - b.acc)
    .map(g => ({ name: g.name, n: g.n, acc: g.acc })));
  $('#pgHome').onclick = () => show('home');
}

/* ══════════════════ badges ══════════════════ */
function showBadges() {
  const s = Store.state();
  modal('<h3>🏅 Badges</h3><p>Unlocked ' +
    Object.keys(s.badges).length + ' of ' + Store.BADGES.length + '.</p>' +
    '<div class="badges">' + Store.BADGES.map(b =>
      `<div class="badge${s.badges[b.id] ? '' : ' locked'}"><div class="ic">${b.ic}</div>` +
      `<b>${esc(b.name)}</b><span>${esc(b.desc)}</span></div>`).join('') +
    '</div><div class="modal-actions"><button class="btn primary" data-close-modal>Close</button></div>');
}

/* ══════════════════ settings & custom drill ══════════════════ */
function showSettings() {
  const s = Store.state();
  modal('<h3>⚙️ Settings</h3>' +
    `<div class="field"><label>Your name</label><input id="setName" value="${esc(s.name)}"></div>` +
    '<div class="row2">' +
    `<div class="field"><label>Correct in a row to move up</label>` +
    `<input id="setUp" type="number" min="1" max="10" value="${s.cfg.up}"></div>` +
    `<div class="field"><label>Wrong in a row to ease off</label>` +
    `<input id="setDown" type="number" min="1" max="10" value="${s.cfg.down}"></div></div>` +
    `<div class="field"><label>Daily goal (questions)</label>` +
    `<input id="setGoal" type="number" min="1" max="200" value="${s.cfg.goal}"></div>` +
    '<div class="field"><label>Current difficulty</label><div class="row2">' +
    `<select id="setLvlRW">${DIFFS.map((d, i) =>
      `<option value="${i}"${s.level.rw === i ? ' selected' : ''}>R&amp;W: ${d}</option>`).join('')}</select>` +
    `<select id="setLvlM">${DIFFS.map((d, i) =>
      `<option value="${i}"${s.level.math === i ? ' selected' : ''}>Math: ${d}</option>`).join('')}</select>` +
    '</div><div class="note">The engine moves these automatically as you practise.</div></div>' +
    '<div class="modal-actions">' +
    '<button class="btn ghost" id="setReset">Reset all progress</button>' +
    '<button class="btn ghost" data-close-modal>Cancel</button>' +
    '<button class="btn primary" id="setSave">Save</button></div>');

  $('#setSave').onclick = () => {
    const st = Store.state();
    st.name = $('#setName').value.trim() || 'Student';
    st.cfg.up = Math.max(1, +$('#setUp').value || 3);
    st.cfg.down = Math.max(1, +$('#setDown').value || 2);
    st.cfg.goal = Math.max(1, +$('#setGoal').value || 20);
    st.level.rw = +$('#setLvlRW').value;
    st.level.math = +$('#setLvlM').value;
    Store.save();
    closeModal(); refreshHome(); toast('Settings saved');
  };
  $('#setReset').onclick = () => {
    if (confirm('Erase all XP, history and badges? This cannot be undone.')) {
      Store.reset(); closeModal(); refreshHome(); toast('Progress reset');
    }
  };
}

function showCustom() {
  const domainsOf = sub => Array.from(new Set(BANK[sub].map(q => q.domain))).sort();
  const build = sub => domainsOf(sub).map(d =>
    `<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;font-weight:500;margin:5px 0">` +
    `<input type="checkbox" class="cdom" value="${esc(d)}" checked> ${esc(d)}</label>`).join('');

  modal('<h3>Custom drill</h3><p>Target exactly what you want to work on. ' +
    'Difficulty still adapts as you go.</p>' +
    '<div class="field"><label>Section</label>' +
    '<select id="cSub"><option value="rw">Reading and Writing</option>' +
    '<option value="math">Math</option></select></div>' +
    '<div class="field"><label>Domains</label><div id="cDoms">' + build('rw') + '</div></div>' +
    '<div class="modal-actions"><button class="btn ghost" data-close-modal>Cancel</button>' +
    '<button class="btn primary" id="cGo">Start drill</button></div>');

  $('#cSub').onchange = e => { $('#cDoms').innerHTML = build(e.target.value); };
  $('#cGo').onclick = () => {
    const sub = $('#cSub').value;
    const doms = $$('.cdom').filter(c => c.checked).map(c => c.value);
    if (!doms.length) { toast('Pick at least one domain'); return; }
    closeModal();
    startAdaptive(sub, { domains: doms });
  };
}

function showIntro() {
  modal('<h3>👋 Welcome to your SAT trainer</h3>' +
    '<p>Everything here is built from your two College Board question banks — ' +
    `<b>${BANK.rw.length.toLocaleString()}</b> Reading and Writing questions and ` +
    `<b>${BANK.math.length.toLocaleString()}</b> Math questions, each with the official ` +
    'worked solution.</p>' +
    '<ul style="color:#48505f;font-size:14.5px;line-height:1.75;padding-left:20px;margin:0 0 16px">' +
    '<li><b>Adaptive practice</b> — get 3 right in a row and the difficulty steps up; ' +
    'miss 2 in a row and it eases off.</li>' +
    '<li><b>Timed module</b> — one real module against the real clock.</li>' +
    '<li><b>Full test</b> — all four modules, the 10-minute break, and an ' +
    'adaptive second module, exactly like test day.</li>' +
    '<li>Math gets the <b>Desmos calculator</b> and the <b>reference sheet</b>.</li>' +
    '<li>Your progress, XP and badges are saved in this browser on this computer.</li>' +
    '</ul>' +
    '<div class="modal-actions"><button class="btn primary" id="introGo">Let’s go</button></div>');
  $('#introGo').onclick = () => {
    try { localStorage.setItem('sat_seen_intro', '1'); } catch (e) { }
    closeModal();
  };
}

/* ══════════════════ chrome: modal, toast, panels ══════════════════ */
function modal(html) { $('#modalCard').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }

function toast(msg, cls) {
  const d = document.createElement('div');
  d.className = 'toast' + (cls ? ' ' + cls : '');
  d.textContent = msg;
  $('#toastHost').appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; d.style.transition = '.4s'; }, 2200);
  setTimeout(() => d.remove(), 2700);
}

function show(name) {
  $$('.screen').forEach(s => s.classList.remove('on'));
  $('#screen-' + name).classList.add('on');
  window.scrollTo(0, 0);
}

function dragPanel(head) {
  const panel = $('#' + head.dataset.drag);
  let sx, sy, ox, oy, on = false;
  head.addEventListener('mousedown', e => {
    on = true; sx = e.clientX; sy = e.clientY;
    const r = panel.getBoundingClientRect();
    ox = r.left; oy = r.top;
    panel.style.right = 'auto';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!on) return;
    panel.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
    panel.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
  });
  window.addEventListener('mouseup', () => { on = false; });
}

function highlightSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) { toast('Select some text first'); return; }
  const r = sel.getRangeAt(0);
  const host = r.commonAncestorContainer;
  const el = host.nodeType === 1 ? host : host.parentElement;
  if (!el || !el.closest('.bb-pane')) { toast('Only test text can be highlighted'); return; }
  try {
    const m = document.createElement('mark');
    m.className = 'hl';
    m.appendChild(r.extractContents());
    r.insertNode(m);
    sel.removeAllRanges();
  } catch (e) { toast('That selection cannot be highlighted'); }
}

/* ══════════════════ wiring ══════════════════ */
function wire() {
  $$('[data-start]').forEach(b => b.onclick = () => {
    const [sub, mode] = b.dataset.start.split('|');
    if (mode === 'adaptive') startAdaptive(sub);
    else if (mode === 'module') startModule(sub);
    else startFullTest();
  });
  $('#btnCustom').onclick = showCustom;
  $('#btnProgress').onclick = showProgress;
  $('#btnBadges').onclick = showBadges;
  $('#btnSettings').onclick = showSettings;

  $('#btnNext').onclick = onNext;
  $('#btnBack').onclick = onBack;

  $('#btnQuit').onclick = () => {
    if (!SES) { show('home'); return; }
    if (SES.mode === 'adaptive' || confirm('Leave this timed section? Progress on it is lost.')) {
      clearInterval(tick); SES = null; show('home'); refreshHome();
    }
  };
  $('#btnHideTimer').onclick = () => {
    SES.timerHidden = !SES.timerHidden;
    $('#bbTimer').classList.toggle('hidden-t', SES.timerHidden);
    $('#btnHideTimer').textContent = SES.timerHidden ? 'Show' : 'Hide';
  };
  $('#btnHighlight').onclick = highlightSelection;

  $('#btnCalc').onclick = () => {
    const p = $('#panelCalc');
    p.hidden = !p.hidden;
    if (!p.hidden) Reference.mountCalc($('#calcMount'));
  };
  $('#btnRef').onclick = () => {
    const p = $('#panelRef');
    p.hidden = !p.hidden;
    if (!p.hidden && !$('#refMount').innerHTML) $('#refMount').innerHTML = Reference.html();
  };
  $$('[data-close]').forEach(b => b.onclick = () => { $('#' + b.dataset.close).hidden = true; });
  $$('[data-drag]').forEach(dragPanel);

  $('#btnDirections').onclick = () => {
    const p = $('#popDirections');
    p.hidden = !p.hidden;
    if (!p.hidden) {
      p.innerHTML = SES && SES.subject === 'math'
        ? '<b>Directions</b><p style="margin:8px 0 0">The questions in this section address a ' +
        'number of important math skills. Use of a calculator is permitted for all questions. ' +
        'Unless otherwise indicated, all variables and expressions represent real numbers, ' +
        'figures are drawn to scale, and the domain of a given function is the set of all real ' +
        'numbers for which the function is defined.</p>'
        : '<b>Directions</b><p style="margin:8px 0 0">The questions in this section address a ' +
        'number of important reading and writing skills. Each question includes one or more ' +
        'passages, which may include a table or graph. Read each passage and question ' +
        'carefully, then choose the best answer to the question based on the passage(s).</p>';
    }
  };

  $('#btnNavigator').onclick = () => {
    const p = $('#popNavigator');
    p.hidden = !p.hidden;
    if (p.hidden || !SES) return;
    p.innerHTML = '<h4>' + esc(SES.title) + '</h4>' +
      '<div class="legend"><span><i style="background:#1a4fd6"></i>Answered</span>' +
      '<span><i style="border:1.5px dashed #9aa3b2"></i>Unanswered</span>' +
      '<span>🔖 For review</span></div><div class="navgrid">' +
      SES.items.map((it, i) =>
        `<button data-goto="${i}" class="${it.ans != null && it.ans !== '' ? 'ans' : ''}` +
        `${i === SES.idx ? ' cur' : ''}${it.marked ? ' mk' : ''}">${i + 1}</button>`).join('') +
      '</div>';
    p.onclick = e => {
      const g = e.target.closest('[data-goto]');
      if (!g) return;
      if (SES.mode === 'adaptive') { toast('Adaptive practice moves forward only'); return; }
      SES.idx = +g.dataset.goto; SES.reviewing = false; p.hidden = true; paintSession();
    };
  };

  document.addEventListener('click', e => {
    const z = e.target.closest('[data-zoom]');
    if (z) {
      const lb = document.createElement('div');
      lb.className = 'lightbox';
      lb.innerHTML = z.dataset.zoom.split('|')
        .map(src => `<img src="${esc(src)}" alt="">`).join('');
      lb.onclick = () => lb.remove();
      document.body.appendChild(lb);
      return;
    }
    if (e.target.closest('[data-close-modal]')) closeModal();
    if (e.target === $('#modal')) closeModal();
    if (!e.target.closest('#popNavigator') && !e.target.closest('#btnNavigator'))
      $('#popNavigator').hidden = true;
    if (!e.target.closest('#popDirections') && !e.target.closest('#btnDirections'))
      $('#popDirections').hidden = true;
  });

  document.addEventListener('keydown', e => {
    if (!$('#screen-test').classList.contains('on') || !SES || SES.reviewing) return;
    if (e.target.tagName === 'INPUT') return;
    const it = cur();
    if (!it || it.checked) {
      if (e.key === 'Enter') $('#btnNext').click();
      return;
    }
    const k = e.key.toUpperCase();
    if ('ABCD'.includes(k) && it.q.type !== 'spr') {
      it.ans = k; paintSession();
    } else if (e.key === 'Enter') $('#btnNext').click();
  });

  // draggable split
  const split = $('#bbSplit');
  let dragging = false;
  split.addEventListener('mousedown', () => { dragging = true; document.body.style.userSelect = 'none'; });
  window.addEventListener('mouseup', () => { dragging = false; document.body.style.userSelect = ''; });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const b = $('#bbBody').getBoundingClientRect();
    const f = Math.min(0.75, Math.max(0.25, (e.clientX - b.left) / b.width));
    $('#bbLeft').style.flex = `1 1 ${f * 100}%`;
    $('#bbRight').style.flex = `1 1 ${(1 - f) * 100}%`;
  });
}

/* ══════════════════ boot ══════════════════ */
function boot() {
  const note = $('#bootNote');
  if (!window.SAT_ENGLISH && !window.SAT_MATH) {
    document.querySelector('.boot-title').textContent = 'No question bank yet';
    document.querySelector('.boot-bar').style.display = 'none';
    document.querySelector('.boot-card').style.width = '460px';
    note.style.textAlign = 'left';
    note.innerHTML =
      '<p style="margin:0 0 12px">This app ships without questions — you supply your ' +
      'own free export from the College Board question bank. It takes about three ' +
      'minutes:</p>' +
      '<ol style="padding-left:18px;line-height:1.75;margin:0 0 12px">' +
      '<li>Open <a href="https://satsuitequestionbank.collegeboard.org" target="_blank" ' +
      'rel="noopener">satsuitequestionbank.collegeboard.org</a></li>' +
      '<li>Export <b>Reading and Writing</b> to PDF, then <b>Math</b> to PDF</li>' +
      '<li>Put both files in the <code>question-banks</code> folder</li>' +
      '<li>Run <code>py -3 tools/extract.py</code></li>' +
      '<li>Reload this page</li></ol>' +
      '<p style="margin:0">Full instructions are in <code>README.md</code>.</p>';
    return;
  }
  const half = !window.SAT_ENGLISH || !window.SAT_MATH;
  prepare();
  Store.load();
  Store.onSaveError(() => modal(
    '<h3>Progress can’t be saved</h3><p>This browser is blocking local storage for ' +
    'this page, so XP, streaks and history will be lost when you close the tab. ' +
    'Practice itself still works.</p><p>Private-browsing windows and a few browser ' +
    'privacy settings cause this — try opening <code>index.html</code> in a normal ' +
    'Chrome or Edge window.</p>' +
    '<div class="modal-actions"><button class="btn primary" data-close-modal>Got it</button></div>'));
  Store.checkBadges();
  wire();
  refreshHome();
  show('home');
  $('#boot').style.display = 'none';
  if (half) {
    modal('<h3>Only one section loaded</h3>' +
      '<p>The <b>' + (BANK.rw.length ? 'Math' : 'Reading and Writing') + '</b> bank is ' +
      'missing, so that section has no questions. Put both PDF exports in the ' +
      '<code>question-banks</code> folder and run <code>py -3 tools/extract.py</code> ' +
      'again.</p>' +
      '<div class="modal-actions"><button class="btn primary" data-close-modal>' +
      'Continue anyway</button></div>');
    return;
  }
  if (location.hash === '#progress') { showProgress(); return; }
  let seen = null;
  try { seen = localStorage.getItem('sat_seen_intro'); } catch (e) { seen = '1'; }
  if (!seen && !Store.state().attempts.length) showIntro();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
