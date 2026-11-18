import { TEXT } from './i18n.js';
import * as kobo from './kobo.js';

// ---------- language ----------

let lang = 'en';
try { lang = localStorage.getItem('lang') === 'my' ? 'my' : 'en'; } catch { /* storage blocked */ }

// Burmese text uses Burmese digits (၀–၉).
const num = (n) => (lang === 'my' ? String(n).replace(/[0-9]/g, (d) => '၀၁၂၃၄၅၆၇၈၉'[d]) : String(n));

const t = (key, vars = {}) =>
  (TEXT[lang][key] ?? TEXT.en[key] ?? key).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');

// ---------- tiny DOM helper ----------

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

// ---------- state ----------

let manifest = null;
const fresh = () => ({
  step: 0, ack: false, root: null, device: null, scan: null, busy: false,
  untestedOk: false, mode: null, steps: [], running: false, error: null, finished: false, confMissing: false,
  groupOf: {},
});
let S = fresh();

const landing = document.getElementById('landing');
const wizard = document.getElementById('wizard');

function errMsg(e) {
  if (e instanceof kobo.KitError && TEXT.en[`err_${e.code}`]) return t(`err_${e.code}`, { detail: e.detail });
  if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return t('err_permission');
  return t('err_other', { detail: e?.message || String(e) });
}

// ---------- static text ----------

function applyText() {
  document.documentElement.lang = lang === 'my' ? 'my' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.getElementById('lang').textContent = t('lang');
  if (manifest) {
    document.getElementById('version').textContent = t('version', {
      v: num(manifest.version), words: num(manifest.words.toLocaleString('en-US')),
    });
  }
}

document.getElementById('lang').addEventListener('click', () => {
  lang = lang === 'my' ? 'en' : 'my';
  try { localStorage.setItem('lang', lang); } catch { /* storage blocked */ }
  applyText();
  render();
});

// ---------- routing ----------

function route() {
  const inKit = location.hash === '#kit';
  landing.hidden = inKit;
  wizard.hidden = !inKit;
  if (!inKit && !S.running) S = fresh();
  if (inKit) render();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (S.running) e.preventDefault(); });

const goHome = () => { if (!S.running) location.hash = ''; };
const go = (step) => { S.step = step; S.error = null; render(); window.scrollTo(0, 0); };

// ---------- render ----------

function render() {
  if (wizard.hidden) return;
  const labels = [t('s1'), t('s2'), t('s3'), t('s4')];
  const bar = h('div', { class: 'progress' },
    labels.map((l, i) => h('div', { class: i === S.step ? 'active' : i < S.step ? 'done' : '' }, `${num(`0${i + 1}`)} ${l}`)));
  const cards = [startCard, connectCard, actionCard, finishCard];
  wizard.replaceChildren(bar, cards[S.step]());
}

function nav(back, next) {
  return h('div', { class: 'nav' }, back || h('span'), next || h('span'));
}

function startCard() {
  return h('section', { class: 'card' },
    h('h2', {}, t('startTitle')),
    h('ol', { class: 'steps' }, h('li', {}, t('start0')), h('li', {}, t('start1')), h('li', {}, t('start2'))),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: S.ack, onchange: (e) => { S.ack = e.target.checked; render(); } }),
      h('span', {}, t('ack'))),
    nav(h('button', { class: 'btn', onclick: goHome }, t('back')),
      h('button', { class: 'btn primary', disabled: !S.ack, onclick: () => go(1) }, `${t('next')} →`)));
}

// ---------- connect + check ----------

async function chooseDrive() {
  let root;
  try {
    root = await window.showDirectoryPicker({ id: 'kobo', mode: 'readwrite' });
  } catch (e) {
    if (e.name !== 'AbortError') { S.error = errMsg(e); render(); }
    return;
  }
  S.busy = true; S.error = null; S.device = null; S.scan = null; S.untestedOk = false;
  render();
  try {
    S.device = await kobo.readDevice(root, manifest);
    S.scan = await kobo.scan(root, manifest);
    S.root = root;
  } catch (e) {
    S.device = null;
    S.error = errMsg(e);
  }
  S.busy = false;
  render();
}

