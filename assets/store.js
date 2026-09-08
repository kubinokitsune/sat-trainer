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
    cfg: { up: 3, down: 2, goal: 20, showTimerPractice: false }
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
    } catch (e) { s = defaults(); }
    return s;
  }

  let saveTimer = null;
  let saveBroken = false;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        if (s.attempts.length > MAX_ATTEMPTS) s.attempts = s.attempts.slice(-MAX_ATTEMPTS);
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch (e) {
        console.warn('save failed', e);
        if (!saveBroken) {
          saveBroken = true;
          if (typeof onSaveError === 'function') onSaveError(e);
        }
      }
    }, 120);
  }
  let onSaveError = null;

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
      const r = s.run[subject];
      if (correct) { r.up++; r.down = 0; } else { r.down++; r.up = 0; }
      if (r.up >= s.cfg.up && s.level[subject] < 2) { s.level[subject]++; r.up = 0; move = 1; }
      else if (r.up >= s.cfg.up) r.up = 0;
      if (r.down >= s.cfg.down && s.level[subject] > 0) { s.level[subject]--; r.down = 0; move = -1; }
      else if (r.down >= s.cfg.down) r.down = 0;
    }

    const after = levelInfo(s.xp).level;
    const badges = checkBadges();
    save();
    return { gained, move, levelUp: after > before, newLevel: after, badges, combo: s.curStreak };
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
    { id: 'score1400', ic: '💎', name: '1400 Club', desc: 'Score 1400+ on a full test', test: () => s.tests.some(t => t.score >= 1400) }
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
    load, save, state, today, DIFFS, BADGES,
    levelInfo, dayStreak, record, recordTest, summary, groupStats,
    accuracyTrend, dailyCounts, difficultyMix, checkBadges, reset,
    onSaveError(fn) { onSaveError = fn; },
    set(patch) { Object.assign(s, patch); save(); }
  };
})();
