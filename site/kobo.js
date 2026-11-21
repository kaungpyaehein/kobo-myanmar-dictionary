// Device logic for the Kobo Myanmar Dictionary & Font Installer.
// Everything works on a FileSystemDirectoryHandle for the KOBOeReader drive,
// or on any object with the same methods (the tests use an in-memory fake).

// Dictionary font. It only works inside the dictionary popup.
export const FAMILY = 'Noto Sans Myanmar Kobo Dict';
export const OLD_FAMILIES = ['Noto Sans Myanmar Kobo', 'Myanmar Sans', 'KP Myanmar'];
export const GEO_DEFAULT = ['Noto Sans Thai Looped', 'Noto Sans Lao Looped'];
export const CONF = '.kobo/Kobo/Kobo eReader.conf';
export const KIT_DIR = '.adds/kobo-myanmar-kit';
const STATE = `${KIT_DIR}/installed.json`;
const BACKUP = `${KIT_DIR}/backup/Kobo eReader.conf`;
export const OLD_DICT = '.kobo/custom-dict/dicthtml-en-mm.zip';
export const OLD_FONTS = ['NotoSansMyanmarKobo-Regular.ttf', 'NotoSansMyanmarKoboBook-Regular.ttf', 'NotoSansMyanmarKoboBook-Bold.ttf',
  'MyanmarSans-Regular.ttf', 'MyanmarSans-Bold.ttf', 'KPMyanmar-Regular.ttf']
  .flatMap((n) => [`fonts/${n}`, `fonts/kobo/${n}`]);
const SECTION = '[ApplicationPreferences]';
const KEY = 'GeoBasedSystemFonts=';
const MODELS = { N428: 'Kobo Libra Colour' };

export class KitError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

// ---------- file helpers ----------

const isNotFound = (e) => e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');

async function dirAt(root, parts, create = false) {
  let d = root;
  for (const p of parts) {
    try {
      d = await d.getDirectoryHandle(p, { create });
    } catch (e) {
      if (!create && isNotFound(e)) return null;
      throw e;
    }
  }
  return d;
}

async function fileAt(root, path, create = false) {
  const parts = path.split('/');
  const name = parts.pop();
  const d = await dirAt(root, parts, create);
  if (!d) return null;
  try {
    return await d.getFileHandle(name, { create });
  } catch (e) {
    if (!create && isNotFound(e)) return null;
    throw e;
  }
}

export async function readBytes(root, path) {
  const h = await fileAt(root, path);
  return h ? new Uint8Array(await (await h.getFile()).arrayBuffer()) : null;
}

async function readText(root, path) {
  const b = await readBytes(root, path);
  return b && new TextDecoder().decode(b);
}

async function writeBytes(root, path, bytes) {
  const h = await fileAt(root, path, true);
  const w = await h.createWritable();
  try {
    await w.write(bytes);
    await w.close();
  } catch (e) {
    try { await w.abort(); } catch { /* already closed */ }
    throw e;
  }
}

const writeText = (root, path, text) => writeBytes(root, path, new TextEncoder().encode(text));

async function removeAt(root, path, recursive = false) {
  const parts = path.split('/');
  const name = parts.pop();
  const d = await dirAt(root, parts);
  if (!d) return false;
  try {
    await d.removeEntry(name, { recursive });
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

// macOS leaves "._name" files on FAT drives. Kobo doesn't need them.
async function removeAppleDouble(root, path) {
  const parts = path.split('/');
  const name = parts.pop();
  await removeAt(root, [...parts, `._${name}`].join('/'));
}

// Deletes a folder bit by bit. On a Mac, hidden "._" files can appear while
// deleting on the Kobo drive, so a single recursive delete may leave folders behind.
async function emptyDir(d) {
  for (let pass = 0; pass < 3; pass++) {
    const entries = [];
    for await (const entry of d.entries()) entries.push(entry);
    if (!entries.length) return;
    for (const [name, handle] of entries) {
      if (handle.kind === 'directory') await emptyDir(handle);
      try {
        await d.removeEntry(name, { recursive: true });
      } catch (e) {
        if (!isNotFound(e)) console.warn('retry delete', name, e);
      }
    }
  }
}

async function removeTree(root, path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const d = await dirAt(root, path.split('/'));
    if (!d) break;
    await emptyDir(d);
    try { await removeAt(root, path, true); } catch (e) { console.warn('delete', path, e); }
  }
  await removeAppleDouble(root, path);
  return !(await dirAt(root, path.split('/')));
}

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readState(root) {
  try {
    return JSON.parse((await readText(root, STATE)) || 'null');
  } catch {
    return null;
  }
}

// ---------- Kobo eReader.conf ----------

function parseConf(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === SECTION);
  let end = lines.length;
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].trim().startsWith('[')) { end = i; break; }
    }
  }
  const key = start < 0 ? -1 : lines.findIndex((l, i) => i > start && i < end && l.startsWith(KEY));
  return { eol, lines, start, key };
}

