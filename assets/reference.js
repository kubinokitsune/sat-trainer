/* ══════════════════════════════════════════════════════════════════
   reference.js — the reference sheet supplied on the digital SAT Math
   section, plus the Desmos graphing calculator used in Bluebook.
   ══════════════════════════════════════════════════════════════════ */
const Reference = (() => {

  const FIGS = [
    {
      f: 'A = πr²,  C = 2πr',
      svg: `<svg width="86" height="66" viewBox="0 0 86 66">
        <circle cx="43" cy="33" r="25" fill="none" stroke="#12161f" stroke-width="1.6"/>
        <line x1="43" y1="33" x2="68" y2="33" stroke="#12161f" stroke-width="1.4"/>
        <circle cx="43" cy="33" r="2" fill="#12161f"/>
        <text x="54" y="29" font-size="11" font-style="italic">r</text></svg>`
    },
    {
      f: 'A = ℓw',
      svg: `<svg width="86" height="66" viewBox="0 0 86 66">
        <rect x="16" y="16" width="54" height="34" fill="none" stroke="#12161f" stroke-width="1.6"/>
        <text x="40" y="61" font-size="11" font-style="italic">&#8467;</text>
        <text x="75" y="37" font-size="11" font-style="italic">w</text></svg>`
    },
    {
      f: 'A = ½bh',
      svg: `<svg width="86" height="66" viewBox="0 0 86 66">
        <path d="M14 52 L72 52 L46 14 Z" fill="none" stroke="#12161f" stroke-width="1.6"/>
        <line x1="46" y1="14" x2="46" y2="52" stroke="#12161f" stroke-width="1.2" stroke-dasharray="3 3"/>
        <text x="40" y="63" font-size="11" font-style="italic">b</text>
        <text x="50" y="36" font-size="11" font-style="italic">h</text></svg>`
    },
    {
      f: 'c² = a² + b²',
      svg: `<svg width="86" height="66" viewBox="0 0 86 66">
        <path d="M18 52 L66 52 L18 16 Z" fill="none" stroke="#12161f" stroke-width="1.6"/>
        <path d="M18 46 L24 46 L24 52" fill="none" stroke="#12161f" stroke-width="1.2"/>
        <text x="38" y="63" font-size="11" font-style="italic">b</text>
        <text x="8" y="36" font-size="11" font-style="italic">a</text>
        <text x="45" y="30" font-size="11" font-style="italic">c</text></svg>`
    },
    {
      f: 'Special right triangle',
      lbl: '30°–60°–90°',
      svg: `<svg width="86" height="66" viewBox="0 0 86 66">
        <path d="M20 52 L66 52 L20 18 Z" fill="none" stroke="#12161f" stroke-width="1.6"/>
        <path d="M20 46 L26 46 L26 52" fill="none" stroke="#12161f" stroke-width="1.2"/>
        <text x="40" y="63" font-size="10" font-style="italic">x&#8730;3</text>
        <text x="8" y="38" font-size="10" font-style="italic">x</text>
        <text x="46" y="31" font-size="10" font-style="italic">2x</text></svg>`
    },
    {
      f: 'Special right triangle',
      lbl: '45°–45°–90°',
      svg: `<svg width="86" height="66" viewBox="0 0 86 66">
        <path d="M20 52 L62 52 L20 10 Z" fill="none" stroke="#12161f" stroke-width="1.6"/>
        <path d="M20 46 L26 46 L26 52" fill="none" stroke="#12161f" stroke-width="1.2"/>
        <text x="38" y="63" font-size="10" font-style="italic">x</text>
        <text x="8" y="34" font-size="10" font-style="italic">x</text>
        <text x="44" y="28" font-size="10" font-style="italic">x&#8730;2</text></svg>`
    },
    {
      f: 'V = ℓwh',
      svg: `<svg width="86" height="66" viewBox="0 0 86 66">
        <path d="M16 24 L54 24 L54 52 L16 52 Z" fill="none" stroke="#12161f" stroke-width="1.6"/>
        <path d="M16 24 L30 12 L68 12 L54 24" fill="none" stroke="#12161f" stroke-width="1.6"/>
        <path d="M54 52 L68 40 L68 12" fill="none" stroke="#12161f" stroke-width="1.6"/></svg>`
    },
    {
      f: 'V = πr²h',
      svg: `<svg width="86" height="66" viewBox="0 0 86 66">
        <ellipse cx="43" cy="18" rx="20" ry="7" fill="none" stroke="#12161f" stroke-width="1.6"/>
        <path d="M23 18 L23 48" stroke="#12161f" stroke-width="1.6" fill="none"/>
        <path d="M63 18 L63 48" stroke="#12161f" stroke-width="1.6" fill="none"/>
        <path d="M23 48 A20 7 0 0 0 63 48" fill="none" stroke="#12161f" stroke-width="1.6"/></svg>`
    },
    {
      f: 'V = 4⁄3 πr³',
      svg: `<svg width="86" height="66" viewBox="0 0 86 66">
        <circle cx="43" cy="33" r="22" fill="none" stroke="#12161f" stroke-width="1.6"/>
        <ellipse cx="43" cy="33" rx="22" ry="7" fill="none" stroke="#12161f" stroke-width="1.1"
          stroke-dasharray="3 3"/></svg>`
    },
    {
      f: 'V = ⅓ πr²h',
      svg: `<svg width="86" height="66" viewBox="0 0 86 66">
        <ellipse cx="43" cy="48" rx="20" ry="7" fill="none" stroke="#12161f" stroke-width="1.6"/>
        <path d="M23 48 L43 12 L63 48" fill="none" stroke="#12161f" stroke-width="1.6"/></svg>`
    },
    {
      f: 'V = ⅓ ℓwh',
      svg: `<svg width="86" height="66" viewBox="0 0 86 66">
        <path d="M18 50 L54 50 L66 40 L30 40 Z" fill="none" stroke="#12161f" stroke-width="1.6"/>
        <path d="M18 50 L42 12 L54 50 M42 12 L66 40 M42 12 L30 40" fill="none"
          stroke="#12161f" stroke-width="1.6"/></svg>`
    }
  ];

  const FACTS = [
    'The number of degrees of arc in a circle is 360.',
    'The number of radians of arc in a circle is 2π.',
    'The sum of the measures in degrees of the angles of a triangle is 180.'
  ];

  function html() {
    return '<div class="ref">' +
      '<h5>Formulas</h5><div class="ref-grid">' +
      FIGS.map(f =>
        `<div class="ref-item">${f.svg}<div class="f">${f.f}</div>` +
        (f.lbl ? `<div style="font-size:11px;color:#767f90;margin-top:3px">${f.lbl}</div>` : '') +
        `</div>`).join('') +
      '</div>' +
      '<h5>Also given</h5><ul class="ref-facts">' +
      FACTS.map(f => `<li>${f}</li>`).join('') + '</ul>' +
      '</div>';
  }

  /* ── Desmos graphing calculator ──────────────────────────────── */
  const DESMOS_SRC = 'https://www.desmos.com/api/v1.11/calculator.js' +
    '?apiKey=dcb31709b452b1cf9dc26972add0fda6';
  let loading = null, instance = null;

  function loadDesmos() {
    if (window.Desmos) return Promise.resolve(window.Desmos);
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = DESMOS_SRC;
      sc.onload = () => res(window.Desmos);
      sc.onerror = () => rej(new Error('offline'));
      document.head.appendChild(sc);
      setTimeout(() => rej(new Error('timeout')), 12000);
    });
    return loading;
  }

  function mountCalc(node) {
    if (instance) { instance.resize && instance.resize(); return; }
    node.innerHTML = '<div style="padding:26px;text-align:center;color:#767f90;font-size:13.5px">' +
      'Loading Desmos…</div>';
    loadDesmos().then(D => {
      node.innerHTML = '';
      instance = D.GraphingCalculator(node, {
        keypad: true, expressions: true, settingsMenu: false, border: false
      });
    }).catch(() => {
      node.innerHTML =
        '<div style="padding:22px;font-size:13.5px;line-height:1.6;color:#48505f">' +
        '<b>Desmos could not load.</b><br>The graphing calculator is fetched from ' +
        'desmos.com, so it needs an internet connection. Everything else in this app ' +
        'works offline.<br><br><a href="https://www.desmos.com/calculator" target="_blank" ' +
        'rel="noopener" style="color:#1a4fd6">Open Desmos in a browser tab →</a></div>';
    });
  }

  return { html, mountCalc };
})();
