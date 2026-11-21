// Tests for site/kobo.js against an in-memory Kobo drive.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAMILY, CONF, KIT_DIR, OLD_DICT, confAdd, confRemove, confFamilies,
  readDevice, scan, install, remove, sha256, KitError,
} from '../site/kobo.js';

const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });

class FakeFile {
  constructor(bytes = new Uint8Array()) { this.kind = 'file'; this.bytes = bytes; }
  async getFile() { const b = this.bytes; return { arrayBuffer: async () => b.slice().buffer }; }
  async createWritable() {
    const chunks = [];
    return {
      write: async (d) => chunks.push(typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d)),
      close: async () => { this.bytes = new Uint8Array(Buffer.concat(chunks)); },
      abort: async () => {},
    };
  }
}

class FakeDir {
  constructor() { this.kind = 'directory'; this.children = new Map(); }
  async getDirectoryHandle(name, { create } = {}) {
    let c = this.children.get(name);
    if (!c) { if (!create) throw notFound(); c = new FakeDir(); this.children.set(name, c); }
    if (c.kind !== 'directory') throw Object.assign(new Error(), { name: 'TypeMismatchError' });
    return c;
  }
  async getFileHandle(name, { create } = {}) {
    let c = this.children.get(name);
    if (!c) { if (!create) throw notFound(); c = new FakeFile(); this.children.set(name, c); }
    if (c.kind !== 'file') throw Object.assign(new Error(), { name: 'TypeMismatchError' });
    return c;
  }
  async *entries() { yield* this.children.entries(); }
  async removeEntry(name, { recursive } = {}) {
    const c = this.children.get(name);
    if (!c) throw notFound();
    if (c.kind === 'directory' && c.children.size && !recursive) throw new Error('not empty');
    this.children.delete(name);
  }
}

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

function put(root, path, data) {
  const parts = path.split('/');
  const name = parts.pop();
  let d = root;
  for (const p of parts) {
    if (!d.children.has(p)) d.children.set(p, new FakeDir());
    d = d.children.get(p);
  }
  d.children.set(name, new FakeFile(typeof data === 'string' ? enc(data) : data));
}

function get(root, path) {
  let d = root;
  for (const p of path.split('/')) { d = d?.children?.get(p); }
  return d;
}

const DICT = enc('dictionary v1');
const FONT = enc('font v1');
const BOOK_R = enc('book regular v1');
const BOOK_B = enc('book bold v1');
const BASE_CONF = '[ApplicationPreferences]\nCurrentLocale=en\nEarliestChangeLog=4.46.23852\n\n[PowerOptions]\nAutoOffMinutes=60\n';

async function manifest() {
  return {
    version: '1.0',
    files: [
      { id: 'dictionary', url: 'files/d.zip', size: DICT.length, sha256: await sha256(DICT), dest: ['.kobo/custom-dict/dicthtml-en-my.zip'] },
      { id: 'font', url: 'files/f.ttf', size: FONT.length, sha256: await sha256(FONT), dest: ['fonts/NotoSansMyanmarKoboDict-Regular.ttf', 'fonts/kobo/NotoSansMyanmarKoboDict-Regular.ttf'] },
      { id: 'readingFont', url: 'files/br.ttf', size: BOOK_R.length, sha256: await sha256(BOOK_R), dest: [BOOK_R_PATH], optional: true, family: 'Noto Sans Myanmar Kobo Reader' },
      { id: 'readingFont', url: 'files/bb.ttf', size: BOOK_B.length, sha256: await sha256(BOOK_B), dest: [BOOK_B_PATH], optional: true, family: 'Thitsar Kobo Reader' },
    ],
    tested: [{ serialPrefix: 'N428', firmware: '4.46.23852' }],
  };
}

const BOOK_R_PATH = 'fonts/NotoSansMyanmarKoboReader-Regular.ttf';
const BOOK_B_PATH = 'fonts/ThitsarKoboReader-Regular.ttf';
const BYTES = { 'files/d.zip': DICT, 'files/f.ttf': FONT, 'files/br.ttf': BOOK_R, 'files/bb.ttf': BOOK_B };
const load = async (f) => BYTES[f.url];
const quiet = () => {};

