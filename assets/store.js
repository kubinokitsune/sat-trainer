/* ══════════════════════════════════════════════════════════════════
   store.js — persistent progress, XP/levels, adaptive state, analytics
   Everything lives in localStorage; nothing leaves this machine.
   ══════════════════════════════════════════════════════════════════ */
const Store = (() => {
  const KEY = 'sat_trainer_v1';
  const MAX_ATTEMPTS = 20000;
  const DIFFS = ['Easy', 'Medium', 'Hard'];

  const defaults = () => ({
    v: 1,
    name: 'Felipe',
    savedAt: 0,
    xp: 0,
    attempts: [],          // {t,id,s,d,k,f,c,ms}
    seen: {},              // id -> times served
    level: { rw: 1, math: 1 },
    run: { rw: { up: 0, down: 0 }, math: { up: 0, down: 0 } },
    curStreak: 0,
    bestStreak: 0,
    days: {},
    badges: {},
    tests: [],
    review: {},            // id -> {box,due,miss,sub,last} for questions you got wrong
    fixed: 0,              // questions carried all the way through review
    ability: { rw: { th: 0, n: 0 }, math: { th: 0, n: 0 } },   // logit scale
    skillAbility: {},      // skill -> {th,n}
    cfg: {
      up: 3, down: 2, goal: 20, showTimerPractice: false,
      engine: 'ability',   // 'ability' (Rasch) or 'stepped' (3 up / 2 down)
      target: 0.7          // hit rate the picker aims for
    }
  });

  let s = defaults();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) s = Object.assign(defaults(), JSON.parse(raw));
      // make sure nested defaults survive an older save
      s.cfg = Object.assign(defaults().cfg, s.cfg || {});
      s.level = Object.assign(defaults().level, s.level || {});
      s.run = Object.assign(defaults().run, s.run || {});
      if (!s.review || typeof s.review !== 'object') s.review = {};
      s.fixed = s.fixed || 0;
      s.ability = Object.assign(defaults().ability, s.ability || {});
      if (!s.skillAbility || typeof s.skillAbility !== 'object') s.skillAbility = {};
    } catch (e) { s = defaults(); }
    return s;
  }

  let saveTimer = null;
  let saveBroken = false;
  const changeSubs = [];

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (s.attempts.length > MAX_ATTEMPTS) s.attempts = s.attempts.slice(-MAX_ATTEMPTS);
      s.savedAt = Date.now();
      try {
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch (e) {
        console.warn('save failed', e);
        if (!saveBroken) {
          saveBroken = true;
          if (typeof onSaveError === 'function') onSaveError(e);
        }
      }
      // Mirror to a real file on disk when one is linked. This runs even if
      // localStorage failed, so a full quota is not a total loss.
      for (const fn of changeSubs) { try { fn(s); } catch (e) { /* ignore */ } }
    }, 120);
  }
  let onSaveError = null;

  /** Replace the whole progress state, e.g. from an imported save file. */
  function replace(next) {
    s = Object.assign(defaults(), next || {});
    s.cfg = Object.assign(defaults().cfg, s.cfg || {});
    s.level = Object.assign(defaults().level, s.level || {});
    s.run = Object.assign(defaults().run, s.run || {});
    if (!Array.isArray(s.attempts)) s.attempts = [];
    if (!Array.isArray(s.tests)) s.tests = [];
    if (!s.review || typeof s.review !== 'object') s.review = {};
    s.fixed = s.fixed || 0;
    s.ability = Object.assign(defaults().ability, s.ability || {});
    if (!s.skillAbility || typeof s.skillAbility !== 'object') s.skillAbility = {};
    save();
    return s;
  }

  const state = () => s;
  const today = () => new Date().toISOString().slice(0, 10);

  /* ── XP / levels ─────────────────────────────────────────────── */
  const needFor = L => 100 + (L - 1) * 50;

  function levelInfo(xp) {
    let L = 1, rem = xp;
    while (rem >= needFor(L)) { rem -= needFor(L); L++; }
    return { level: L, into: rem, need: needFor(L) };
  }

  function xpFor(difficulty, correct, combo) {
    if (!correct) return 2;
    const base = { Easy: 10, Medium: 15, Hard: 25 }[difficulty] || 12;
    const mult = Math.min(2, 1 + combo * 0.1);
    return Math.round(base * mult);
  }

  /* ── day streak ──────────────────────────────────────────────── */
  function dayStreak() {
    const d = new Date();
    let n = 0;
    for (;;) {
      const key = d.toISOString().slice(0, 10);
      if (s.days[key]) { n++; d.setDate(d.getDate() - 1); }
      else if (n === 0 && key === today()) { d.setDate(d.getDate() - 1); }
      else break;
      if (n > 3650) break;
    }
    return n;
  }

  /* ── ability estimate (Rasch / 1-parameter IRT) ──────────────────
     Three discrete levels with a 3-up/2-down counter is coarse: it
     oscillates on noise and knows nothing about *which* questions you
     got right. Instead every question carries a difficulty on a logit
     scale and your ability sits on the same scale, so a Hard question
     answered right moves you further than an Easy one, and a Hard one
     missed costs you less than an Easy one.

     P(correct) = 1 / (1 + e^-(theta - b)) — a question at your own
     level is a coin flip, one logit below it is ~73%. */
  const B = { Easy: -1.1, Medium: 0.0, Hard: 1.1 };      // difficulty
  const A = { Easy: 0.8, Medium: 1.0, Hard: 1.35 };      // discrimination
  const GUESS = 0.25;                 // 1 in 4 on a multiple-choice item
  const bOf = d => (d in B ? B[d] : 0);
  const aOf = d => (d in A ? A[d] : 1);
  // Grid-ins cannot be guessed, four-option questions can be.
  const cOf = type => (type === 'spr' ? 0 : GUESS);

  /** 3PL: a floor of c, because a blind guess still lands sometimes. */
  function pCorrect(theta, b, a, c) {
    a = a === undefined ? 1 : a;
    c = c === undefined ? 0 : c;
    return c + (1 - c) / (1 + Math.exp(-a * (theta - b)));
  }

  const THETA_MIN = -3.8, THETA_MAX = 3.5;
  const clampT = t => Math.max(THETA_MIN, Math.min(THETA_MAX, t));

  /** Maximum-likelihood ability for a set of scored responses.

     Discrimination is what makes *which* questions you cleared matter: a
     hard item carries more weight than an easy one, so two students on the
     same raw score separate if one of them got the hard half. The guessing
     floor is what stops random answering from scoring like real ability —
     without it, 25% on four-option questions reads as genuine partial
     knowledge instead of noise. Solved by Fisher scoring. */
  function estimateTheta(responses) {
    if (!responses.length) return 0;
    const right = responses.reduce((n, r) => n + (r.correct ? 1 : 0), 0);
    if (right === 0) return THETA_MIN;          // no finite MLE at the rails
    if (right === responses.length) return THETA_MAX;
    let th = 0;
    for (let i = 0; i < 80; i++) {
      let grad = 0, info = 0;
      for (const r of responses) {
        const a = r.a === undefined ? 1 : r.a;
        const c = r.c === undefined ? 0 : r.c;
        const p = Math.min(1 - 1e-9, Math.max(1e-9, pCorrect(th, r.b, a, c)));
        const w = (p - c) / (1 - c);            // chance it was actually known
        grad += a * ((r.correct ? 1 : 0) - p) * w / p;
        info += a * a * ((1 - p) / p) * w * w;
      }
      if (info < 1e-9) break;
      const step = Math.max(-1, Math.min(1, grad / info));
      th += step;
      if (Math.abs(step) < 1e-5) break;
    }
    return clampT(th);
  }

  const blankAbility = () => ({ th: 0, n: 0 });

  /** Online update after a single answer. Early answers move it fast. */
  function bumpAbility(rec, b, a, c, correct) {
    const k = Math.max(0.07, 0.55 / (1 + rec.n / 12));
    rec.th = clampT(rec.th + k * a * ((correct ? 1 : 0) - pCorrect(rec.th, b, a, c)));
    rec.n++;
    return rec;
  }

  /** Ability for a subject, or for one skill shrunk toward the subject.
     A skill with few answers should not swing wildly on its own. */
  function ability(subject, skill) {
    const sub = s.ability[subject] || blankAbility();
    if (!skill) return sub.th;
    const sk = s.skillAbility[skill];
    if (!sk || !sk.n) return sub.th;
    const W = 5;                                   // prior weight, in answers
    return (sk.th * sk.n + sub.th * W) / (sk.n + W);
  }

  /** The item difficulty that would give the user their target hit rate. */
  function targetB(subject, skill) {
    const want = Math.min(0.9, Math.max(0.5, s.cfg.target || 0.7));
    return ability(subject, skill) - Math.log(want / (1 - want));
  }

  /** Bucket label for display, from where theta sits between the bands. */
  function levelFromTheta(th) {
    if (th < -0.55) return 0;
    if (th < 0.55) return 1;
    return 2;
  }

  /* ── scaled score ────────────────────────────────────────────────
     The digital SAT is IRT-scored: what you scored depends on which
     questions you got right, not just how many. So the section score
     comes from the ability the responses imply, mapped linearly onto
     the 200-800 scale and rounded to the nearest 10 as the real one is.

     Being routed to the easier second module caps the section, which is
     also how test day works. The exact conversion is per-form and not
     published, so this is a faithful model, not the official table. */
  const SCORE_MID = 510, SCORE_PER_LOGIT = 83, EASY_ROUTE_CAP = 650;

  /** Ability -> the 200-800 scale, rounded to 10 as the real one is. */
  function thetaToScore(th) {
    const sc = Math.round((SCORE_MID + SCORE_PER_LOGIT * th) / 10) * 10;
    return Math.max(200, Math.min(800, sc));
  }

  function scaleScore(responses, easyRoute) {
    const th = estimateTheta(responses);
    let sc = thetaToScore(th);
    if (easyRoute) sc = Math.min(sc, EASY_ROUTE_CAP);
    return { score: sc, theta: th };
  }

  /* ── spaced repetition on the ones you missed ────────────────────
     Getting a question wrong schedules it to come back. Each time you
     then get it right it moves up a box and the wait grows; miss it
     again and it drops to the front. The first step is only 10 minutes,
     so a miss comes back inside the same sitting, which is where it
     actually sticks; after that the gaps stretch to 1, 3, 7 and 21 days. */
  const BOXES = [10, 60 * 24, 60 * 24 * 3, 60 * 24 * 7, 60 * 24 * 21]; // minutes
  const MIN = 60000;

  function schedule(q, subject, correct) {
    const r = s.review[q.id];
    if (!correct) {
      const miss = (r ? r.miss : 0) + 1;
      s.review[q.id] = { box: 0, due: Date.now() + BOXES[0] * MIN, miss, sub: subject, last: Date.now() };
      return 'missed';
    }
    if (!r) return null;                       // right first time; nothing to track
    const box = r.box + 1;
    if (box >= BOXES.length) {                 // survived the whole ladder
      delete s.review[q.id];
      s.fixed = (s.fixed || 0) + 1;
      return 'fixed';
    }
    r.box = box;
    r.due = Date.now() + BOXES[box] * MIN;
    r.last = Date.now();
    return 'promoted';
  }

  /** Questions that are due to come back, soonest first. */
  function dueReviews(subject, now) {
    now = now || Date.now();
    const out = [];
    for (const id in s.review) {
      const r = s.review[id];
      if (subject && r.sub !== subject) continue;
      if (r.due <= now) out.push(Object.assign({ id }, r));
    }
    return out.sort((a, b) => a.due - b.due);
  }

  /** Everything still in the review ladder, whether or not it is due. */
  function openMisses(subject) {
    const out = [];
    for (const id in s.review) {
      const r = s.review[id];
      if (subject && r.sub !== subject) continue;
      out.push(Object.assign({ id }, r));
    }
    return out.sort((a, b) => (b.miss - a.miss) || (a.due - b.due));
  }

  const reviewCounts = () => ({
    open: Object.keys(s.review).length,
    due: dueReviews(null).length,
    fixed: s.fixed || 0
  });

  /* ── pacing ──────────────────────────────────────────────────────
     Every attempt already records think time. Anything under a second
     is a mis-click and anything over ten minutes means the tab was left
     open, so both are dropped; the rest is reported as a median because
     one distraction would wreck a mean. */
  const PACE_MIN = 1000, PACE_MAX = 10 * 60000;
  const usableMs = a => a.ms >= PACE_MIN && a.ms <= PACE_MAX;

  function median(xs) {
    if (!xs.length) return null;
    const v = xs.slice().sort((a, b) => a - b);
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  function pacing(sub) {
    const a = forSubject(sub).filter(usableMs);
    return { n: a.length, median: median(a.map(x => x.ms)) };
  }

  /** Median seconds per question grouped by a field, with accuracy. */
  function pacingBy(sub, field) {
    const g = {};
    for (const a of forSubject(sub).filter(usableMs)) {
      const o = (g[a[field]] = g[a[field]] ||
        { name: a[field], ms: [], n: 0, c: 0, subs: {} });
      o.ms.push(a.ms);
      o.n++;
      o.c += a.c;
      o.subs[a.s] = (o.subs[a.s] || 0) + 1;   // which section it belongs to
    }
    return Object.values(g).map(o => ({
      name: o.name, n: o.n, acc: o.c / o.n, median: median(o.ms),
      sub: Object.keys(o.subs).sort((x, y) => o.subs[y] - o.subs[x])[0]
    })).sort((x, y) => y.median - x.median);
  }

  /* ── recording an answer ─────────────────────────────────────── */
  function record(q, subject, correct, ms, opts) {
    opts = opts || {};
    const combo = correct ? s.curStreak : 0;
    const gained = xpFor(q.difficulty, correct, combo);
    const before = levelInfo(s.xp).level;

    s.xp += gained;
    s.attempts.push({
      t: Date.now(), id: q.id, s: subject, d: q.domain, k: q.skill,
      f: DIFFS.indexOf(q.difficulty), c: correct ? 1 : 0, ms: ms | 0
    });
    s.seen[q.id] = (s.seen[q.id] || 0) + 1;
    s.days[today()] = (s.days[today()] || 0) + 1;

    if (correct) { s.curStreak++; s.bestStreak = Math.max(s.bestStreak, s.curStreak); }
    else s.curStreak = 0;

    // ── adaptive difficulty ──
    let move = 0;
    if (!opts.noAdapt) {
      const b = bOf(q.difficulty), a = aOf(q.difficulty), c = cOf(q.type);
      const before2 = s.level[subject];
      // the ability estimate is kept up to date either way, so switching
      // engines in Settings never throws away what you have built up
      s.ability[subject] = bumpAbility(s.ability[subject] || blankAbility(), b, a, c, correct);
      s.skillAbility[q.skill] = bumpAbility(
        s.skillAbility[q.skill] ||
          { th: s.ability[subject].th, n: 0 }, b, a, c, correct);

      if (s.cfg.engine === 'stepped') {
        const r = s.run[subject];
        if (correct) { r.up++; r.down = 0; } else { r.down++; r.up = 0; }
        if (r.up >= s.cfg.up && s.level[subject] < 2) { s.level[subject]++; r.up = 0; }
        else if (r.up >= s.cfg.up) r.up = 0;
        if (r.down >= s.cfg.down && s.level[subject] > 0) { s.level[subject]--; r.down = 0; }
        else if (r.down >= s.cfg.down) r.down = 0;
      } else {
        s.level[subject] = levelFromTheta(s.ability[subject].th);
      }
      move = Math.sign(s.level[subject] - before2);
    }

    const review = schedule(q, subject, correct);

    const after = levelInfo(s.xp).level;
    const badges = checkBadges();
    save();
    return {
      gained, move, levelUp: after > before, newLevel: after, badges,
      combo: s.curStreak, review
    };
  }

  /* ── analytics ───────────────────────────────────────────────── */
  const forSubject = sub => sub ? s.attempts.filter(a => a.s === sub) : s.attempts;

  function summary(sub) {
    const a = forSubject(sub);
    const n = a.length, c = a.reduce((x, y) => x + y.c, 0);
    return { n, correct: c, acc: n ? c / n : null };
  }

  function groupStats(sub, field) {
    const out = {};
    for (const a of forSubject(sub)) {
      const k = a[field];
      (out[k] = out[k] || { n: 0, c: 0, recent: [], name: k }).n++;
      out[k].c += a.c;
      out[k].recent.push(a.c);
    }
    for (const k in out) {
      const o = out[k];
      o.acc = o.c / o.n;
      const r = o.recent;
      const half = Math.min(10, Math.floor(r.length / 2));
      if (half >= 3) {
        const recentA = r.slice(-half).reduce((x, y) => x + y, 0) / half;
        const priorA = r.slice(-2 * half, -half).reduce((x, y) => x + y, 0) / half;
        o.delta = recentA - priorA;
      } else o.delta = null;
    }
    return Object.values(out).sort((x, y) => y.n - x.n);
  }

  /** Accuracy over the last `buckets` chunks of `size` questions.
   *  x is the block's position from the end (0 = most recent) so that two
   *  subjects with different volumes still line up on the same time axis. */
  function accuracyTrend(sub, buckets, size) {
    const a = forSubject(sub);
    const pts = [];
    const total = Math.min(a.length, buckets * size);
    const start = a.length - total;
    for (let i = start; i < a.length; i += size) {
      const chunk = a.slice(i, i + size);
      if (chunk.length < Math.min(size, 3)) break;
      pts.push({
        n: i + chunk.length,
        y: chunk.reduce((p, q) => p + q.c, 0) / chunk.length
      });
    }
    const last = pts.length - 1;
    pts.forEach((p, i) => { p.x = i - last; });   // ..., -2, -1, 0
    return pts;
  }

  function dailyCounts(days) {
    const out = [];
    const d = new Date();
    d.setDate(d.getDate() - days + 1);
    for (let i = 0; i < days; i++) {
      const key = d.toISOString().slice(0, 10);
      out.push({ label: key.slice(5), value: s.days[key] || 0, key });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  function difficultyMix(sub) {
    const out = [0, 0, 0], cor = [0, 0, 0];
    for (const a of forSubject(sub)) {
      if (a.f >= 0) { out[a.f]++; cor[a.f] += a.c; }
    }
    return DIFFS.map((d, i) => ({
      name: d, n: out[i], acc: out[i] ? cor[i] / out[i] : null
    }));
  }

  /* ── badges ──────────────────────────────────────────────────── */
  const BADGES = [
    { id: 'first', ic: '🌱', name: 'First Steps', desc: 'Answer your first question', test: () => s.attempts.length >= 1 },
    { id: 'q50', ic: '📚', name: 'Getting Warm', desc: 'Answer 50 questions', test: () => s.attempts.length >= 50 },
    { id: 'q250', ic: '🔥', name: 'Committed', desc: 'Answer 250 questions', test: () => s.attempts.length >= 250 },
    { id: 'q1000', ic: '🏔️', name: 'Grinder', desc: 'Answer 1000 questions', test: () => s.attempts.length >= 1000 },
    { id: 'run10', ic: '⚡', name: 'On Fire', desc: '10 correct in a row', test: () => s.bestStreak >= 10 },
    { id: 'run25', ic: '☄️', name: 'Unstoppable', desc: '25 correct in a row', test: () => s.bestStreak >= 25 },
    { id: 'hardRW', ic: '📖', name: 'Hard Mode: Verbal', desc: 'Reach Hard in Reading and Writing', test: () => s.level.rw >= 2 },
    { id: 'hardM', ic: '🧮', name: 'Hard Mode: Math', desc: 'Reach Hard in Math', test: () => s.level.math >= 2 },
    { id: 'day3', ic: '📅', name: 'Habit Forming', desc: 'Practise 3 days in a row', test: () => dayStreak() >= 3 },
    { id: 'day7', ic: '🗓️', name: 'Week Warrior', desc: 'Practise 7 days in a row', test: () => dayStreak() >= 7 },
    { id: 'test1', ic: '🎯', name: 'Dress Rehearsal', desc: 'Finish a full practice test', test: () => s.tests.length >= 1 },
    { id: 'test3', ic: '🏆', name: 'Test Day Ready', desc: 'Finish 3 full practice tests', test: () => s.tests.length >= 3 },
    {
      id: 'sharp', ic: '🎖️', name: 'Sharpshooter', desc: '90% accuracy over 100 questions',
      test: () => {
        const a = s.attempts.slice(-100);
        return a.length >= 100 && a.reduce((x, y) => x + y.c, 0) / a.length >= 0.9;
      }
    },
    {
      id: 'master', ic: '👑', name: 'Domain Master', desc: '85%+ in a domain over 30+ questions',
      test: () => groupStats(null, 'd').some(g => g.n >= 30 && g.acc >= 0.85)
    },
    { id: 'score1400', ic: '💎', name: '1400 Club', desc: 'Score 1400+ on a full test', test: () => s.tests.some(t => t.score >= 1400) },

    /* ── volume ── */
    { id: 'q500', ic: '📗', name: 'Halfway Hero', desc: 'Answer 500 questions', test: () => s.attempts.length >= 500 },
    { id: 'q2500', ic: '🗿', name: 'Iron Will', desc: 'Answer 2500 questions', test: () => s.attempts.length >= 2500 },

    /* ── streaks & consistency ── */
    { id: 'run50', ic: '🌠', name: 'Untouchable', desc: '50 correct in a row', test: () => s.bestStreak >= 50 },
    { id: 'day14', ic: '📆', name: 'Fortnight', desc: 'Practise 14 days in a row', test: () => dayStreak() >= 14 },
    { id: 'day30', ic: '🎖️', name: 'Month of Grind', desc: 'Practise 30 days in a row', test: () => dayStreak() >= 30 },
    {
      id: 'goal7', ic: '✅', name: 'Goal Getter', desc: 'Hit your daily goal 7 times',
      test: () => Object.values(s.days).filter(n => n >= (s.cfg.goal || 20)).length >= 7
    },
    {
      id: 'century', ic: '💯', name: 'Century Day', desc: '100 questions in a single day',
      test: () => Object.values(s.days).some(n => n >= 100)
    },

    /* ── accuracy ── */
    {
      id: 'perfect20', ic: '🎯', name: 'Flawless Twenty', desc: '20 in a row without a miss',
      test: () => s.bestStreak >= 20
    },
    {
      id: 'hardAcc', ic: '🧗', name: 'Thin Air', desc: '80%+ on Hard over 50 questions',
      test: () => {
        const a = s.attempts.filter(x => x.f === 2);
        return a.length >= 50 && a.reduce((x, y) => x + y.c, 0) / a.length >= 0.8;
      }
    },
    {
      id: 'comeback', ic: '🔁', name: 'Comeback', desc: 'Follow 3 straight misses with 10 straight hits',
      test: () => {
        let miss = 0;
        for (let i = 0; i < s.attempts.length; i++) {
          if (!s.attempts[i].c) { miss++; continue; }
          if (miss >= 3) {
            let run = 0, j = i;
            while (j < s.attempts.length && s.attempts[j].c) { run++; j++; }
            if (run >= 10) return true;
            i = j;
          }
          miss = 0;
        }
        return false;
      }
    },

    /* ── breadth ── */
    {
      id: 'allDomains', ic: '🧭', name: 'Well Rounded', desc: 'Practise all 8 domains',
      test: () => new Set(s.attempts.map(a => a.d)).size >= 8
    },
    {
      id: 'skill20', ic: '🔬', name: 'Specialist', desc: '20+ questions in 10 different skills',
      test: () => groupStats(null, 'k').filter(g => g.n >= 20).length >= 10
    },
    {
      id: 'twoMasters', ic: '⚖️', name: 'Balanced', desc: '80%+ in both sections over 100 each',
      test: () => ['rw', 'math'].every(sub => {
        const a = forSubject(sub);
        return a.length >= 100 && a.reduce((x, y) => x + y.c, 0) / a.length >= 0.8;
      })
    },

    /* ── test day ── */
    { id: 'score1500', ic: '🌟', name: '1500 Club', desc: 'Score 1500+ on a full test', test: () => s.tests.some(t => t.score >= 1500) },
    {
      id: 'improve100', ic: '📈', name: 'Big Jump', desc: 'Improve 100+ points between full tests',
      test: () => s.tests.some((t, i) => i > 0 && t.score - s.tests[i - 1].score >= 100)
    },

    /* ── habits ── */
    { id: 'backup', ic: '💾', name: 'Safekeeping', desc: 'Save your progress to a file', test: () => !!s.everExported },
    { id: 'fix25', ic: '🔧', name: 'Repair Shop', desc: 'Fix 25 questions you had missed',
      test: () => (s.fixed || 0) >= 25 },
    { id: 'fix100', ic: '🛠️', name: 'Rebuilt', desc: 'Fix 100 questions you had missed',
      test: () => (s.fixed || 0) >= 100 },
    {
      id: 'inbox0', ic: '🧹', name: 'Clean Slate',
      desc: 'Clear every review that was due, with 20+ fixed',
      test: () => (s.fixed || 0) >= 20 && dueReviews(null).length === 0
    },
    {
      id: 'night', ic: '🌙', name: 'Night Owl', desc: 'Answer a question after midnight',
      test: () => s.attempts.some(a => { const h = new Date(a.t).getHours(); return h >= 0 && h < 5; })
    },
    {
      id: 'early', ic: '🌅', name: 'Early Bird', desc: 'Answer a question before 7am',
      test: () => s.attempts.some(a => { const h = new Date(a.t).getHours(); return h >= 5 && h < 7; })
    }
  ];

  function checkBadges() {
    const fresh = [];
    for (const b of BADGES) {
      if (!s.badges[b.id]) {
        let ok = false;
        try { ok = b.test(); } catch (e) { ok = false; }
        if (ok) { s.badges[b.id] = Date.now(); fresh.push(b); }
      }
    }
    return fresh;
  }

  function recordTest(rec) { s.tests.push(rec); checkBadges(); save(); }

  function reset() { s = defaults(); localStorage.removeItem(KEY); }

  return {
    load, save, state, today, DIFFS, BADGES, replace,
    levelInfo, dayStreak, record, recordTest, summary, groupStats,
    accuracyTrend, dailyCounts, difficultyMix, checkBadges, reset,
    dueReviews, openMisses, reviewCounts, pacing, pacingBy,
    ability, targetB, estimateTheta, scaleScore, thetaToScore, bOf, aOf, cOf,
    pCorrect, levelFromTheta,
    onSaveError(fn) { onSaveError = fn; },
    onChange(fn) { changeSubs.push(fn); },
    set(patch) { Object.assign(s, patch); save(); }
  };
})();
