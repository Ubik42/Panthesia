/* Panthesia plugin for Keel.
 *
 * A thin adapter: every fact comes from `Panthesia.exe probe`, so MIDI, MusicXML and
 * manifests are parsed in Panthesia's Rust code only. Keel gives plugins file contents,
 * not file locations, so each song is read through `assets.readContent`, written to a
 * temporary file under its own name (a "BPM76" in the name still counts) and probed there.
 * Results are cached per asset revision in the plugin's data folder.
 *
 * Panthesia is found through PANTHESIA_EXE, else the App Paths entry it writes on launch.
 */
/* global exports, require */
const { execFile } = require('node:child_process');
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

let keel;
let cacheDir;
let exePath;
const pending = new Map();

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
    cacheDir = path.join(root, 'probe-v1');
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

/** Probe one asset revision: `{ facts, thumbnail }` (thumbnail is a PNG Buffer or null). */
function probe(asset) {
  const id = crypto.createHash('sha256').update(`${asset.assetId}\n${asset.revisionId || ''}`).digest('hex').slice(0, 32);
  if (!pending.has(id)) {
    const job = probeUncached(asset, id).finally(() => {
      if (!asset.revisionId) pending.delete(id);
    });
    pending.set(id, job);
    job.catch(() => pending.delete(id));
  }
  return pending.get(id);
}

async function probeUncached(asset, id) {
  const root = await cacheRoot();
  const factsFile = path.join(root, `${id}.json`);
  const pngFile = path.join(root, `${id}.png`);
  if (asset.revisionId) {
    const cached = await fs.readFile(factsFile, 'utf8').catch(() => null);
    if (cached) return { facts: JSON.parse(cached), thumbnail: await fs.readFile(pngFile).catch(() => null) };
  }
  const exe = await panthesia();
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'panthesia-keel-'));
  try {
    const name = path.basename(asset.relativeFilePath || asset.name || 'song.mid');
    const song = path.join(work, name);
    await fs.writeFile(song, await readAll(asset.assetId));
    const png = path.join(work, 'thumbnail.png');
    const output = await run(exe, ['probe', song, '--json', '--thumbnail', png, '--size', THUMBNAIL_SIZE], PROBE_TIMEOUT_MS);
    const facts = JSON.parse(output.slice(output.indexOf('{')));
    const thumbnail = await fs.readFile(png).catch(() => null);
    if (asset.revisionId) {
      await fs.writeFile(factsFile, JSON.stringify(facts));
      if (thumbnail) await fs.writeFile(pngFile, thumbnail);
    }
    return { facts, thumbnail };
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
function noteName(midi) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Harte key ("Eb:min") as a reader sees it ("Eb 小调"). */
function keyLabel(key) {
  if (!key) return null;
  const [tonic, mode] = key.split(':');
  return `${tonic} ${mode === 'min' ? '小调' : '大调'}`;
}

function metadata(facts) {
  const manifest = facts.manifest || null;
  const layers = facts.importedLayers || {};
  return {
    title: facts.title ?? null,
    artist: facts.artist ?? null,
    durationSeconds: facts.durationSeconds ?? null,
    bpm: facts.bpm ?? null,
    bpmSource: facts.bpmSource ?? null,
    tempoChanges: facts.tempoChanges ?? 0,
    timeSignature: facts.timeSignature ?? null,
    key: keyLabel(facts.key),
    keySource: facts.keySource ?? null,
    tracks: facts.tracks ?? 0,
    notes: facts.notes ?? 0,
    pitchRange: Array.isArray(facts.pitchRange) ? `${noteName(facts.pitchRange[0])}–${noteName(facts.pitchRange[1])}` : null,
    lyrics: (layers.lyrics ?? 0) > 0,
    sections: Array.isArray(layers.sections) && layers.sections.length ? layers.sections.join(' / ').slice(0, 1000) : null,
    hasManifest: manifest !== null,
  };
}

function formatDuration(seconds) {
  if (typeof seconds !== 'number') return '—';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const SOURCES = { manifest: '清单', midi: '文件', filename: '文件名', signature: '调号', estimated: '估计' };
function withSource(value, source) {
  if (value === null || value === undefined) return '—';
  return SOURCES[source] ? `${value}（${SOURCES[source]}）` : String(value);
}

/** Inspector section: the selected songs' facts in a dialog. */
async function showFacts(context) {
  const selection = (context.invocation && context.invocation.selection) || {};
  const assets = (selection.assets || []).filter(isSong).slice(0, 8);
  const rows = [];
  for (const item of assets) {
    const asset = { assetId: item.id, name: item.name, relativeFilePath: item.relativeFilePath, revisionId: item.currentRevisionId };
    try {
      const facts = metadata((await probe(asset)).facts);
      const name = item.name;
      rows.push(
        [name, '时长', formatDuration(facts.durationSeconds)],
        [name, 'BPM', withSource(facts.bpm, facts.bpmSource)],
        [name, '拍号', facts.timeSignature || '—'],
        [name, '调', withSource(facts.key, facts.keySource)],
        [name, '轨道 / 音符', `${facts.tracks} / ${facts.notes}`],
        [name, '音域', facts.pitchRange || '—'],
      );
      if (facts.sections) rows.push([name, '段落', facts.sections]);
    } catch (error) {
      rows.push([item.name, '错误', error instanceof Error ? error.message : String(error)]);
    }
  }
  await keel.ui.openDialog({
    title: '歌曲信息',
    submitLabel: '完成',
    render: (ui) => ui.list({
      columns: assets.length > 1 ? ['文件', '项目', '内容'] : ['项目', '内容'],
      rows: assets.length > 1 ? rows : rows.map((row) => row.slice(1)),
      emptyText: '没有可以读取的 MIDI 或乐谱文件。',
    }),
  });
}

exports.setup = async function setup(context) {
  keel = context.keel || context.serpent || context;
  keel.commands.register('show-song-facts', showFacts);
  keel.providers.register('thumbnail', {
    id: 'song-thumbnail',
    compute: (batch, ctx) => each(batch, ctx, (asset, { thumbnail }) =>
      thumbnail && thumbnail.length <= THUMBNAIL_LIMIT
        ? { assetId: asset.assetId, media: { mimeType: 'image/png', bytesBase64: thumbnail.toString('base64') } }
        : null),
  });
  keel.providers.register('metadata', {
    id: 'song-facts',
    compute: (batch, ctx) => each(batch, ctx, (asset, { facts }) => ({ assetId: asset.assetId, metadata: metadata(facts) })),
  });
  const field = (id, pick) => keel.providers.register('derived-field', {
    id,
    compute: (batch, ctx) => each(batch, ctx, (asset, { facts }) => {
      const value = pick(facts);
      return value === null || value === undefined ? null : { assetId: asset.assetId, value };
    }),
  });
  field('song-bpm', (facts) => facts.bpm);
  field('song-key', (facts) => keyLabel(facts.key));
  field('song-duration', (facts) => facts.durationSeconds);
};

exports.dispose = async function dispose() {
  pending.clear();
};