function kobo(conf = BASE_CONF) {
  const root = new FakeDir();
  put(root, '.kobo/version', 'N428000000000,4.9.77,4.46.23852,4.9.77,4.9.77,00000000-0000-0000-0000-000000000390\n');
  if (conf != null) put(root, CONF, conf);
  return root;
}

test('conf: adds tested line when missing, keeps other sections', () => {
  const { text, added } = confAdd(BASE_CONF);
  assert.equal(added, 'line');
  assert.match(text, /^\[ApplicationPreferences\]\nGeoBasedSystemFonts=Noto Sans Thai Looped, Noto Sans Lao Looped, Noto Sans Myanmar Kobo Dict\n/);
  assert.match(text, /\[PowerOptions\]\nAutoOffMinutes=60\n$/);
});

test('conf: appends to existing line once, keeps CRLF', () => {
  const crlf = '[ApplicationPreferences]\r\nGeoBasedSystemFonts=Noto Sans Thai Looped\r\n';
  const a = confAdd(crlf);
  assert.equal(a.added, 'family');
  assert.equal(a.text, '[ApplicationPreferences]\r\nGeoBasedSystemFonts=Noto Sans Thai Looped, Noto Sans Myanmar Kobo Dict\r\n');
  assert.equal(confAdd(a.text).added, 'none');
});

test('conf: remove restores a user line and drops a Kit-added line', () => {
  const user = '[ApplicationPreferences]\nGeoBasedSystemFonts=Noto Sans Thai Looped, Myanmar Sans, Noto Sans Myanmar Kobo Dict\n';
  assert.equal(confRemove(user, false).text, '[ApplicationPreferences]\nGeoBasedSystemFonts=Noto Sans Thai Looped\n');
  const added = confAdd(BASE_CONF).text;
  assert.equal(confRemove(added, true).text, BASE_CONF);
  assert.equal(confRemove(BASE_CONF, true).changed, false);
});

test('device: reads model and firmware, rejects non-Kobo folders', async () => {
  const m = await manifest();
  assert.deepEqual(await readDevice(kobo(), m), { model: 'Kobo Libra Colour', firmware: '4.46.23852', tested: true, fonts: 0 });
  await assert.rejects(readDevice(new FakeDir(), m), (e) => e instanceof KitError && e.code === 'notKobo');
});

test('install on a fresh Kobo, then scan says installed', async () => {
  const m = await manifest();
  const root = kobo();
  assert.equal((await scan(root, m)).status, 'none');
  await install(root, m, load, quiet);
  assert.equal(dec(get(root, '.kobo/custom-dict/dicthtml-en-my.zip').bytes), 'dictionary v1');
  assert.equal(dec(get(root, 'fonts/kobo/NotoSansMyanmarKoboDict-Regular.ttf').bytes), 'font v1');
  assert.ok(confFamilies(dec(get(root, CONF).bytes)).includes(FAMILY));
  assert.equal(dec(get(root, `${KIT_DIR}/backup/Kobo eReader.conf`).bytes), BASE_CONF);
  assert.equal((await scan(root, m)).status, 'installed');
});

test('install twice keeps the first backup and one font entry', async () => {
  const m = await manifest();
  const root = kobo();
  await install(root, m, load, quiet);
  await install(root, m, load, quiet);
  const conf = dec(get(root, CONF).bytes);
  assert.equal(conf.split(FAMILY).length, 2);
  assert.equal(dec(get(root, `${KIT_DIR}/backup/Kobo eReader.conf`).bytes), BASE_CONF);
});

test('install then remove returns the Kobo to how it was', async () => {
  const m = await manifest();
  const root = kobo();
  put(root, 'fonts/kobo/Other.ttf', 'keep me');
  await install(root, m, load, quiet);
  const s = await scan(root, m);
  await remove(root, s.items, quiet);
  assert.equal(dec(get(root, CONF).bytes), BASE_CONF);
  assert.equal(get(root, 'fonts/NotoSansMyanmarKoboDict-Regular.ttf'), undefined);
  assert.equal(get(root, 'fonts/kobo/NotoSansMyanmarKoboDict-Regular.ttf'), undefined);
  assert.equal(get(root, '.kobo/custom-dict/dicthtml-en-my.zip'), undefined);
  assert.equal(get(root, KIT_DIR), undefined);
  assert.equal(dec(get(root, 'fonts/kobo/Other.ttf').bytes), 'keep me');
  assert.equal((await scan(root, m)).status, 'none');
});