const familiesOf = (line) => line.slice(KEY.length).split(',').map((s) => s.trim()).filter(Boolean);

export function confFamilies(text) {
  const c = parseConf(text);
  return c.key < 0 ? [] : familiesOf(c.lines[c.key]);
}

// Adds our font to GeoBasedSystemFonts (dropping our older font names).
// If the line is missing, adds the tested line.
export function confAdd(text) {
  const c = parseConf(text);
  if (c.key >= 0) {
    const all = familiesOf(c.lines[c.key]);
    const f = all.filter((x) => !OLD_FAMILIES.includes(x));
    if (f.includes(FAMILY) && f.length === all.length) return { text, added: 'none' };
    c.lines[c.key] = KEY + (f.includes(FAMILY) ? f : [...f, FAMILY]).join(', ');
    return { text: c.lines.join(c.eol), added: 'family' };
  }
  const line = KEY + [...GEO_DEFAULT, FAMILY].join(', ');
  if (c.start >= 0) {
    c.lines.splice(c.start + 1, 0, line);
    return { text: c.lines.join(c.eol), added: 'line' };
  }
  const body = text && !text.endsWith('\n') ? text + c.eol : text;
  return { text: `${body}${SECTION}${c.eol}${line}${c.eol}`, added: 'line' };
}

// Removes our font names (new and old). Drops the whole line if the Kit added it
// and only Kobo's own defaults are left.
export function confRemove(text, kitAddedLine) {
  const c = parseConf(text);
  if (c.key < 0) return { text, changed: false };
  const ours = [FAMILY, ...OLD_FAMILIES];
  const f = familiesOf(c.lines[c.key]);
  const keep = f.filter((x) => !ours.includes(x));
  if (keep.length === f.length) return { text, changed: false };
  if (!keep.length || (kitAddedLine && keep.every((x) => GEO_DEFAULT.includes(x)))) {
    c.lines.splice(c.key, 1);
  } else {
    c.lines[c.key] = KEY + keep.join(', ');
  }
  return { text: c.lines.join(c.eol), changed: true };
}

// ---------- device ----------

export async function readDevice(root, manifest) {
  const text = await readText(root, '.kobo/version');
  if (!text) throw new KitError('notKobo');
  const parts = text.trim().split(',');
  const serial = parts[0] || '';
  const firmware = parts[2] || '?';
  const prefix = serial.slice(0, 4);
  const tested = manifest.tested.some((t) => t.serialPrefix === prefix && t.firmware === firmware);
  return { model: MODELS[prefix] || `Kobo (${prefix || '?'})`, firmware, tested, fonts: await countFiles(root, 'fonts', /\.(ttf|otf)$/i) };
}

// Files in one folder (not sub-folders), without macOS "._" files.
async function countFiles(root, path, pattern) {
  const d = await dirAt(root, path.split('/'));
  if (!d) return 0;
  let n = 0;
  for await (const [name, handle] of d.entries()) {
    if (handle.kind === 'file' && !name.startsWith('._') && pattern.test(name)) n++;
  }
  return n;
}

// Lists everything the Kit (or an older hand-made setup) put on the Kobo.
// Items marked kit:false are not known to be ours and start unticked.
export async function scan(root, manifest) {
  const state = await readState(root);
  const items = [];
  for (const f of manifest.files) {
    for (const dest of f.dest) {
      const b = await readBytes(root, dest);
      if (!b) continue;
      const h = await sha256(b);
      const kit = f.id === 'font' || f.id === 'readingFont' || h === f.sha256 || state?.files?.[dest] === h;
      items.push({ type: 'file', id: kit ? f.id : 'otherDict', path: dest, current: h === f.sha256, kit, checked: kit });
    }
  }
  if (await fileAt(root, OLD_DICT)) {
    items.push({ type: 'file', id: 'oldDict', path: OLD_DICT, current: false, kit: false, checked: false });
  }
  for (const p of OLD_FONTS) {
    if (await fileAt(root, p)) items.push({ type: 'file', id: 'oldFont', path: p, current: false, kit: true, checked: true });
  }
  const conf = await readText(root, CONF);
  const fams = conf ? confFamilies(conf) : [];
  const hasNew = fams.includes(FAMILY);
  if (hasNew || fams.some((x) => OLD_FAMILIES.includes(x))) {
    items.push({ type: 'conf', id: 'conf', path: CONF, current: hasNew, kit: true, checked: true });
  }
  if (await dirAt(root, KIT_DIR.split('/'))) {
    items.push({ type: 'dir', id: 'kit', path: KIT_DIR, current: true, kit: true, checked: true });
  }
  return { items, state, status: statusOf(items, manifest), confMissing: conf == null };
}

