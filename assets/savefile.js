/* ══════════════════════════════════════════════════════════════════
   savefile.js — keep progress in a real file on disk, not only in
   the browser's storage.

   Three things happen here:

   1. EXPORT   writes `save.js`, a normal text file you own.
   2. AUTOLOAD index.html loads `data/save.js` if it exists, so dropping
               your export there means the next launch restores itself.
   3. AUTOSAVE Chrome and Edge can hand the page a writable handle to
               that file, and from then on every answer is mirrored to
               disk as you go.

   Why not just remember the file forever? A page opened from file://
   cannot use IndexedDB in Chrome, and a file handle can only be
   persisted there — so the handle lasts for the session. The autoload
   path is what makes progress survive across launches, and re-linking
   is one click.
   ══════════════════════════════════════════════════════════════════ */
const SaveFile = (() => {
  const SUGGESTED = 'save.js';
  const PICKER = typeof window.showSaveFilePicker === 'function';
  const OPENER = typeof window.showOpenFilePicker === 'function';

  let handle = null;          // FileSystemFileHandle while linked
  let linkedName = null;
  let queued = false, writing = false, timer = null;
  let statusSubs = [];

  const supported = PICKER;
  const isLinked = () => !!handle;
  const name = () => linkedName;

  function emit() { for (const f of statusSubs) { try { f(); } catch (e) { } } }

  /* ── serialise ─────────────────────────────────────────────────── */
  function serialize() {
    const payload = {
      app: 'sat-trainer',
      format: 1,
      savedAt: Date.now(),
      state: Store.state()
    };
    // Written as an assignment so index.html can load it with a <script>
    // tag; a page on file:// cannot fetch() a sibling file.
    return 'window.SAT_SAVE=' + JSON.stringify(payload) + ';\n';
  }

  /** Accepts our save.js, or a bare JSON dump of the state. */
  function parse(text) {
    let t = String(text || '').trim();
    if (!t) throw new Error('The file is empty.');
    const m = t.match(/window\s*\.\s*SAT_SAVE\s*=\s*([\s\S]*?);?\s*$/);
    if (m) t = m[1].trim();
    let o;
    try { o = JSON.parse(t); }
    catch (e) { throw new Error('This is not a SAT Trainer save file.'); }
    if (o && o.state && typeof o.state === 'object') return o;
    if (o && Array.isArray(o.attempts)) return { savedAt: o.savedAt || 0, state: o };
    throw new Error('This is not a SAT Trainer save file.');
  }

  /* ── writing ───────────────────────────────────────────────────── */
  async function writeNow() {
    if (!handle || writing) { queued = !!handle; return; }
    writing = true;
    try {
      const w = await handle.createWritable();
      await w.write(serialize());
      await w.close();
      Store.state().everExported = true;
    } catch (e) {
      console.warn('auto-save failed', e);
      handle = null; linkedName = null;
      emit();
      if (typeof onError === 'function') onError(e);
    } finally {
      writing = false;
      if (queued) { queued = false; schedule(); }
      else emit();
    }
  }

  function schedule() {
    if (!handle) return;
    clearTimeout(timer);
    timer = setTimeout(writeNow, 1200);
  }

  let onError = null;

  /* ── linking ───────────────────────────────────────────────────── */
  async function link() {
    if (!PICKER) throw new Error('nopicker');
    const h = await window.showSaveFilePicker({
      suggestedName: SUGGESTED,
      types: [{ description: 'SAT Trainer save', accept: { 'text/javascript': ['.js'] } }]
    });
    handle = h;
    linkedName = h.name;
    await writeNow();
    emit();
    return h.name;
  }

  /** Re-attach to an existing save file and load whatever is in it. */
  async function openExisting() {
    if (!OPENER) throw new Error('nopicker');
    const [h] = await window.showOpenFilePicker({
      types: [{ description: 'SAT Trainer save', accept: { 'text/javascript': ['.js', '.json'] } }]
    });
    const file = await h.getFile();
    const data = parse(await file.text());
    // keep writing to it if we are allowed to
    try {
      if (await h.requestPermission({ mode: 'readwrite' }) === 'granted') {
        handle = h; linkedName = h.name;
      }
    } catch (e) { /* read-only is fine */ }
    emit();
    return data;
  }

  /* ── plain download / upload, for browsers without the picker ──── */
  function download() {
    const blob = new Blob([serialize()], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = SUGGESTED;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    Store.state().everExported = true;
    Store.save();
  }

  function upload() {
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.js,.json,text/javascript,application/json';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return reject(new Error('No file chosen.'));
        const fr = new FileReader();
        fr.onload = () => { try { resolve(parse(fr.result)); } catch (e) { reject(e); } };
        fr.onerror = () => reject(new Error('Could not read that file.'));
        fr.readAsText(f);
      };
      inp.click();
    });
  }

  /** Best available "save a copy": link+write, else download. */
  async function exportNow() {
    if (handle) { await writeNow(); return linkedName; }
    if (PICKER) return await link();
    download();
    return SUGGESTED;
  }

  /** Best available "load from disk". */
  async function importNow() {
    if (OPENER) return await openExisting();
    return await upload();
  }

  Store.onChange(schedule);

  return {
    supported, isLinked, name, serialize, parse,
    link, openExisting, download, upload, exportNow, importNow,
    flush: writeNow,
    onStatus(fn) { statusSubs.push(fn); },
    onError(fn) { onError = fn; }
  };
})();