test('a damaged download changes nothing on the Kobo', async () => {
  const m = await manifest();
  const root = kobo();
  const bad = async (f) => (f.id === 'font' ? enc('broken') : BYTES[f.url]);
  await assert.rejects(install(root, m, bad, quiet), (e) => e.code === 'badDownload');
  assert.equal(get(root, '.kobo/custom-dict'), undefined);
  assert.equal(dec(get(root, CONF).bytes), BASE_CONF);
});

test('old hand-made setup: scan finds it, unknown dictionaries start unticked', async () => {
  const m = await manifest();
  const root = kobo('[ApplicationPreferences]\nGeoBasedSystemFonts=Noto Sans Thai Looped, Noto Sans Lao Looped, Myanmar Sans\n');
  put(root, 'fonts/MyanmarSans-Regular.ttf', 'old');
  put(root, 'fonts/kobo/MyanmarSans-Regular.ttf', 'old');
  put(root, '.kobo/custom-dict/dicthtml-en-my.zip', 'old dictionary');
  put(root, OLD_DICT, 'older dictionary');
  const s = await scan(root, m);
  assert.equal(s.status, 'update');
  const byPath = Object.fromEntries(s.items.map((i) => [i.path, i]));
  assert.equal(byPath['.kobo/custom-dict/dicthtml-en-my.zip'].checked, false);
  assert.equal(byPath[OLD_DICT].checked, false);
  assert.equal(byPath['fonts/MyanmarSans-Regular.ttf'].checked, true);
  await remove(root, s.items, quiet);
  assert.equal(get(root, 'fonts/MyanmarSans-Regular.ttf'), undefined);
  assert.equal(dec(get(root, '.kobo/custom-dict/dicthtml-en-my.zip').bytes), 'old dictionary');
  assert.equal(dec(get(root, CONF).bytes), '[ApplicationPreferences]\nGeoBasedSystemFonts=Noto Sans Thai Looped, Noto Sans Lao Looped\n');
});

test('missing settings file: files install, setting is skipped', async () => {
  const m = await manifest();
  const root = kobo(null);
  const steps = [];
  const r = await install(root, m, load, (id, st) => steps.push(`${id}:${st}`));
  assert.equal(r.confMissing, true);
  assert.ok(steps.includes('setting:skip'));
  assert.equal(get(root, CONF), undefined);
});

test('removes macOS ._ files next to written files', async () => {
  const m = await manifest();
  const root = kobo();
  put(root, 'fonts/._NotoSansMyanmarKoboDict-Regular.ttf', 'apple');
  await install(root, m, load, quiet);
  assert.equal(get(root, 'fonts/._NotoSansMyanmarKoboDict-Regular.ttf'), undefined);
});

test('remove clears the Kit folder even when a recursive delete leaves folders', async () => {
  const m = await manifest();
  const root = kobo();
  await install(root, m, load, quiet);
  put(root, `${KIT_DIR}/backup/._Kobo eReader.conf`, 'apple');
  const adds = get(root, '.adds');
  const real = adds.removeEntry.bind(adds);
  let first = true;
  adds.removeEntry = async (name, opts) => {
    // Simulate macOS: the first delete of the folder fails.
    if (first && name === 'kobo-myanmar-kit') { first = false; throw new Error('not empty'); }
    return real(name, opts);
  };
  const steps = [];
  await remove(root, (await scan(root, m)).items, (id, st) => steps.push(`${id}:${st}`));
  assert.equal(get(root, KIT_DIR), undefined);
  assert.ok(steps.includes(`del:${KIT_DIR}:done`));
});

