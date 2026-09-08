/* ══════════════════════════════════════════════════════════════════
   charts.js — dependency-free inline SVG charts (works offline)
   ══════════════════════════════════════════════════════════════════ */
const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, a) => {
    const e = document.createElementNS(NS, n);
    for (const k in (a || {})) e.setAttribute(k, a[k]);
    return e;
  };
  const esc = s => String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** Multi-series accuracy line chart. series=[{name,color,points:[{x,y}]}] */
  function line(mount, series, opt) {
    opt = Object.assign({ h: 220, yFmt: v => Math.round(v * 100) + '%', yMax: 1, yMin: 0 }, opt);
    mount.innerHTML = '';
    const W = mount.clientWidth || 520, H = opt.h;
    const P = { t: 14, r: 14, b: 26, l: 38 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });

    const all = series.flatMap(s => s.points);
    if (!all.length) {
      mount.innerHTML = '<div class="sub" style="padding:26px 0;text-align:center">' +
        'Not enough data yet — answer a few questions.</div>';
      return;
    }
    const xs = all.map(p => p.x);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const span = (xMax - xMin) || 1;
    const X = v => P.l + ((v - xMin) / span) * iw;
    const Y = v => P.t + ih - ((v - opt.yMin) / (opt.yMax - opt.yMin)) * ih;

    for (let i = 0; i <= 4; i++) {
      const v = opt.yMin + (i / 4) * (opt.yMax - opt.yMin);
      svg.appendChild(el('line', {
        x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v),
        stroke: '#eef1f5', 'stroke-width': 1
      }));
      const t = el('text', {
        x: P.l - 7, y: Y(v) + 4, 'text-anchor': 'end',
        'font-size': 10.5, fill: '#767f90'
      });
      t.textContent = opt.yFmt(v);
      svg.appendChild(t);
    }

    for (const s of series) {
      if (s.points.length < 2) {
        for (const p of s.points)
          svg.appendChild(el('circle', { cx: X(p.x), cy: Y(p.y), r: 3.5, fill: s.color }));
        continue;
      }
      const d = s.points.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
      const area = d + ` L${X(s.points.at(-1).x).toFixed(1)} ${Y(opt.yMin)} L${X(s.points[0].x).toFixed(1)} ${Y(opt.yMin)} Z`;
      svg.appendChild(el('path', { d: area, fill: s.color, opacity: .09 }));
      svg.appendChild(el('path', {
        d, fill: 'none', stroke: s.color, 'stroke-width': 2.4,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }));
      for (const p of s.points) {
        const c = el('circle', { cx: X(p.x), cy: Y(p.y), r: 3.2, fill: '#fff', stroke: s.color, 'stroke-width': 2 });
        const ti = el('title');
        ti.textContent = `${s.name}: ${opt.yFmt(p.y)}` +
          (p.n ? ` (at ${p.n} questions answered)` : '');
        c.appendChild(ti);
        svg.appendChild(c);
      }
    }
    mount.appendChild(svg);

    if (series.length > 1) {
      const lg = document.createElement('div');
      lg.style.cssText = 'display:flex;gap:16px;justify-content:center;margin-top:8px;font-size:12px;color:#48505f';
      lg.innerHTML = series.map(s =>
        `<span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${s.color};margin-right:5px"></i>${esc(s.name)}</span>`
      ).join('');
      mount.appendChild(lg);
    }
  }

  /** Vertical bar chart. data=[{label,value}] */
  function bars(mount, data, opt) {
    opt = Object.assign({ h: 180, color: '#1a4fd6', everyN: 1 }, opt);
    mount.innerHTML = '';
    const W = mount.clientWidth || 520, H = opt.h;
    const P = { t: 12, r: 8, b: 24, l: 30 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
    const max = Math.max(1, ...data.map(d => d.value));
    const bw = iw / data.length;

    [0, max].forEach(v => {
      const y = P.t + ih - (v / max) * ih;
      svg.appendChild(el('line', { x1: P.l, x2: W - P.r, y1: y, y2: y, stroke: '#eef1f5' }));
      const t = el('text', { x: P.l - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 10.5, fill: '#767f90' });
      t.textContent = v;
      svg.appendChild(t);
    });

    data.forEach((d, i) => {
      const h = (d.value / max) * ih;
      const x = P.l + i * bw + bw * 0.18;
      const w = bw * 0.64;
      const r = el('rect', {
        x, y: P.t + ih - h, width: Math.max(1.5, w), height: Math.max(d.value ? 2 : 0, h),
        fill: opt.color, rx: 3, opacity: d.value ? 1 : .25
      });
      const ti = el('title'); ti.textContent = `${d.label}: ${d.value}`;
      r.appendChild(ti);
      svg.appendChild(r);
      if (i % opt.everyN === 0) {
        const t = el('text', {
          x: x + w / 2, y: H - 7, 'text-anchor': 'middle',
          'font-size': 9.5, fill: '#767f90'
        });
        t.textContent = d.label;
        svg.appendChild(t);
      }
    });
    mount.appendChild(svg);
  }

  /** Horizontal grouped comparison used for the difficulty mix. */
  function hbars(mount, rows) {
    mount.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'mastery';
    for (const r of rows) {
      const pct = r.acc == null ? 0 : Math.round(r.acc * 100);
      const col = r.acc == null ? '#c8ced8'
        : r.acc >= .8 ? '#12805c' : r.acc >= .6 ? '#b7791f' : '#c62d42';
      const d = document.createElement('div');
      d.className = 'm-row';
      d.innerHTML =
        `<div><div class="m-name">${esc(r.name)}<small>${r.n} question${r.n === 1 ? '' : 's'}` +
        `${r.sub ? ' · ' + esc(r.sub) : ''}</small></div>` +
        `<div class="m-bar"><i style="width:${pct}%;background:${col}"></i></div></div>` +
        `<div class="m-val">${r.acc == null ? '—' : pct + '%'}</div>`;
      wrap.appendChild(d);
    }
    mount.appendChild(wrap);
  }

  return { line, bars, hbars };
})();
