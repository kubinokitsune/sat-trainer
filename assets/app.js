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
/* Question images are cropped straight out of the PDF. They are never lazy:
   a lazy image inside a pane that is still being laid out can be judged
   off-screen and then never load, which showed up as blank answer choices. */
const imgs = list => (list || []).map(src =>
  `<img src="${esc(src)}" alt="" decoding="async">`).join('');
/** Chart passages: full-width render plus a click-to-enlarge affordance. */
const figure = list => !list || !list.length ? '' :
  '<div class="figbox"><button class="figzoom" data-zoom="' + esc(list.join('|')) +
  '">🔍 Enlarge figure</button>' + imgs(list) + '</div>';
/** Math is a picture of typeset maths, so give it its own enlarge button. */
const mathFig = list => !list || !list.length ? '' :
  '<div class="mathfig">' + imgs(list) +
  '<button class="figzoom" data-zoom="' + esc(list.join('|')) + '">🔍 Enlarge</button></div>';
const pct = v => v == null ? '—' : Math.round(v * 100) + '%';

/* ══════════════════ data ══════════════════ */
const BANK = { rw: [], math: [] };
const BY_ID = new Map();          // question id -> {q, subject}
const SUBJ = { rw: 'Reading and Writing', math: 'Math' };

function prepare() {
  BANK.rw = (window.SAT_ENGLISH || []).filter(q => q.choices && Object.keys(q.choices).length === 4);
  BANK.math = (window.SAT_MATH || []);
  for (const k in BANK) for (const q of BANK[k]) { q._s = k; BY_ID.set(q.id, q); }
}

/** Look a question up by id, for anything driven by stored history. */
const qById = id => BY_ID.get(id) || null;

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

/** Difficulty band to serve next, sampled around the user's ability.
 *  The bank only has three bands, so instead of snapping to the nearest
 *  one we weight all three by how close they sit to the difficulty that
 *  would give the target hit rate. Ability drifts smoothly, so the mix
 *  shifts gradually rather than flipping on a single lucky answer. */