test('a Kit folder that cannot be deleted is skipped, not an error', async () => {
  const m = await manifest();
  const root = kobo();
  await install(root, m, load, quiet);
  const adds = get(root, '.adds');
  const real = adds.removeEntry.bind(adds);
  adds.removeEntry = async (name, opts) => {
    if (name === 'kobo-myanmar-kit') throw new Error('busy');
    return real(name, opts);
  };
  const steps = [];
  await remove(root, (await scan(root, m)).items, (id, st) => steps.push(`${id}:${st}`));
  assert.ok(steps.includes(`del:${KIT_DIR}:skip`));
  assert.equal(get(root, 'fonts/NotoSansMyanmarKoboDict-Regular.ttf'), undefined);
  assert.equal((await scan(root, m)).status, 'none');
});

test('book fonts install by default and are removed with the rest', async () => {
  const m = await manifest();
  const root = kobo();
  await install(root, m, load, quiet);
  assert.equal(dec(get(root, BOOK_R_PATH).bytes), 'book regular v1');
  assert.equal(dec(get(root, BOOK_B_PATH).bytes), 'book bold v1');
  const s = await scan(root, m);
  assert.equal(s.status, 'installed');
  await remove(root, s.items, quiet);
  assert.equal(get(root, BOOK_R_PATH), undefined);
  assert.equal(get(root, BOOK_B_PATH), undefined);
  assert.equal((await scan(root, m)).status, 'none');
});

test('book fonts can be skipped; the Kit still counts as installed', async () => {
  const m = await manifest();
  const root = kobo();
  const loaded = [];
  await install(root, m, async (f) => { loaded.push(f.url); return load(f); }, quiet, { reading: [] });
  assert.ok(!loaded.includes('files/br.ttf'));
  assert.equal(get(root, BOOK_R_PATH), undefined);
  assert.equal((await scan(root, m)).status, 'installed');
});

test('an old book font shows as an update', async () => {
  const m = await manifest();
  const root = kobo();
  await install(root, m, load, quiet);
  put(root, BOOK_R_PATH, 'book regular v0');
  assert.equal((await scan(root, m)).status, 'update');
});

test('pick some reading fonts: only those are added', async () => {
  const m = await manifest();
  const root = kobo();
  await install(root, m, load, quiet, { reading: ['Thitsar Kobo Reader'] });
  assert.equal(get(root, BOOK_R_PATH), undefined);
  assert.equal(dec(get(root, BOOK_B_PATH).bytes), 'book bold v1');
});

test('update from the old font names: old fonts and setting are replaced', async () => {
  const m = await manifest();
  const root = kobo('[ApplicationPreferences]\nGeoBasedSystemFonts=Noto Sans Thai Looped, Noto Sans Lao Looped, Noto Sans Myanmar Kobo\n');
  put(root, 'fonts/NotoSansMyanmarKobo-Regular.ttf', 'old dict font');
  put(root, 'fonts/kobo/NotoSansMyanmarKobo-Regular.ttf', 'old dict font');
  put(root, 'fonts/NotoSansMyanmarKoboBook-Regular.ttf', 'old book font');
  put(root, '.kobo/custom-dict/dicthtml-en-my.zip', 'old dictionary');
  put(root, `${KIT_DIR}/installed.json`, JSON.stringify({ files: { '.kobo/custom-dict/dicthtml-en-my.zip': await sha256(enc('old dictionary')) } }));
  assert.equal((await scan(root, m)).status, 'update');
  await install(root, m, load, quiet);
  assert.equal(get(root, 'fonts/NotoSansMyanmarKobo-Regular.ttf'), undefined);
  assert.equal(get(root, 'fonts/kobo/NotoSansMyanmarKobo-Regular.ttf'), undefined);
  assert.equal(get(root, 'fonts/NotoSansMyanmarKoboBook-Regular.ttf'), undefined);
  assert.equal(dec(get(root, CONF).bytes), '[ApplicationPreferences]\nGeoBasedSystemFonts=Noto Sans Thai Looped, Noto Sans Lao Looped, Noto Sans Myanmar Kobo Dict\n');
  assert.equal((await scan(root, m)).status, 'installed');
});
