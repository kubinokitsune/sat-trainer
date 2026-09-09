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

   The link survives a refresh. A file handle cannot be put in
   localStorage — it is not JSON — but it can be structured-cloned into
   IndexedDB, which does work on file:// in a real browser. So the
   handle is stored there and picked back up on the next load; only a
   full browser restart can drop the write permission, and that costs
   one click rather than re-picking the file.
   ══════════════════════════════════════════════════════════════════ */
const SaveFile = (() => {
  const SUGGESTED = 'save.js';
  const PICKER = typeof window.showSaveFilePicker === 'function';
  const OPENER = typeof window.showOpenFilePicker === 'function';

  let handle = null;          // FileSystemFileHandle while linked
  let linkedName = null;
  let pendingHandle = null;   // remembered, but needs a click to re-permit
  let queued = false, writing = false, timer = null;
  let statusSubs = [];

  const supported = PICKER;
  const isLinked = () => !!handle;
  const name = () => linkedName || (pendingHandle && pendingHandle.name) || null;
  /** A file is remembered but the browser wants a gesture before writing. */
  const needsReconnect = () => !handle && !!pendingHandle;

  function emit() { for (const f of statusSubs) { try { f(); } catch (e) { } } }

  /* ── remembering the handle ────────────────────────────────────────
     Everything here fails soft: if IndexedDB is unavailable or simply
     never answers (it hangs in some headless builds), the app carries
     on with a session-only link rather than stalling on boot. */
  const DB_NAME = 'sat_trainer', STORE = 'handles', KEY = 'saveFile';
  const IDB_TIMEOUT = 3000;

  function openDB() {
    return new Promise(resolve => {
      let settled = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };
      setTimeout(() => done(null), IDB_TIMEOUT);
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = e => done(e.target.result);
        req.onerror = () => done(null);
        req.onblocked = () => done(null);
      } catch (e) { done(null); }
    });
  }

  function idbPut(value) {
    return openDB().then(db => {
      if (!db) return false;
      return new Promise(resolve => {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(value, KEY);
          tx.oncomplete = () => { db.close(); resolve(true); };
          tx.onerror = () => { db.close(); resolve(false); };
        } catch (e) { try { db.close(); } catch (x) { } resolve(false); }
      });
    }).catch(() => false);
  }

  function idbGet() {
    return openDB().then(db => {
      if (!db) return null;
      return new Promise(resolve => {
        try {
          const tx = db.transaction(STORE, 'readonly');
          const rq = tx.objectStore(STORE).get(KEY);
          rq.onsuccess = () => { const v = rq.result; db.close(); resolve(v || null); };
          rq.onerror = () => { db.close(); resolve(null); };
        } catch (e) { try { db.close(); } catch (x) { } resolve(null); }
      });
    }).catch(() => null);
  }

  const idbClear = () => idbPut(undefined);

  /** Re-attach to the file linked in an earlier visit.
   *  Returns 'linked' (writing again), 'needs-click', or 'none'. */
  async function restore() {
    if (!PICKER) return 'none';
    if (handle) return 'linked';        // already attached; nothing to do
    let h = null;
    try { h = await idbGet(); } catch (e) { h = null; }
    if (!h || typeof h.queryPermission !== 'function') return 'none';
    let perm = 'prompt';
    try { perm = await h.queryPermission({ mode: 'readwrite' }); } catch (e) { perm = 'denied'; }
    if (perm === 'granted') {
      handle = h;
      linkedName = h.name;
      pendingHandle = null;
      emit();
      return 'linked';
    }
    if (perm === 'denied') { idbClear(); return 'none'; }
    pendingHandle = h;          // permission survives only within a session
    emit();
    return 'needs-click';
  }

  /** Ask for permission again — must be called from a click. */
  async function reconnect() {
    if (!pendingHandle) return false;
    let perm = 'denied';
    try { perm = await pendingHandle.requestPermission({ mode: 'readwrite' }); }
    catch (e) { perm = 'denied'; }
    if (perm !== 'granted') return false;
    handle = pendingHandle;
    linkedName = handle.name;
    pendingHandle = null;
    await writeNow();
    emit();
    return true;
  }

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
      handle = null; linkedName = null; pendingHandle = null;
      idbClear();
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
    await idbPut(h);        // so a refresh picks it straight back up
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
        handle = h; linkedName = h.name; pendingHandle = null;
        idbPut(h);
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

  // Writes are debounced by a second or so, and browsers throttle timers in a
  // background tab — so flush the moment the page is hidden or closed, or the
  // last answer before you switch away never reaches the file.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && handle) { clearTimeout(timer); writeNow(); }
  });
  window.addEventListener('pagehide', () => {
    if (handle) { clearTimeout(timer); writeNow(); }
  });

  return {
    supported, isLinked, name, needsReconnect, serialize, parse,
    link, openExisting, download, upload, exportNow, importNow,
    restore, reconnect,
    flush: writeNow,
    onStatus(fn) { statusSubs.push(fn); },
    onError(fn) { onError = fn; }
  };
})();