function pickDifficulty(subject, skill) {
  if (Store.state().cfg.engine === 'stepped')
    return DIFFS[Store.state().level[subject]];
  const want = Store.targetB(subject, skill);
  const w = DIFFS.map(d => Math.exp(-Math.abs(Store.bOf(d) - want) / 0.7));
  const total = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < DIFFS.length; i++) {
    r -= w[i];
    if (r <= 0) return DIFFS[i];
  }
  return DIFFS[1];
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
  // Top up if any bucket ran dry. A module has to be exactly n questions, so
  // widen the difficulty before giving up, and only stop when the whole
  // filtered pool really is exhausted.
  for (const d of [DIFFS[1], DIFFS[0], DIFFS[2], null]) {
    while (out.length < n) {
      const q = pickOne(subject, d, exclude, filt);
      if (!q || exclude.has(q.id)) break;
      exclude.add(q.id); out.push(q);
    }
    if (out.length >= n) break;
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

/** A question you previously missed that is due to come back, if any. */
function pickDueReview(subject, exclude, filt) {
  for (const r of Store.dueReviews(subject)) {
    if (exclude.has(r.id)) continue;
    const q = qById(r.id);
    if (!q) continue;                                  // bank changed under us
    if (filt && filt.skills && filt.skills.length && !filt.skills.includes(q.skill)) continue;
    if (filt && filt.domains && filt.domains.length && !filt.domains.includes(q.domain)) continue;
    return q;
  }
  return null;
}

function nextAdaptive() {
  const exclude = new Set(SES.items.map(i => i.q.id));
  // Roughly a third of a practice run is spent back on things you got wrong.
  // Without this a missed question is never served again: the picker prefers
  // unseen questions, and with a bank this size there are always unseen ones.
  let q = null, isReview = false;
  if (Math.random() < 0.3) {
    q = pickDueReview(SES.subject, exclude, SES.filt);
    isReview = !!q;
  }
  if (!q) q = pickOne(SES.subject, pickDifficulty(SES.subject), exclude, SES.filt);
  if (!q) { toast('No more questions match that filter.'); return false; }
  const it = mkItem(q, SES.subject);
  it.isReview = isReview;
  SES.items.push(it);
  SES.idx = SES.items.length - 1;
  return true;
}

/** Fixed-length drill from an arbitrary skill filter. */
function buildDrill(subject, filt, n, difficulty) {
  const exclude = new Set();
  const out = [];
  const diffs = difficulty ? [difficulty] : DIFFS;
  const per = apportion(n, difficulty ? [1] : MIX.m1);
  diffs.forEach((d, i) => {
    for (let k = 0; k < per[i]; k++) {
      const q = pickOne(subject, d, exclude, filt);
      if (q) { exclude.add(q.id); out.push(q); }
    }
  });
  while (out.length < n) {
    const q = pickOne(subject, difficulty || DIFFS[1], exclude, filt);
    if (!q || exclude.has(q.id)) break;      // pool exhausted
    exclude.add(q.id); out.push(q);
  }
  for (let i = out.length - 1; i > 0; i--) {   // interleave difficulties
    const j = (Math.random() * (i + 1)) | 0;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function startDrill(subject, filt, n, difficulty, seconds) {
  const qs = buildDrill(subject, filt, n, difficulty);
  if (!qs.length) { toast('No questions match that selection.'); return; }
  const timed = !!seconds;
  SES = {
    mode: 'drill', subject, filt,
    items: qs.map(q => mkItem(q, subject)),
    idx: 0,
    timed,
    practice: !timed,
    endsAt: timed ? Date.now() + seconds * 1000 : 0,
    title: SUBJ[subject] + ' — custom drill · ' + qs.length + ' questions' +
      (timed ? ' · ' + mmss(seconds) : '')
  };
  if (qs.length < n) toast('Only ' + qs.length + ' questions matched that selection.');
  openSession();
}

/** Work through questions you have missed. `ids` overrides the due list. */
function startReview(subject, ids) {
  let qs;
  if (ids && ids.length) {
    qs = ids.map(qById).filter(Boolean);
  } else {
    qs = Store.dueReviews(subject).map(r => qById(r.id)).filter(Boolean);
  }
  if (!qs.length) { toast('Nothing is due for review right now.'); return; }
  const sub = qs[0]._s;
  SES = {
    mode: 'drill', subject: sub, filt: {},
    items: qs.map(q => { const it = mkItem(q, q._s); it.isReview = true; return it; }),
    idx: 0, timed: false, practice: true, endsAt: 0,
    title: 'Review · ' + qs.length + ' question' + (qs.length === 1 ? '' : 's') +
      ' you missed'
  };
  openSession();
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
    // Route on the ability module 1 implies, not on raw correct: clearing the
    // hard half of an easier module should still send you up.
    const prev = SES.results.filter(r => r.subject === m.subject);
    const last = prev.at(-1);
    const responses = last ? last.items.map(it => ({
      b: Store.bOf(it.q.difficulty), a: Store.aOf(it.q.difficulty),
      c: Store.cOf(it.q.type), correct: !!it.correct
    })) : [];
    m.hard = responses.length ? Store.estimateTheta(responses) >= 0 : false;
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
  // a review session can mix sections, so follow the question on screen
  const shown = SES.items[SES.idx];
  const subj = (shown && shown.subject) || SES.subject;
  const isMath = subj === 'math';
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
  const twoPane = subj === 'rw';
  body.classList.toggle('single', !twoPane);
  if (twoPane) {
    L.innerHTML = '<div class="psg">' + figure(q.passageImgs) +
      paras(q.passage || (q.passageImgs ? '' : q.stem)) + '</div>';
  } else L.innerHTML = '';

  // ── right pane ──
  const practice = SES.mode === 'adaptive' || !!SES.practice;
  let h = '<div class="q-head">' +
    `<div class="q-num">${SES.idx + 1}</div>` +
    (it.isReview ? '<span class="q-rev" title="You missed this one before">🔁 Review</span>' : '') +
    `<button class="q-mark${it.marked ? ' on' : ''}" id="qMark">` +
    `${it.marked ? '🔖' : '🏳️'} Mark for Review</button>` +
    `<button class="q-abc${it.abc ? ' on' : ''}" id="qAbc">ABC</button></div>`;

  h += '<div class="q-stem">' +
    (isMath ? mathFig(q.stemImgs) : paras(q.prompt || q.stem)) + '</div>';

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

/** Split an official rationale into the main explanation and the per-choice
 *  notes that follow it ("Choice A is incorrect because ..."). The bank writes
 *  these consistently, so a miss just leaves the text whole. */
function splitRationale(text, answer) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const re = /(Choices?\s+([A-D])(?:\s*,\s*[A-D])*(?:\s*,?\s*and\s+[A-D])?\s+(?:is|are)\s+(?:incorrect|the best answer|correct))/g;
  const cuts = [];
  let m;
  while ((m = re.exec(t))) cuts.push({ at: m.index, letter: m[2], head: m[1] });
  if (!cuts.length) return { main: t, notes: [] };
  const main = t.slice(0, cuts[0].at).trim();
  const notes = cuts.map((c, i) => ({
    letter: c.letter,
    text: t.slice(c.at, i + 1 < cuts.length ? cuts[i + 1].at : t.length).trim()
  }));
  // Anything before the first "Choice X ..." is the real explanation. If the
  // rationale opens with it instead, that first block explains the key.
  if (!main) {
    const first = notes.shift();
    return { main: first.text, notes };
  }
  return { main, notes };
}

function feedbackHTML(it) {
  const q = it.q, ok = it.correct;
  const dcls = { Easy: 'e', Medium: 'm', Hard: 'h' }[q.difficulty] || '';
  const yours = q.type === 'spr'
    ? (it.ans ? `“${esc(it.ans)}”` : 'blank')
    : (it.ans ? esc(it.ans) : 'blank');

  let h = `<div class="fb ${ok ? 'ok' : 'no'}">`;

  // ── verdict ──
  h += '<div class="fb-top">' +
    `<div class="fb-verdict">${ok ? '✅ Correct' : '❌ Not quite'}</div>` +
    (ok && it.gained ? `<span class="xp">+${it.gained} XP</span>` : '') +
    '</div>';

  // ── your answer vs the key ──
  h += '<div class="fb-ans">' +
    `<span class="fb-chip ${ok ? 'good' : 'bad'}"><i>Your answer</i><b>${yours}</b></span>` +
    (ok ? '' : `<span class="fb-chip good"><i>Correct answer</i><b>${esc(q.answer)}</b></span>`) +
    '</div>';

  // ── explanation ──
  const split = q.ratImgs ? null : splitRationale(q.rationale, q.answer);
  h += '<div class="fb-sec"><h5>Why the answer is ' + esc(q.answer) + '</h5>';
  if (q.ratImgs) h += '<div class="rat">' + mathFig(q.ratImgs) + '</div>';
  else if (split) h += '<div class="rat">' + paras(split.main) + '</div>';
  else h += '<div class="rat"><p>No explanation was included for this question.</p></div>';
  h += '</div>';

  if (split && split.notes.length) {
    h += '<details class="fb-why"' + (ok ? '' : ' open') + '><summary>' +
      'Why the other choices are wrong</summary><div class="fb-notes">' +
      split.notes.map(n => {
        const mine = !ok && n.letter === it.ans;
        return `<div class="fb-note${mine ? ' mine' : ''}">` +
          `<span class="ltr">${esc(n.letter)}</span><p>${esc(n.text)}` +
          (mine ? ' <b>← this is the one you picked</b>' : '') + '</p></div>';
      }).join('') + '</div></details>';
  }

  h += `<div class="fb-meta"><span class="pill ${dcls}">${esc(q.difficulty)}</span>` +
    `<span class="pill">${esc(q.domain)}</span><span class="pill">${esc(q.skill)}</span>`;
  if (it.move === 1) h += '<span class="pill h">⬆ Difficulty up</span>';
  if (it.move === -1) h += '<span class="pill e">⬇ Difficulty eased</span>';
  if (it.review === 'missed') h += '<span class="pill r">🔁 Back for review</span>';
  if (it.review === 'promoted') h += '<span class="pill g">🔁 Review passed</span>';
  if (it.review === 'fixed') h += '<span class="pill g">✔ Fixed for good</span>';
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
  if (SES.mode === 'adaptive' || SES.practice) {
    if (!it.checked) {
      if (it.ans == null || it.ans === '') return;
      stopClock();
      grade(it);
      const r = Store.record(it.q, it.subject, it.correct, it.ms);
      it.checked = true; it.gained = r.gained; it.move = r.move; it.review = r.review;
      if (r.review === 'fixed') toast('✔ Fixed — that one is out of your review list', 'gold');
      if (r.levelUp) toast('🎉 Level ' + r.newLevel + '!', 'gold');
      for (const b of r.badges) toast(b.ic + ' Badge unlocked: ' + b.name, 'gold');
      if (r.move === 1) toast('Difficulty increased → ' + DIFFS[Store.state().level[it.subject]]);
      if (r.move === -1) toast('Difficulty eased → ' + DIFFS[Store.state().level[it.subject]]);
      paintSession();
      refreshHome();
      return;
    }
    if (SES.mode === 'adaptive') { if (nextAdaptive()) paintSession(); return; }
    // fixed-length untimed drill
    if (SES.idx < SES.items.length - 1) { SES.idx++; paintSession(); }
    else finishDrill();
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

/** Untimed drill: every answer was already graded and recorded as it went. */
function finishDrill() {
  clearInterval(tick);
  const correct = SES.items.filter(i => i.correct).length;
  showModuleResults(correct, correct / SES.items.length);
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
      adaptive: !!m.adapt, hard: !!m.hard, items: SES.items
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
/** Score a section the way the digital SAT does: from *which* questions
 *  were answered correctly, not merely how many.
 *
 *  Every item carries a difficulty, the responses give a maximum-likelihood
 *  ability, and that maps onto the 200-800 scale. Two students on 30/44
 *  therefore do not score the same if one of them cleared the hard items.
 *  Being routed to the easier second module caps the section, as on test day.
 *
 *  The real conversion is per-form and unpublished, so this is a faithful
 *  model of the method rather than an official table. */
function sectionScore(results) {
  const responses = [];
  for (const r of results) {
    for (const it of r.items) {
      responses.push({
        b: Store.bOf(it.q.difficulty), a: Store.aOf(it.q.difficulty),
        c: Store.cOf(it.q.type), correct: !!it.correct
      });
    }
  }
  const easyRoute = results.some(r => r.adaptive && !r.hard);
  const out = Store.scaleScore(responses, easyRoute);
  return { score: out.score, theta: out.theta, easyRoute, n: responses.length };
}

function finishFullTest() {
  const rw = SES.results.filter(r => r.subject === 'rw');
  const ma = SES.results.filter(r => r.subject === 'math');
  const sum = a => a.reduce((x, y) => x + y.correct, 0);
  const tot = a => a.reduce((x, y) => x + y.total, 0);
  const rwS = sectionScore(rw);
  const mS = sectionScore(ma);
  const rec = {
    t: Date.now(), rwCorrect: sum(rw), rwTotal: tot(rw),
    mCorrect: sum(ma), mTotal: tot(ma),
    rw: rwS.score, math: mS.score, score: rwS.score + mS.score,
    rwTheta: +rwS.theta.toFixed(2), mTheta: +mS.theta.toFixed(2),
    rwEasy: rwS.easyRoute, mEasy: mS.easyRoute
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
/** Explain the score, because it is deliberately not raw-correct / total. */
function scoreNoteHTML(sc) {
  const routed = [];
  if (sc.rwEasy != null) routed.push(['Reading and Writing', sc.rwEasy]);
  if (sc.mEasy != null) routed.push(['Math', sc.mEasy]);
  let h = '<div class="score-note"><b>How this was scored</b>' +
    '<p>Like the digital SAT, this is not raw-correct out of total. Every ' +
    'question carries a difficulty, and the section score comes from the ' +
    'ability your answers imply, so clearing the hard ones counts for more — ' +
    'two people on the same raw score typically land 10–20 points apart. ' +
    'Blind guesses are discounted too: a four-option question lands one time ' +
    'in four on its own, so answering at random scores near the floor rather ' +
    'than in the middle.</p>';
  if (routed.length) {
    h += '<p>' + routed.map(([name, easy]) =>
      `<b>${name}:</b> you were routed to the ${easy ? 'easier' : 'harder'} ` +
      'second module' + (easy ? ', which caps the section at 650 as it does on test day' : '')
    ).join('<br>') + '.</p>';
  }
  h += '<p class="score-caveat">The College Board does not publish its conversion, ' +
    'and it changes per form, so treat this as a well-modelled estimate rather ' +
    'than an official score.</p></div>';
  return h;
}

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
      scoreNoteHTML(o.score);
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

  // questions you missed and owe a second look
  const rc = Store.reviewCounts();
  const cta = $('#reviewCta');
  if (cta) {
    cta.hidden = !rc.open;
    if (rc.open) {
      cta.innerHTML = '<div class="rv-l"><b>🔁 ' + rc.due + ' question' +
        (rc.due === 1 ? '' : 's') + ' ready for review</b><span>' + rc.open +
        ' still open · ' + rc.fixed + ' fixed for good</span></div>' +
        (rc.due ? '<button class="btn small primary" id="rvGo">Review now</button>'
                : '<span class="rv-wait">Next one is not due yet</span>');
      const g = $('#rvGo');
      if (g) g.onclick = () => startReview(null);
    }
  }

  // save-file state, so an unbacked-up streak is visible without digging
  const sv = $('#saveState');
  if (sv) {
    if (SaveFile.isLinked()) {
      sv.className = 'save-state on';
      sv.innerHTML = `💾 Auto-saving to <b>${esc(SaveFile.name())}</b>`;
    } else if (!all.n) {
      sv.className = 'save-state';
      sv.innerHTML = '';
    } else {
      sv.className = 'save-state warn';
      sv.innerHTML = '⚠️ Progress is only in this browser. ' +
        '<button class="lnk" id="saveNow">Save it to a file</button>';
      const b = $('#saveNow');
      if (b) b.onclick = async () => {
        try { const n = await SaveFile.exportNow(); toast('Saved to ' + n); refreshHome(); }
        catch (e) { if (e && e.name !== 'AbortError') toast('Could not save', 'bad'); }
      };
    }
  }

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
/* ══════════════════ ability ══════════════════ */
/** Where the adaptive engine currently places you, and what that would be
 *  worth on the 200-800 scale if a whole section went the same way. */
function abilityHTML() {
  const st = Store.state();
  const rows = ['rw', 'math'].filter(k => (st.ability[k] || {}).n);
  if (!rows.length) {
    return '<div class="box full"><h3>🎯 Where you are working</h3>' +
      '<div class="sub">Your practice level on the difficulty scale</div>' +
      '<p class="empty">Answer some questions and this fills in.</p></div>';
  }
  const stepped = st.cfg.engine === 'stepped';
  let h = '<div class="box full"><h3>🎯 Where you are working</h3>' +
    '<div class="sub">' + (stepped
      ? 'Stepped mode is picking your questions, but the ability estimate is ' +
        'still tracked underneath.'
      : 'The difficulty the picker is aiming at, and what that pace would be ' +
        'worth across a full section.') + '</div><div class="abl-rows">';

  for (const k of rows) {
    const th = Store.ability(k);
    const band = DIFFS[Store.levelFromTheta(th)];
    const sc = Store.thetaToScore(th);
    const pos = Math.max(0, Math.min(100, (th + 2.5) / 5 * 100));
    h += '<div class="abl-row"><div class="abl-head">' +
      `<b>${SUBJ[k]}</b><span class="pill ${{ Easy: 'e', Medium: 'm', Hard: 'h' }[band]}">` +
      `${band}</span><span class="abl-sc">~${sc}</span></div>` +
      '<div class="ability-track"><i class="ability-dot" style="left:' + pos.toFixed(1) + '%"></i></div>' +
      '<div class="ability-ends"><span>Easier</span><span>Harder</span></div>' +
      `<div class="note">${st.ability[k].n.toLocaleString()} answers · ` +
      `aiming for ${Math.round((st.cfg.target || .7) * 100)}% right</div></div>`;
  }
  h += '</div><p class="score-caveat" style="margin-top:12px">The ~score is what ' +
    'this ability implies on the 200–800 scale — a rough read from practice, not ' +
    'a test result. Sit a full test for a proper one.</p></div>';
  return h;
}

/* ══════════════════ pacing ══════════════════ */
const secs = ms => ms == null ? '—' : (ms / 1000).toFixed(0) + 's';

/** How long you take per question, against the pace the real test allows. */
function pacingHTML() {
  const rows = [];
  for (const sub of ['rw', 'math']) {
    const p = Store.pacing(sub);
    if (!p.n) continue;
    const target = PACE[sub] * 1000;
    const diff = p.median - target;
    rows.push({ sub, ...p, target, diff });
  }
  if (!rows.length) {
    return '<div class="box full"><h3>⏱️ Pacing</h3>' +
      '<div class="sub">How long you take per question</div>' +
      '<p class="empty">Answer some questions and your timings show up here.</p></div>';
  }

  let h = '<div class="box full"><h3>⏱️ Pacing</h3>' +
    '<div class="sub">Median think time per question, against the pace the real ' +
    'test allows. Timings under a second or over ten minutes are ignored.</div>' +
    '<div class="pace-cards">';
  for (const r of rows) {
    const over = r.diff > 0;
    const pctOff = Math.round(Math.abs(r.diff) / r.target * 100);
    h += '<div class="pace-card">' +
      `<div class="pace-sub">${SUBJ[r.sub]}</div>` +
      `<div class="pace-big ${over ? 'over' : 'under'}">${secs(r.median)}</div>` +
      `<div class="pace-target">test pace ${secs(r.target)}</div>` +
      `<div class="pace-delta ${over ? 'over' : 'under'}">` +
      `${over ? '▲' : '▼'} ${secs(Math.abs(r.diff))} ${over ? 'slower' : 'faster'} ` +
      `(${pctOff}%)</div>` +
      `<div class="pace-note">${r.n.toLocaleString()} timed answers</div></div>`;
  }
  h += '</div>';

  // Slow *and* inaccurate is where the points actually are.
  const skills = Store.pacingBy(null, 'k').filter(g => g.n >= 5);
  if (skills.length) {
    // Rank by what a fix is worth: slow and wrong costs more than slow and right.
    const worst = skills.slice()
      .sort((a, b) => (b.median * (1 - b.acc)) - (a.median * (1 - a.acc)))
      .slice(0, 8);
    h += '<div class="sub" style="margin-top:18px">Where your time is going, and ' +
      'whether it is buying you anything</div><table class="tbl pace-tbl">' +
      '<tr><th>Skill</th><th>Median</th><th>vs pace</th><th>Accuracy</th><th>Verdict</th></tr>' +
      worst.map(g => {
        const target = PACE[g.sub || 'rw'] * 1000;
        const rel = g.median / target;
        const slow = rel > 1.15, weak = g.acc < 0.7;
        let verdict, cls;
        if (slow && weak) { verdict = 'Biggest win here'; cls = 'dn'; }
        else if (slow) { verdict = 'Slow but solid'; cls = 'fl'; }
        else if (weak) { verdict = 'Rushing it'; cls = 'dn'; }
        else { verdict = 'On pace'; cls = 'up'; }
        const off = Math.round((rel - 1) * 100);
        return `<tr><td>${esc(g.name)}</td><td>${secs(g.median)}</td>` +
          `<td class="${off > 0 ? 'over' : 'under'}">${off > 0 ? '+' : ''}${off}%</td>` +
          `<td>${pct(g.acc)}</td><td><span class="trend ${cls}">${verdict}</span></td></tr>`;
      }).join('') + '</table>';
  }
  return h + '</div>';
}

/* ══════════════════ mistake bank ══════════════════ */
let MB_FILTER = { sub: '', skill: '', only: 'open' };

function mistakeBankHTML() {
  const c = Store.reviewCounts();
  let list = Store.openMisses(MB_FILTER.sub || null)
    .map(r => ({ r, q: qById(r.id) }))
    .filter(x => x.q);
  if (MB_FILTER.skill) list = list.filter(x => x.q.skill === MB_FILTER.skill);
  if (MB_FILTER.only === 'due') list = list.filter(x => x.r.due <= Date.now());

  const skills = Array.from(new Set(Store.openMisses(MB_FILTER.sub || null)
    .map(x => (qById(x.id) || {}).skill).filter(Boolean))).sort();

  let h = '<div class="box full mb" id="mbBox"><h3>🗂️ Mistake bank</h3>' +
    '<div class="sub">Every question you have missed and not yet fixed. ' +
    'Getting one right moves it further down the queue; miss it again and it ' +
    'comes straight back.</div>';

  h += '<div class="mb-stats">' +
    `<div><b>${c.open}</b><span>still open</span></div>` +
    `<div><b>${c.due}</b><span>due now</span></div>` +
    `<div><b>${c.fixed}</b><span>fixed for good</span></div>` +
    '</div>';

  if (!c.open && !c.fixed) {
    return h + '<p class="empty">Nothing here yet — miss a question and it lands ' +
      'in this list until you can get it right.</p></div>';
  }

  h += '<div class="mb-bar">' +
    '<select id="mbSub"><option value="">Both sections</option>' +
    `<option value="rw"${MB_FILTER.sub === 'rw' ? ' selected' : ''}>Reading and Writing</option>` +
    `<option value="math"${MB_FILTER.sub === 'math' ? ' selected' : ''}>Math</option></select>` +
    '<select id="mbSkill"><option value="">All skills</option>' +
    skills.map(k => `<option value="${esc(k)}"${MB_FILTER.skill === k ? ' selected' : ''}>` +
      `${esc(k)}</option>`).join('') + '</select>' +
    '<select id="mbOnly">' +
    `<option value="open"${MB_FILTER.only === 'open' ? ' selected' : ''}>All open</option>` +
    `<option value="due"${MB_FILTER.only === 'due' ? ' selected' : ''}>Due now</option></select>` +
    (list.length
      ? `<button class="btn small primary" id="mbGo">Practise these (${list.length})</button>`
      : '') +
    '</div>';

  if (!list.length) {
    return h + '<p class="empty">Nothing matches that filter.' +
      (c.due ? '' : ' Everything you have missed is waiting out its review interval.') +
      '</p></div>';
  }

  h += '<div class="mb-list">' + list.slice(0, 60).map(({ r, q }) => {
    const due = r.due <= Date.now();
    const when = due ? 'due now' : 'due ' + relDate(r.due);
    return `<div class="mb-item" data-mbid="${esc(q.id)}">` +
      '<div class="mb-row">' +
      `<span class="mb-sub ${q._s}">${q._s === 'math' ? 'Math' : 'R&amp;W'}</span>` +
      `<span class="mb-skill">${esc(q.skill)}</span>` +
      `<span class="pill ${{ Easy: 'e', Medium: 'm', Hard: 'h' }[q.difficulty] || ''}">` +
      `${esc(q.difficulty)}</span>` +
      `<span class="mb-miss">missed ${r.miss}×</span>` +
      `<span class="mb-due${due ? ' now' : ''}">${when}</span>` +
      '<span class="mb-open">▸</span></div>' +
      '<div class="mb-body" hidden></div></div>';
  }).join('') + '</div>';
  if (list.length > 60)
    h += `<p class="empty">Showing the first 60 of ${list.length}.</p>`;
  return h + '</div>';
}

function relDate(ts) {
  const d = Math.round((ts - Date.now()) / 60000);
  if (d < 60) return 'in ' + d + ' min';
  if (d < 60 * 24) return 'in ' + Math.round(d / 60) + ' h';
  return 'in ' + Math.round(d / (60 * 24)) + ' d';
}

/** Full question + official explanation, for an expanded mistake-bank row. */
function mistakeDetailHTML(q) {
  const isMath = q._s === 'math';
  let h = '<div class="mb-q">';
  if (!isMath && q.passage) h += '<div class="mb-psg">' + paras(q.passage) + '</div>';
  if (!isMath && q.passageImgs) h += figure(q.passageImgs);
  h += '<div class="mb-stem">' +
    (isMath ? mathFig(q.stemImgs) : paras(q.prompt || q.stem)) + '</div>';
  if (q.type === 'spr') {
    h += `<div class="mb-ans">Answer: <b>${esc(q.answer)}</b></div>`;
  } else {
    h += '<div class="mb-choices">';
    for (const l of ['A', 'B', 'C', 'D']) {
      const has = isMath ? (q.choiceImgs && q.choiceImgs[l]) : (q.choices && q.choices[l]);
      if (!has) continue;
      h += `<div class="mb-ch${l === q.answer ? ' good' : ''}">` +
        `<span class="ltr">${l}</span><span class="ctext">` +
        (isMath ? imgs(q.choiceImgs[l]) : esc(q.choices[l])) + '</span></div>';
    }
    h += '</div>';
  }
  const split = q.ratImgs ? null : splitRationale(q.rationale, q.answer);
  h += '<div class="fb-sec" style="margin-top:14px"><h5>Why the answer is ' +
    esc(q.answer) + '</h5><div class="rat">' +
    (q.ratImgs ? mathFig(q.ratImgs)
      : split ? paras(split.main) : '<p>No explanation available.</p>') + '</div></div>';
  if (split && split.notes.length) {
    h += '<details class="fb-why"><summary>Why the other choices are wrong</summary>' +
      '<div class="fb-notes">' + split.notes.map(n =>
        `<div class="fb-note"><span class="ltr">${esc(n.letter)}</span>` +
        `<p>${esc(n.text)}</p></div>`).join('') + '</div></details>';
  }
  return h + '</div>';
}

function wireMistakeBank() {
  const box = $('#mbBox');
  if (!box) return;
  const re = () => { $('#pgWrap'); showProgress(); };
  const sub = $('#mbSub'), sk = $('#mbSkill'), on = $('#mbOnly'), go = $('#mbGo');
  if (sub) sub.onchange = e => { MB_FILTER.sub = e.target.value; MB_FILTER.skill = ''; re(); };
  if (sk) sk.onchange = e => { MB_FILTER.skill = e.target.value; re(); };
  if (on) on.onchange = e => { MB_FILTER.only = e.target.value; re(); };
  if (go) go.onclick = () => {
    let list = Store.openMisses(MB_FILTER.sub || null)
      .map(r => ({ r, q: qById(r.id) })).filter(x => x.q);
    if (MB_FILTER.skill) list = list.filter(x => x.q.skill === MB_FILTER.skill);
    if (MB_FILTER.only === 'due') list = list.filter(x => x.r.due <= Date.now());
    startReview(null, list.slice(0, 40).map(x => x.q.id));
  };
  box.addEventListener('click', e => {
    const row = e.target.closest('.mb-row');
    if (!row) return;
    const item = row.parentElement;
    const body = item.querySelector('.mb-body');
    const q = qById(item.dataset.mbid);
    if (!q) return;
    if (body.hidden && !body.innerHTML) body.innerHTML = mistakeDetailHTML(q);
    body.hidden = !body.hidden;
    item.classList.toggle('open', !body.hidden);
  });
}

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

  h += abilityHTML();
  h += pacingHTML();
  h += mistakeBankHTML();

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

  h += '<footer class="pg-foot">Drawn from <b>' + s.attempts.length.toLocaleString() +
    '</b> answered questions, out of a bank of <b>' + BANK.rw.length.toLocaleString() +
    '</b> Reading and Writing and <b>' + BANK.math.length.toLocaleString() +
    '</b> Math.</footer>';

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
  wireMistakeBank();
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

/* ══════════════════ save files ══════════════════ */
function paintSaveBox() {
  const box = $('#sfBox');
  if (!box) return;
  const linked = SaveFile.isLinked();
  let h = '<div class="sf-state ' + (linked ? 'on' : '') + '">' +
    (linked
      ? `<b>💾 Auto-saving to ${esc(SaveFile.name())}</b>` +
        '<span>Every answer is written to that file as you go.</span>'
      : '<b>⚠️ Not linked to a file</b>' +
        '<span>Progress is only in this browser right now.</span>') +
    '</div><div class="sf-btns">';
  if (SaveFile.supported)
    h += `<button class="btn small ${linked ? 'ghost' : 'primary'}" id="sfLink">` +
      (linked ? 'Change file…' : 'Link a save file…') + '</button>';
  else
    h += '<button class="btn small primary" id="sfDl">Download save file</button>';
  h += '<button class="btn small ghost" id="sfImp">Load from file…</button>';
  if (SaveFile.supported)
    h += '<button class="btn small ghost" id="sfDl">Download a copy</button>';
  h += '</div>' +
    '<div class="note" style="margin-top:8px">Tip: save it as <code>data/save.js</code> ' +
    'inside this folder and the app restores it by itself next time you open it.</div>';
  box.innerHTML = h;

  const link = $('#sfLink'), imp = $('#sfImp'), dl = $('#sfDl');
  if (link) link.onclick = async () => {
    try { const n = await SaveFile.link(); toast('Auto-saving to ' + n); paintSaveBox(); refreshHome(); }
    catch (e) { if (e && e.name !== 'AbortError') toast('Could not link that file', 'bad'); }
  };
  if (dl) dl.onclick = () => { SaveFile.download(); toast('Save file downloaded'); refreshHome(); };
  if (imp) imp.onclick = async () => {
    let data;
    try { data = await SaveFile.importNow(); }
    catch (e) { if (e && e.name !== 'AbortError') toast(e.message || 'Could not read that file', 'bad'); return; }
    confirmRestore(data, () => { paintSaveBox(); });
  };
}

/** Never silently overwrite existing progress with an older file. */
function confirmRestore(data, after) {
  const cur = Store.state();
  const theirs = data.savedAt || (data.state && data.state.savedAt) || 0;
  const mine = cur.savedAt || 0;
  const n = (data.state.attempts || []).length;
  const older = theirs && mine && theirs < mine;
  modal('<h3>Restore progress?</h3>' +
    `<p>That file holds <b>${n.toLocaleString()}</b> answered questions` +
    (theirs ? `, last saved <b>${new Date(theirs).toLocaleString()}</b>` : '') + '.</p>' +
    `<p>You currently have <b>${cur.attempts.length.toLocaleString()}</b> here` +
    (mine ? `, last saved <b>${new Date(mine).toLocaleString()}</b>` : '') + '.</p>' +
    (older ? '<p class="warn-line">⚠️ The file is <b>older</b> than what is in this ' +
      'browser. Restoring will lose the newer work.</p>' : '') +
    '<p>Restoring replaces everything currently here.</p>' +
    '<div class="modal-actions"><button class="btn ghost" data-close-modal>Cancel</button>' +
    '<button class="btn primary" id="rsGo">Restore</button></div>');
  $('#rsGo').onclick = () => {
    Store.replace(data.state);
    closeModal(); refreshHome();
    toast('Progress restored — ' + n.toLocaleString() + ' questions');
    if (typeof after === 'function') after();
  };
}

/** On launch: data/save.js, if present, is a save the user parked there. */
function autoloadSave() {
  const f = window.SAT_SAVE;
  if (!f || !f.state) return;
  const cur = Store.state();
  const theirs = f.savedAt || f.state.savedAt || 0;
  const mine = cur.savedAt || 0;
  const fileN = (f.state.attempts || []).length;
  if (!cur.attempts.length && fileN) {          // nothing here — just load it
    Store.replace(f.state);
    toast('💾 Progress restored from data/save.js');
    return;
  }
  if (theirs > mine + 1000 && fileN !== cur.attempts.length) confirmRestore(f);
}

/* ══════════════════ settings & custom drill ══════════════════ */
function showSettings() {
  const s = Store.state();
  modal('<h3>⚙️ Settings</h3>' +
    `<div class="field"><label>Your name</label><input id="setName" value="${esc(s.name)}"></div>` +
    '<div class="field"><label>How practice picks the next question</label>' +
    '<select id="setEngine">' +
    `<option value="ability"${s.cfg.engine !== 'stepped' ? ' selected' : ''}>` +
    'Ability estimate — smooth (recommended)</option>' +
    `<option value="stepped"${s.cfg.engine === 'stepped' ? ' selected' : ''}>` +
    'Stepped — a set number right moves up</option></select>' +
    '<div class="note" id="engNote"></div></div>' +

    '<div class="field" id="abilityBox">' +
    `<label>How hard it should feel — aim to get <b id="tgtLbl">${Math.round((s.cfg.target || .7) * 100)}%</b> right</label>` +
    `<input type="range" class="rng" id="setTarget" min="50" max="88" step="2" ` +
    `value="${Math.round((s.cfg.target || .7) * 100)}">` +
    '<div class="note">Lower is a harder, more stretching mix; higher keeps you ' +
    'on ground you have already covered.</div></div>' +

    '<div class="row2" id="steppedBox">' +
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
    '<div class="sec-rule"><span>Save file</span></div>' +
    '<p class="note" style="margin:0 0 10px">Your progress lives in this browser. ' +
    'Keep a copy on disk so it survives clearing site data, and so you can ' +
    'move it to another computer.</p>' +
    '<div id="sfBox"></div>' +
    '<div class="modal-actions">' +
    '<button class="btn ghost" id="setReset">Reset all progress</button>' +
    '<button class="btn ghost" data-close-modal>Cancel</button>' +
    '<button class="btn primary" id="setSave">Save</button></div>');

  paintSaveBox();

  // the two engines have different knobs, so only show the relevant ones
  const syncEngine = () => {
    const ability = $('#setEngine').value !== 'stepped';
    $('#abilityBox').hidden = !ability;
    $('#steppedBox').hidden = ability;
    $('#engNote').textContent = ability
      ? 'Every question has a difficulty; your ability sits on the same scale and ' +
        'moves further for a hard question than an easy one.'
      : 'The original behaviour: a run of correct answers steps the level up, a ' +
        'run of wrong ones steps it down.';
  };
  $('#setEngine').onchange = syncEngine;
  $('#setTarget').oninput = e => {
    $('#tgtLbl').textContent = e.target.value + '%';
  };
  syncEngine();

  $('#setSave').onclick = () => {
    const st = Store.state();
    st.name = $('#setName').value.trim() || 'Student';
    st.cfg.engine = $('#setEngine').value;
    st.cfg.target = (+$('#setTarget').value || 70) / 100;
    st.cfg.up = Math.max(1, +$('#setUp').value || 3);
    st.cfg.down = Math.max(1, +$('#setDown').value || 2);
    st.cfg.goal = Math.max(1, +$('#setGoal').value || 20);
    // Setting the band by hand also moves the ability estimate to the middle
    // of it, otherwise the next answer would snap the display straight back.
    for (const [sub, sel] of [['rw', '#setLvlRW'], ['math', '#setLvlM']]) {
      const want = +$(sel).value;
      if (want !== st.level[sub]) {
        st.level[sub] = want;
        st.ability[sub] = { th: Store.bOf(DIFFS[want]), n: st.ability[sub].n };
      }
    }
    Store.save();
    closeModal(); refreshHome(); toast('Settings saved');
  };
  $('#setReset').onclick = () => {
    if (confirm('Erase all XP, history and badges? This cannot be undone.')) {
      Store.reset(); closeModal(); refreshHome(); toast('Progress reset');
    }
  };
}

/* Seconds per question the real test allows, used to size drill timers. */
const PACE = { rw: 32 * 60 / 27, math: 35 * 60 / 22 };
const mmss = sec => Math.floor(sec / 60) + ':' + String(Math.round(sec) % 60).padStart(2, '0');

/** Topic tree: every skill in the section, grouped by domain, with counts. */
function taxonomy(sub) {
  const byDom = {};
  for (const q of BANK[sub]) {
    const d = (byDom[q.domain] = byDom[q.domain] || { name: q.domain, n: 0, skills: {} });
    d.n++;
    d.skills[q.skill] = (d.skills[q.skill] || 0) + 1;
  }
  return Object.values(byDom)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(d => ({
      name: d.name, n: d.n,
      skills: Object.entries(d.skills)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, n]) => ({ name, n }))
    }));
}

function showCustom() {
  const state = { sub: 'rw', diff: '', n: 15, timed: false, mins: 0 };

  const treeHTML = sub => taxonomy(sub).map((d, i) => {
    const id = 'dom' + i;
    return '<div class="tp-dom">' +
      `<label class="tp-head"><input type="checkbox" class="tp-all" data-dom="${id}" checked>` +
      `<b>${esc(d.name)}</b><span class="tp-n">${d.n}</span></label>` +
      '<div class="tp-skills">' + d.skills.map(s =>
        `<label class="tp-skill"><input type="checkbox" class="tp-sk" data-dom="${id}" ` +
        `value="${esc(s.name)}" checked><span>${esc(s.name)}</span>` +
        `<span class="tp-n">${s.n}</span></label>`).join('') +
      '</div></div>';
  }).join('');

  modal('<h3>Custom drill</h3>' +
    '<p>Pick exactly what you want to work on, how many questions, and whether ' +
    'the clock is running.</p>' +

    '<div class="row2">' +
    '<div class="field"><label>Section</label>' +
    '<select id="cSub"><option value="rw">Reading and Writing</option>' +
    '<option value="math">Math</option></select></div>' +
    '<div class="field"><label>Difficulty</label>' +
    '<select id="cDiff"><option value="">Mixed (test-like)</option>' +
    DIFFS.map(d => `<option value="${d}">${d} only</option>`).join('') +
    '</select></div></div>' +

    '<div class="field"><div class="tp-bar"><label>Topics</label>' +
    '<span><button type="button" class="lnk" id="cAll">Select all</button> · ' +
    '<button type="button" class="lnk" id="cNone">Clear</button></span></div>' +
    '<div class="tp-tree" id="cTree">' + treeHTML('rw') + '</div>' +
    '<div class="note" id="cAvail"></div></div>' +

    '<div class="field"><label>Questions — <b id="cNLbl">15</b></label>' +
    '<input type="range" id="cN" min="5" max="60" step="1" value="15" class="rng"></div>' +

    '<div class="field"><label class="chk"><input type="checkbox" id="cTimed"> ' +
    'Practise against a clock</label>' +
    '<div id="cTimeWrap" hidden>' +
    '<input type="range" id="cMins" class="rng" min="1" max="2" step="1" value="1">' +
    '<div class="note" id="cTimeLbl"></div></div></div>' +

    '<div class="modal-actions"><button class="btn ghost" data-close-modal>Cancel</button>' +
    '<button class="btn primary" id="cGo">Start drill</button></div>', 'wide-modal');

  const picked = () => $$('#cTree .tp-sk').filter(c => c.checked).map(c => c.value);

  function avail() {
    const sk = picked();
    if (!sk.length) return 0;
    const f = { skills: sk };
    if (state.diff) f.difficulty = state.diff;
    return pool(state.sub, f).length;
  }

  function syncTime() {
    const rec = state.n * PACE[state.sub];
    const lo = Math.max(60, Math.round(rec * 0.5 / 30) * 30);
    const hi = Math.round(rec * 2 / 30) * 30;
    const sl = $('#cMins');
    sl.min = lo; sl.max = hi; sl.step = 30;
    if (!state.mins || state.mins < lo || state.mins > hi) state.mins = Math.round(rec / 30) * 30;
    sl.value = state.mins;
    $('#cTimeLbl').innerHTML =
      `<b>${mmss(state.mins)}</b> for ${state.n} questions ` +
      `(${(state.mins / state.n).toFixed(0)}s each) · test pace is ` +
      `<b>${mmss(rec)}</b> · allowed ${mmss(lo)}–${mmss(hi)}`;
  }

  function sync() {
    const a = avail();
    const sk = picked();
    $('#cNLbl').textContent = state.n;
    $('#cAvail').textContent = sk.length
      ? `${a.toLocaleString()} question${a === 1 ? '' : 's'} match this selection` +
        (a < state.n ? ' — fewer than you asked for, the drill will be shorter' : '')
      : 'Pick at least one topic.';
    $('#cAvail').classList.toggle('warn', !sk.length || a < state.n);
    $('#cGo').disabled = !sk.length || a === 0;
    if (state.timed) syncTime();
  }

  $('#cSub').onchange = e => {
    state.sub = e.target.value;
    $('#cTree').innerHTML = treeHTML(state.sub);
    sync();
  };
  $('#cDiff').onchange = e => { state.diff = e.target.value; sync(); };
  $('#cN').oninput = e => { state.n = +e.target.value; sync(); };
  $('#cMins').oninput = e => { state.mins = +e.target.value; syncTime(); };
  $('#cTimed').onchange = e => {
    state.timed = e.target.checked;
    $('#cTimeWrap').hidden = !state.timed;
    if (state.timed) syncTime();
  };
  $('#cAll').onclick = () => { $$('#cTree input').forEach(c => c.checked = true); sync(); };
  $('#cNone').onclick = () => { $$('#cTree input').forEach(c => c.checked = false); sync(); };

  // domain header toggles its skills; a skill toggles its header back
  $('#cTree').onchange = e => {
    const t = e.target;
    if (t.classList.contains('tp-all'))
      $$(`#cTree .tp-sk[data-dom="${t.dataset.dom}"]`).forEach(c => c.checked = t.checked);
    if (t.classList.contains('tp-sk')) {
      const sibs = $$(`#cTree .tp-sk[data-dom="${t.dataset.dom}"]`);
      const head = $(`#cTree .tp-all[data-dom="${t.dataset.dom}"]`);
      head.checked = sibs.some(c => c.checked);
      head.indeterminate = head.checked && sibs.some(c => !c.checked);
    }
    sync();
  };

  $('#cGo').onclick = () => {
    const sk = picked();
    if (!sk.length) { toast('Pick at least one topic'); return; }
    const filt = { skills: sk };
    closeModal();
    startDrill(state.sub, filt, state.n, state.diff, state.timed ? state.mins : 0);
  };

  sync();
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
function modal(html, cls) {
  const card = $('#modalCard');
  card.className = 'modal-card' + (cls ? ' ' + cls : '');
  card.innerHTML = html;
  card.scrollTop = 0;
  $('#modal').hidden = false;
}
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
      p.innerHTML = SES && SES.items[SES.idx] && SES.items[SES.idx].subject === 'math'
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
  SaveFile.onStatus(refreshHome);
  SaveFile.onError(() => toast('Lost the link to the save file — re-link it in Settings', 'bad'));
  wire();
  autoloadSave();
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
