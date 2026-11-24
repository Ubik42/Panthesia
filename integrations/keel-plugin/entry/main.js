/* Panthesia plugin for Keel.
 *
 * A thin adapter: every fact comes from `Panthesia.exe probe`, the same song summary that
 * Panthesia's song page shows, so MIDI, scores and manifests are parsed in Panthesia only.
 * Keel gives plugins file contents, not file locations. For each song the plugin rebuilds a
 * small copy of its folder in a temporary directory: the song itself, its `.panthesia`
 * manifest (a Keel companion) and empty placeholders named like the other files in the folder,
 * so Panthesia can tell which audio, vocals and scores belong to the song. `probe --detached`
 * then reports the files the manifest lists without looking for them on disk.
 * Results are cached per song, manifest and folder listing.
 *
 * Panthesia is found through PANTHESIA_EXE, else the App Paths entry it writes on launch.
 *
 * "用 Panthesia 练习" (asset menu, open group; also the song card's submit button) opens the real
 * file on Panthesia's stage. Keel withholds absolute paths, so `Panthesia.exe locate` finds the
 * file from its library-relative path and size, under the library folder or Panthesia's song
 * folder; then `Panthesia.exe --play <file>` starts (or hands over to the running window).
 */
/* global exports, require */
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const SONG_EXTENSIONS = new Set(['.mid', '.midi', '.kar', '.musicxml', '.mxl', '.abc']);
const APP_PATHS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Panthesia.exe';
const READ_CHUNK = 1024 * 1024;
const READ_LIMIT = 32 * 1024 * 1024;
const THUMBNAIL_SIZE = '480x160';
const THUMBNAIL_LIMIT = 256 * 1024;
const PROBE_TIMEOUT_MS = 20_000;
const CONCURRENCY = 4;
const DEADLINE_MARGIN_MS = 3_000;
const FOLDER_TTL_MS = 30_000;
const FOLDER_LIMIT = 400;

let keel;
let cacheDir;
let exePath;
const pending = new Map();
const folders = new Map();

function run(file, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stdout || stderr || error.message).trim().slice(0, 500)));
      else resolve(String(stdout));
    });
  });
}

async function panthesia() {
  if (exePath) return exePath;
  const fromEnv = process.env.PANTHESIA_EXE;
  if (fromEnv) return (exePath = fromEnv);
  const output = await run('reg', ['query', APP_PATHS_KEY, '/ve'], 5_000).catch(() => '');
  const match = /REG_(?:EXPAND_)?SZ\s+(.+\.exe)\s*$/imu.exec(output);
  if (!match) throw new Error('找不到 Panthesia：请先启动一次 Panthesia，或设置环境变量 PANTHESIA_EXE。');
  return (exePath = match[1].trim());
}

async function cacheRoot() {
  if (!cacheDir) {
    const { path: root } = await keel.data.getDirectory({ scope: 'user' });
    cacheDir = path.join(root, 'probe-v2');
    await fs.mkdir(cacheDir, { recursive: true });
  }
  return cacheDir;
}

function isSong(asset) {
  return SONG_EXTENSIONS.has(path.extname(asset.relativeFilePath || asset.name || '').toLowerCase());
}

async function readAll(assetId) {
  const parts = [];
  let offset = 0;
  for (;;) {
    const chunk = await keel.assets.readContent(assetId, { maxBytes: READ_CHUNK, offsetBytes: offset });
    const bytes = Buffer.from(chunk.dataBase64 || '', 'base64');
    parts.push(bytes);
    offset += bytes.length;
    if (!chunk.truncated || bytes.length === 0) break;
    if (offset >= READ_LIMIT) throw new Error('文件过大');
  }
  return Buffer.concat(parts);
}

const posixDir = (relative) => path.posix.dirname(String(relative || '').replace(/\\/g, '/'));
const items = (value) => (Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.assets) ? value.assets : []);