const ICONS = {
  ok: 'M20 6 9 17l-5-5',
  install: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14',
  warn: 'M12 8v5m0 3.5v.5',
  remove: 'M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
};
const icon = (name) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = `<path d="${ICONS[name]}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svg;
};

function connectCard() {
  if (!('showDirectoryPicker' in window)) return manualCard();
  const d = S.device;
  if (!d || !S.scan) {
    return h('section', { class: 'card' },
      h('h2', {}, t('connectTitle')),
      h('ol', { class: 'steps' }, h('li', {}, t('connect1')), h('li', {}, t('connect2'))),
      h('button', { class: 'btn primary big wide', disabled: S.busy, onclick: chooseDrive },
        S.busy ? h('span', { class: 'spinner' }) : null, t('choose')),
      S.error ? h('div', { class: 'notice err' }, S.error) : null,
      nav(h('button', { class: 'btn', onclick: () => go(0) }, t('back'))));
  }

  const status = S.scan.status;
  const look = { installed: ['ok', 'ok'], none: ['ready', 'install'], update: ['warn', 'install'], partial: ['warn', 'warn'] }[status];
  const ok = d.tested || S.untestedOk;
  const startInstall = () => { S.mode = 'install'; go(2); runInstall(); };
  const startRemove = () => { S.mode = 'remove'; go(2); };
  const installLabel = { installed: 'doReinstall', update: 'doUpdate' }[status] || 'doInstall';

  const card = h('section', { class: 'card' },
    h('div', { class: `status ${look[0]}` },
      h('div', { class: 'status-icon' }, icon(look[1])),
      h('h2', {}, t(`hero_${status}`)),
      h('p', {}, t(`hero_${status}_sub`))),
    h('p', { class: 'device-line' },
      d.model,
      h('button', { class: 'linkbtn', disabled: S.busy, onclick: chooseDrive }, t('chooseAgain'))),
    S.error ? h('div', { class: 'notice err' }, S.error) : null);

  if (!d.tested) {
    card.append(h('div', { class: 'notice warn' }, t('untested')),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: S.untestedOk, onchange: (e) => { S.untestedOk = e.target.checked; render(); } }),
        h('span', {}, t('tryAnyway'))));
  }

  const hasItems = S.scan.items.length > 0;
  if (status === 'installed') {
    card.append(h('button', { class: 'btn primary big wide', onclick: goHome }, t('done')),
      h('div', { class: 'row center' },
        h('button', { class: 'btn small', disabled: !ok, onclick: startInstall }, t(installLabel)),
        h('button', { class: 'btn small danger', onclick: startRemove }, t('doRemove'))));
  } else {
    card.append(h('button', { class: 'btn primary big wide', disabled: !ok, onclick: startInstall }, icon('install'), t(installLabel)));
    if (hasItems) card.append(h('div', { class: 'row center' }, h('button', { class: 'btn small danger', onclick: startRemove }, t('doRemove'))));
  }

  card.append(nav(h('button', { class: 'btn', onclick: () => go(0) }, t('back'))));
  return card;
}

// ---------- install / remove ----------

async function load(file, onProgress) {
  const res = await fetch(file.url, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new kobo.KitError('badDownload', file.url);
  const reader = res.body.getReader();
  const out = new Uint8Array(file.size);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > out.length) throw new kobo.KitError('badDownload', file.url);
    out.set(value, got);
    got += value.length;
    onProgress(got);
  }
  if (got !== file.size) throw new kobo.KitError('badDownload', file.url);
  return out;
}

// Several low-level steps (e.g. two font copies) show as one plain step.
function setSteps(groups, members) {
  S.groupOf = Object.fromEntries(members);
  S.steps = groups.map(([id, label]) => ({
    id, label, status: 'wait', done: 0, total: members.filter((m) => m[1] === id).length || 1,
  }));
}

function onStep(id, status, info) {
  const s = S.steps.find((x) => x.id === (S.groupOf[id] || id));
  if (!s) return;
  if (status === 'done') {
    s.done += 1;
    s.status = s.done >= s.total ? 'done' : 'run';
  } else {
    s.status = status;
    s.info = info;
  }
  render();
}

async function run(task) {
  S.running = true; S.error = null; S.finished = false;
  render();
  try {
    await task();
    S.finished = true;
  } catch (e) {
    console.error(e);
    S.error = errMsg(e);
    for (const s of S.steps) if (s.status === 'run') s.status = 'wait';
  }
  S.running = false;
  render();
}

function runInstall() {
  const members = manifest.files.flatMap((f) => f.dest.map((d) => [`copy:${d}`, f.id === 'dictionary' ? 'dict' : 'font']));
  setSteps(['download', 'backup', 'dict', 'font', 'setting', 'record'].map((g) => [g, `step_${g}`]), members);
  return run(async () => {
    const r = await kobo.install(S.root, manifest, load, onStep);
    S.confMissing = r.confMissing;
  });
}

function runRemove() {
  const group = { dictionary: 'dict', otherDict: 'dict', oldDict: 'dict', font: 'font', oldFont: 'font', conf: 'conf', kit: 'kit' };
  const members = S.scan.items.filter((i) => i.checked).map((i) => [`del:${i.path}`, group[i.id]]);
  const groups = ['dict', 'font', 'conf', 'kit'].filter((g) => members.some((m) => m[1] === g));
  setSteps(groups.map((g) => [g, `rm_${g}`]), members);
  return run(() => kobo.remove(S.root, S.scan.items, onStep));
}

function stepLabel(s) {
  const label = t(s.label);
  return s.id === 'download' && s.status === 'run' ? `${label} … ${num(s.info || 0)}%` : label;
}

function progressList() {
  return h('ul', { class: 'progress-list' }, S.steps.map((s) => h('li', { class: s.status },
    h('span', { class: 'icon' }, s.status === 'run' ? h('span', { class: 'spinner' }) : s.status === 'done' ? '✓' : s.status === 'skip' ? '–' : '·'),
    h('span', { class: 'label' }, stepLabel(s), s.status === 'skip' ? ` (${t('skipped')})` : ''))));
}

function actionCard() {
  const install = S.mode === 'install';
  const started = install || S.running || S.finished || S.steps.length;
  if (!started) {
    return h('section', { class: 'card' },
      h('div', { class: 'status remove' },
        h('div', { class: 'status-icon' }, icon('remove')),
        h('h2', {}, t('removeTitle')),
        h('p', {}, t('removeSub'))),
      h('button', { class: 'btn danger solid big wide', onclick: runRemove }, t('doRemove')),
      nav(h('button', { class: 'btn', onclick: () => go(1) }, t('back'))));
  }
  const card = h('section', { class: 'card' }, h('h2', {}, t(install ? 'installTitle' : 'removingTitle')));
  if (S.running) card.append(h('div', { class: 'notice info' }, t('keepOpen')));
  card.append(progressList());
  if (S.error) {
    card.append(h('div', { class: 'notice err' }, S.error),
      nav(h('button', { class: 'btn', onclick: () => { S.steps = []; go(1); } }, t('back')),
        h('button', { class: 'btn primary', onclick: install ? runInstall : runRemove }, t('again'))));
  } else if (S.finished) {
    if (S.confMissing) card.append(h('div', { class: 'notice warn' }, t('confMissing')));
    card.append(nav(null, h('button', { class: 'btn primary', onclick: () => go(3) }, `${t('next')} →`)));
  }
  return card;
}

// ---------- finish ----------

function finishCard() {
  const install = S.mode === 'install';
  const card = h('section', { class: 'card' },
    h('h2', {}, t(install ? 'finishInstall' : 'finishRemove')),
    h('ol', { class: 'steps' }, h('li', {}, t('fin1')), h('li', {}, t('fin2')), install ? h('li', {}, t('fin3')) : null));
  if (install) {
    const mock = document.getElementById('popup-mock').cloneNode(true);
    mock.removeAttribute('id');
    card.append(h('div', { class: 'expect' }, t('finExpect'), mock));
  }
  card.append(nav(null, h('button', { class: 'btn primary', onclick: goHome }, t('home'))));
  return card;
}

// ---------- manual (other browsers) ----------

function manualCard() {
  const [dict, font] = ['dictionary', 'font'].map((id) => manifest.files.find((f) => f.id === id));
  const line = `GeoBasedSystemFonts=${[...kobo.GEO_DEFAULT, kobo.FAMILY].join(', ')}`;
  const copyBtn = h('button', { class: 'btn', onclick: async (e) => {
    try { await navigator.clipboard.writeText(line); e.target.textContent = t('copied'); } catch { /* clipboard blocked */ }
  } }, t('copy'));
  return h('section', { class: 'card' },
    h('h2', {}, t('manualTitle')),
    h('p', { class: 'sub' }, t('manualIntro')),
    h('ol', { class: 'steps' },
      h('li', {}, t('man1', { path: '.kobo/custom-dict/' }), h('br'),
        h('a', { class: 'btn', href: dict.url, download: 'dicthtml-en-my.zip' }, t('dlDict'))),
      h('li', {}, t('man2', { a: 'fonts/', b: 'fonts/kobo/' }), h('br'),
        h('a', { class: 'btn', href: font.url, download: 'NotoSansMyanmarKobo-Regular.ttf' }, t('dlFont'))),
      h('li', {}, t('man3', { path: kobo.CONF }), h('div', { class: 'codeline' }, h('code', {}, line), copyBtn)),
      h('li', {}, t('man4'))),
    h('div', { class: 'notice info' }, t('hidden')),
    nav(h('button', { class: 'btn', onclick: () => go(0) }, t('back'))));
}

// ---------- start ----------

applyText();
fetch('manifest.json', { cache: 'no-store' })
  .then((r) => r.json())
  .then((m) => { manifest = m; applyText(); route(); })
  .catch((e) => console.error('manifest', e));