function statusOf(items, manifest) {
  const ours = (p) => items.find((i) => i.path === p && i.kit);
  // Optional files only count when they are on the Kobo.
  const need = manifest.files.filter((f) => !f.optional || f.dest.some(ours)).flatMap((f) => f.dest);
  const confOk = items.some((i) => i.id === 'conf' && i.current);
  if (need.every((p) => ours(p)) && confOk) {
    return need.every((p) => ours(p).current) ? 'installed' : 'update';
  }
  const kitItems = items.filter((i) => i.kit && i.id !== 'kit');
  if (!kitItems.length) return 'none';
  // Something of ours is from an older version: Update. Otherwise parts are just missing.
  return kitItems.some((i) => !i.current) ? 'update' : 'partial';
}

// ---------- install ----------

// load(file, onProgress) returns the file's bytes. step(id, status, info) reports progress.
// Reading-font families in the manifest.
export const readingFamilies = (manifest) => [...new Set(manifest.files.filter((f) => f.optional).map((f) => f.family))];

// reading: the reading-font families to add (default all). Ones left out but already on the Kobo stay.
// Fonts with our older names are removed, so the font menu only shows the current ones.
export async function install(root, manifest, load, step, { reading = readingFamilies(manifest) } = {}) {
  const files = manifest.files.filter((f) => !f.optional || reading.includes(f.family));
  // Download and check everything first, so a failed download changes nothing on the Kobo.
  step('download', 'run', 0);
  const total = files.reduce((n, f) => n + f.size, 0);
  let done = 0;
  const data = new Map();
  for (const f of files) {
    const bytes = await load(f, (n) => step('download', 'run', Math.round(((done + n) / total) * 100)));
    if ((await sha256(bytes)) !== f.sha256) throw new KitError('badDownload', f.url);
    data.set(f, bytes);
    done += f.size;
  }
  step('download', 'done', 100);

  const prev = await readState(root);
  const conf = await readText(root, CONF);
  step('backup', 'run');
  if (conf != null && !(await fileAt(root, BACKUP))) {
    await writeText(root, BACKUP, conf);
    if ((await readText(root, BACKUP)) !== conf) throw new KitError('verify', BACKUP);
  }
  step('backup', conf == null ? 'skip' : 'done');

  const record = {
    version: manifest.version,
    installedAt: new Date().toISOString(),
    files: { ...prev?.files },
    addedLine: Boolean(prev?.addedLine),
  };
  for (const f of files) {
    for (const dest of f.dest) {
      const id = `copy:${dest}`;
      step(id, 'run');
      await writeBytes(root, dest, data.get(f));
      await removeAppleDouble(root, dest);
      const back = await readBytes(root, dest);
      if (!back || (await sha256(back)) !== f.sha256) throw new KitError('verify', dest);
      record.files[dest] = f.sha256;
      step(id, 'done');
    }
  }

  step('setting', 'run');
  if (conf == null) {
    step('setting', 'skip');
  } else {
    const { text, added } = confAdd(conf);
    if (text !== conf) await writeText(root, CONF, text);
    if (!confFamilies((await readText(root, CONF)) || '').includes(FAMILY)) throw new KitError('verify', CONF);
    record.addedLine ||= added === 'line';
    step('setting', 'done');
  }

  step('record', 'run');
  for (const p of OLD_FONTS) {
    if (await removeAt(root, p)) await removeAppleDouble(root, p);
  }
  await writeText(root, STATE, JSON.stringify(record, null, 2));
  await removeAppleDouble(root, STATE);
  step('record', 'done');
  return { confMissing: conf == null };
}

// ---------- remove ----------

export async function remove(root, items, step) {
  const state = await readState(root);
  const chosen = items.filter((i) => i.checked);
  const order = { file: 0, conf: 1, dir: 2 };
  chosen.sort((a, b) => order[a.type] - order[b.type]);
  for (const it of chosen) {
    const id = `del:${it.path}`;
    step(id, 'run');
    if (it.type === 'file') {
      await removeAt(root, it.path);
      await removeAppleDouble(root, it.path);
      if (await fileAt(root, it.path)) throw new KitError('verify', it.path);
    } else if (it.type === 'conf') {
      const conf = await readText(root, CONF);
      if (conf != null) {
        const { text, changed } = confRemove(conf, state?.addedLine);
        if (changed) await writeText(root, CONF, text);
        const left = confFamilies((await readText(root, CONF)) || '');
        if (left.some((x) => x === FAMILY || OLD_FAMILIES.includes(x))) throw new KitError('verify', CONF);
      }
    } else if (it.type === 'dir') {
      // Only the Kit's own backup and record live here, so a leftover empty folder is harmless.
      if (!(await removeTree(root, it.path))) { step(id, 'skip'); continue; }
    }
    step(id, 'done');
  }
}