/** Names of the files in the song's folder (from Keel's index), cached briefly per folder. */
async function folderNames(relative) {
  const dir = posixDir(relative);
  const cached = folders.get(dir);
  if (cached && Date.now() - cached.at < FOLDER_TTL_MS) return cached.names;
  const job = (async () => {
    const query = dir === '.' ? null : `path:"${dir.replace(/"/g, '')}"`;
    const found = items(await keel.assets.search({ query, limit: 200 })).map((r) => r.assetId || r.id).filter(Boolean);
    const names = [];
    for (let i = 0; i < found.length && names.length < FOLDER_LIMIT; i += 200) {
      for (const a of items(await keel.assets.list({ assetIds: found.slice(i, i + 200), limit: 200 }))) {
        if (a.relativeFilePath && posixDir(a.relativeFilePath) === dir) {
          names.push({ name: path.posix.basename(a.relativeFilePath), id: a.id || a.assetId, revisionId: a.currentRevisionId || '' });
        }
      }
    }
    return names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  })().catch(() => []);
  folders.set(dir, { at: Date.now(), names: job });
  return job;
}

/** The song's `.panthesia` companion, if Keel lists one: `{ id, name, revisionId }`. */
async function manifestOf(assetId) {
  try {
    const result = await keel.assets.getMetadata(assetId);
    // Keel answers `{ metadata: { companions } }`.
    const metadata = result?.metadata ?? result;
    const companion = (metadata?.companions || []).find((c) => /\.panthesia$/iu.test(c.fileName || ''));
    if (!companion) return null;
    const listed = items(await keel.assets.list({ assetIds: [companion.assetId], limit: 1 }))[0];
    return { id: companion.assetId, name: companion.fileName, revisionId: listed?.currentRevisionId || '' };
  } catch (error) {
    keel.console.log(`Panthesia 读取歌曲清单失败：${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/** Probe one song: `{ summary, thumbnail }` (thumbnail is a PNG Buffer or null). */
async function probe(asset) {
  const [own, names] = await Promise.all([manifestOf(asset.assetId), folderNames(asset.relativeFilePath || asset.name)]);
  // Keel attaches `x.panthesia` to one of the files named `x.*` (e.g. `x.abc` before `x.mid`),
  // so a song without its own companion looks at the files that share its name.
  let companion = own;
  const stem = path.posix.parse(path.posix.basename(String(asset.relativeFilePath || asset.name || ''))).name;
  for (const n of names) {
    if (companion) break;
    if (n.id !== asset.assetId && path.posix.parse(n.name).name === stem && !/\.panthesia$/iu.test(n.name)) companion = await manifestOf(n.id);
  }
  // A folder manifest (`song.panthesia`) can describe the song too; Panthesia decides which applies.
  const folder = names.find((n) => n.name.toLowerCase() === 'song.panthesia');
  const manifests = [companion, folder && { id: folder.id, name: folder.name, revisionId: folder.revisionId }].filter(Boolean);
  const key = crypto
    .createHash('sha256')
    .update([asset.assetId, asset.revisionId || '', ...manifests.map((m) => m.revisionId), ...names.map((n) => n.name)].join('\n'))
    .digest('hex')
    .slice(0, 32);
  if (!pending.has(key)) {
    const job = probeUncached(asset, manifests, names, key).finally(() => {
      if (!asset.revisionId) pending.delete(key);
    });
    pending.set(key, job);
    job.catch(() => pending.delete(key));
  }
  return pending.get(key);
}

async function probeUncached(asset, manifests, names, key) {
  const root = await cacheRoot();
  const summaryFile = path.join(root, `${key}.json`);
  const pngFile = path.join(root, `${key}.png`);
  if (asset.revisionId) {
    const cached = await fs.readFile(summaryFile, 'utf8').catch(() => null);
    if (cached) return { summary: JSON.parse(cached), thumbnail: await fs.readFile(pngFile).catch(() => null) };
  }
  const exe = await panthesia();
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'panthesia-keel-'));
  try {
    const name = path.basename(asset.relativeFilePath || asset.name || 'song.mid');
    const song = path.join(work, name);
    // Placeholders first, then the real song and manifest over their own names.
    const safe = (n) => n !== name && n !== '.' && n !== '..' && !/[\\/]/u.test(n);
    await Promise.all(names.filter((n) => safe(n.name)).map((n) => fs.writeFile(path.join(work, n.name), '').catch(() => {})));
    await fs.writeFile(song, await readAll(asset.assetId));
    for (const m of manifests) await fs.writeFile(path.join(work, path.basename(m.name)), await readAll(m.id));
    const png = path.join(work, '.thumbnail.png');
    const output = await run(exe, ['probe', song, '--json', '--detached', '--thumbnail', png, '--size', THUMBNAIL_SIZE], PROBE_TIMEOUT_MS);
    const summary = JSON.parse(output.slice(output.indexOf('{')));
    if (summary.error) throw new Error(summary.error);
    const thumbnail = await fs.readFile(png).catch(() => null);
    if (asset.revisionId) {
      await fs.writeFile(summaryFile, JSON.stringify(summary));
      if (thumbnail) await fs.writeFile(pngFile, thumbnail);
    }
    return { summary, thumbnail };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/** Run `fn` over the song assets of a batch, a few at a time, until the deadline is near. */
async function each(batch, context, fn) {
  const songs = batch.filter(isSong);
  const results = [];
  let next = 0;
  const stopAt = (context && context.deadlineAt ? context.deadlineAt : Date.now() + 30_000) - DEADLINE_MARGIN_MS;
  async function worker() {
    while (next < songs.length && Date.now() < stopAt) {
      const asset = songs[next++];
      try {
        const value = await fn(asset, await probe(asset));
        if (value) results.push(value);
      } catch (error) {
        keel.console.log(`Panthesia 无法读取 ${asset.name}：${error instanceof Error ? error.message : error}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const noteName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/** Harte key ("Eb:min") as a reader sees it ("Eb 小调"); the same wording as Panthesia. */
function keyLabel(key) {
  if (!key) return null;
  const [tonic, mode] = key.split(':');
  return `${tonic} ${mode === 'min' ? '小调' : '大调'}`;
}

/** Materials that are present (listed in the manifest or found next to the song). */
function presentMaterials(summary) {
  return (summary.materials || []).filter((m) => (m.items || []).some((i) => i.state !== 'missing'));
}

/** Metadata fields: the facts and materials of Panthesia's song page. */
function metadata(summary) {
  const facts = summary.facts || {};
  const range = Array.isArray(facts.pitchRange) ? `${noteName(facts.pitchRange[0])}–${noteName(facts.pitchRange[1])}` : null;
  const has = new Set(presentMaterials(summary).map((m) => m.kind));
  const layers = (summary.layers || []).filter((l) => l.origin).map((l) => l.label);
  return {
    title: facts.title ?? null,
    artist: facts.artist ?? null,
    durationSeconds: facts.durationSeconds ?? null,
    bpm: facts.bpm ?? null,
    bpmSource: facts.bpmSource ?? null,
    timeSignature: facts.timeSignature ?? null,
    key: keyLabel(facts.key),
    keySource: facts.keySource ?? null,
    measures: facts.measures ?? 0,
    tracks: facts.tracks ?? 0,
    notes: facts.notes ?? 0,
    pitchRange: range,
    materials: materialsText(summary),
    hasScore: has.has('musicxml') || has.has('abc') || has.has('paper'),
    hasSourceAudio: has.has('source'),
    hasVocals: has.has('vocals'),
    hasAccompaniment: has.has('accompaniment'),
    layers: layers.length ? layers.join(' · ') : null,
    hasManifest: summary.manifest !== null && summary.manifest !== undefined,
  };
}

const SHORT = { performance: 'MIDI', musicxml: '五线谱', abc: 'ABC', paper: 'PDF', source: '原曲', vocals: '人声', accompaniment: '伴奏', stems: '分轨' };
function materialsText(summary) {
  return presentMaterials(summary).map((m) => SHORT[m.kind] || m.label).join(' · ') || null;
}

const SOURCE_NAMES = { manifest: '清单', filename: '文件名', estimated: '估计' };
const ORIGIN_NAMES = { human: '人工', imported: '导入', generated: '生成' };
const STATE_NAMES = { current: '当前', present: '有', registered: '已登记', missing: '找不到', found: '同文件夹中发现' };
const EMPTY = { performance: '没有 MIDI', musicxml: '没有', abc: '没有', paper: '没有', source: '没有', vocals: '没有', accompaniment: '没有' };

function duration(seconds) {
  if (typeof seconds !== 'number') return '—';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const withSource = (value, source) => (value && SOURCE_NAMES[source] ? `${value}（${SOURCE_NAMES[source]}）` : value || '—');
/** A list cell: present things in the host's "match" tone, missing ones plain. */
const cell = (text, on) => (on ? { segments: [{ text, tone: 'match' }] } : text);

/** The song card in Keel's own dialog widgets: overview, materials and layers, the same facts
 * and wording as Panthesia's song page. */
function songCard(ui, item, summary) {
  const f = summary.facts || {};
  const range = Array.isArray(f.pitchRange) ? `${noteName(f.pitchRange[0])}–${noteName(f.pitchRange[1])}` : '—';
  const overview = [
    ['时长', duration(f.durationSeconds)],
    ['速度', withSource(f.bpm ? `${Math.round(f.bpm)} BPM` : null, f.bpmSource)],
    ['拍号', f.timeSignature || '—'],
    ['调', withSource(keyLabel(f.key), f.keySource)],
    ['音域', range],
    ['小节', String(f.measures ?? '—')],
    ['轨道 · 音符', `${f.tracks ?? 0} · ${f.notes ?? 0}`],
  ];
  const materials = (summary.materials || []).map((m) => {
    const items = m.items || [];
    if (!items.length) return [m.label, EMPTY[m.kind] || '没有', '—'];
    const names = items.map((i) => path.posix.basename(String(i.relative || '').replace(/\\/g, '/'))).join('、');
    const states = [...new Set(items.map((i) => (i.origin === 'generated' ? '生成' : STATE_NAMES[i.state] || i.state)))].join('、');
    return [m.label, cell(states, items.some((i) => i.state !== 'missing' && i.state !== 'found')), names];
  });
  const layers = (summary.layers || []).map((l) => [l.label, cell(l.origin ? ORIGIN_NAMES[l.origin] : '—', !!l.origin), l.count ? String(l.count) : '']);
  return ui.column(
    ui.heading(f.artist ? `${f.title || item.name} · ${f.artist}` : f.title || item.name),
    ui.note(`${duration(f.durationSeconds)} · ${f.bpm ? `${Math.round(f.bpm)} BPM` : '—'} · ${f.timeSignature || '—'} · ${keyLabel(f.key) || '—'}`),
    ui.tabs({
      id: 'section',
      value: 'materials',
      tabs: [
        { id: 'materials', label: '资料', children: [ui.list({ columns: ['资料', '状态', '文件'], rows: materials })] },
        { id: 'overview', label: '概览', children: [ui.list({ columns: ['项目', '内容'], rows: overview })] },
        { id: 'layers', label: '图层', children: [ui.list({ columns: ['图层', '来源', '条目'], rows: layers })] },
      ],
    }),
    ui.note(summary.manifest ? '资料来自歌曲清单与同文件夹的文件。缺少的资料可以在 Panthesia 的歌曲详情中生成。' : '这首歌还没有歌曲清单。缺少的资料可以在 Panthesia 的歌曲详情中生成。'),
  );
}

/** The selected song's real location, found by Panthesia (see the header). */
async function locate(item) {
  const exe = await panthesia();
  const args = ['locate', String(item.relativeFilePath || item.name), '--json'];
  if (typeof item.byteSize === 'number') args.push('--size', String(item.byteSize));
  if (item.locationKind !== 'linked') {
    // The plugin's library folder is `<library>/.serpent/plugin-files/<id>`.
    const { path: own } = await keel.data.getDirectory({ scope: 'library' }).catch(() => ({ path: null }));
    if (own) args.push('--root', path.resolve(own, '..', '..', '..'));
  }
  const output = await run(exe, args, PROBE_TIMEOUT_MS).catch((error) => error.message);
  let result;
  try {
    result = JSON.parse(output.slice(output.indexOf('{')));
  } catch {
    throw new Error(output || 'Panthesia 没有返回文件位置。');
  }
  if (!result.path) throw new Error(result.error || 'Panthesia 没有返回文件位置。');
  return result.path;
}

/** Open the song on Panthesia's stage with the remembered practice mode and hands. */
async function practice(item) {
  try {
    const exe = await panthesia();
    const file = await locate(item);
    spawn(exe, ['--play', file], { detached: true, stdio: 'ignore' }).unref();
  } catch (error) {
    await keel.ui.notify({
      severity: 'error',
      title: '无法用 Panthesia 练习',
      message: `${(error instanceof Error ? error.message : String(error)).replace(/。$/u, '')}。可以在 Panthesia 的设置中把曲目文件夹设为这首歌所在的文件夹。`,
    });
  }
}

const selectedSong = (context) => (((context.invocation && context.invocation.selection) || {}).assets || []).find(isSong);

async function practiceSelected(context) {
  const item = selectedSong(context);
  if (item) await practice(item);
  else await keel.ui.notify({ severity: 'info', message: '请选择一个 MIDI 或乐谱文件。' });
}

/** Inspector section: the selected song's card; its submit button starts practising. */
async function showFacts(context) {
  const item = selectedSong(context);
  if (!item) {
    await keel.ui.notify({ severity: 'info', message: '请选择一个 MIDI 或乐谱文件。' });
    return;
  }
  const asset = { assetId: item.id, name: item.name, relativeFilePath: item.relativeFilePath, revisionId: item.currentRevisionId };
  try {
    const { summary } = await probe(asset);
    const result = await keel.ui.openDialog({ title: '歌曲信息', submitLabel: '开始练习', render: (ui) => songCard(ui, item, summary) });
    if (result !== null && result !== undefined) await practice(item);
  } catch (error) {
    await keel.ui.notify({ severity: 'error', title: 'Panthesia', message: error instanceof Error ? error.message : String(error) });
  }
}

exports.setup = async function setup(context) {
  keel = context.keel || context.serpent || context;
  keel.commands.register('show-song-facts', showFacts);
  keel.commands.register('practice-in-panthesia', practiceSelected);
  keel.providers.register('thumbnail', {
    id: 'song-thumbnail',
    compute: (batch, ctx) => each(batch, ctx, (asset, { thumbnail }) =>
      thumbnail && thumbnail.length <= THUMBNAIL_LIMIT
        ? { assetId: asset.assetId, media: { mimeType: 'image/png', bytesBase64: thumbnail.toString('base64') } }
        : null),
  });
  keel.providers.register('metadata', {
    id: 'song-facts',
    compute: (batch, ctx) => each(batch, ctx, (asset, { summary }) => ({ assetId: asset.assetId, metadata: metadata(summary) })),
  });
  const field = (id, pick) => keel.providers.register('derived-field', {
    id,
    compute: (batch, ctx) => each(batch, ctx, (asset, { summary }) => {
      const value = pick(summary);
      return value === null || value === undefined ? null : { assetId: asset.assetId, value };
    }),
  });
  field('song-bpm', (s) => s.facts?.bpm);
  field('song-key', (s) => keyLabel(s.facts?.key));
  field('song-duration', (s) => s.facts?.durationSeconds);
  field('song-materials', (s) => materialsText(s));
};

exports.dispose = async function dispose() {
  pending.clear();
  folders.clear();
};
