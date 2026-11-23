/**
 * Which files the last few commits touched, read straight from a `.git`
 * folder on this machine.
 *
 * This is the smallest reader that answers one question: "which loaded files
 * changed recently?". It follows HEAD back along first parents, and for each
 * commit compares its tree with its parent's to get the paths that differ. It
 * reads loose objects and packfiles (version 2 indexes, including delta
 * objects). Nothing leaves the device and no network is used: every byte comes
 * from the folder the user picked.
 *
 * What it keeps is deliberately little: a path, the short id and date of the
 * newest commit that touched it, and how many commits back that was. No commit
 * message, no author name and no email are read into the result, so none of
 * them can be indexed, shown or spoken.
 *
 * It is optional in every sense. No `.git`, a worktree whose `.git` is a
 * pointer file, a SHA-256 repository, a shallow clone that runs out of
 * history, a pack index too large to load, or a corrupt object all end the
 * same way: the walk stops and whatever was learned so far is returned. An
 * empty result only means ranking gets no recency signal.
 */

/** Read access to the files under one `.git` folder. Paths are relative to it. */
export type GitFiles = {
  /** The file at `path` ("HEAD", "objects/ab/cdef..."), or null when there is none. */
  file(path: string): Promise<Blob | null>;
  /** Names directly inside `dir` ("objects/pack"). Empty when there is none. */
  list(dir: string): Promise<string[]>;
};

/** A loaded file and the newest recent commit that changed it. */
export type FileChange = {
  /** Repository-relative path, forward slashes. */
  path: string;
  /** First seven characters of the commit id. */
  sha: string;
  /** Commit date, ISO 8601, or "" when the commit did not record one. */
  date: string;
  /** Commits back from HEAD along first parents. 0 is HEAD itself. */
  age: number;
};

export type GitHistoryOptions = {
  /** How many commits back to look. */
  maxCommits?: number;
  /** Stop after reading this many objects. */
  maxObjects?: number;
  /** Stop after this long. */
  budgetMs?: number;
  /** Stop once this many paths have been recorded. */
  maxPaths?: number;
  now?: () => number;
};

export const GIT_HISTORY_DEFAULTS = {
  maxCommits: 30,
  maxObjects: 4000,
  budgetMs: 2500,
  maxPaths: 5000,
} as const;

/** A pack index larger than this is not loaded. Its objects are simply not found. */
const MAX_INDEX_BYTES = 48 * 1024 * 1024;
/** An object larger than this is not a commit or a tree worth reading. */
const MAX_OBJECT_BYTES = 8 * 1024 * 1024;

const OBJ_COMMIT = 1;
const OBJ_TREE = 2;
const OBJ_OFS_DELTA = 6;
const OBJ_REF_DELTA = 7;
const TYPE_NAME: Record<number, string> = { 1: "commit", 2: "tree", 3: "blob", 4: "tag" };
const TYPE_CODE: Record<string, number> = { commit: 1, tree: 2, blob: 3, tag: 4 };

type GitObject = { type: number; data: Uint8Array };

class Stop extends Error {}

const decoder = new TextDecoder("utf-8", { fatal: false });

async function bytesOf(blob: Blob, start = 0, end = blob.size): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/** Inflates one complete zlib stream. Works in browsers and in Node 18+. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function hex(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length; i += 1) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function fromHex(text: string): Uint8Array {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const SHA = /^[0-9a-f]{40}$/;

/** One packfile, through its version 2 index. */
type Pack = {
  pack: Blob;
  count: number;
  fanout: Uint32Array;
  /** `count` 20-byte ids, sorted. */
  ids: Uint8Array;
  /** Offset of each object in `pack`, in id order. */
  offsets: Float64Array;
  /** The same offsets, ascending, for finding where an object ends. */
  sorted: Float64Array;
};

async function openPack(git: GitFiles, name: string): Promise<Pack | null> {
  const index = await git.file(`objects/pack/${name}.idx`);
  const pack = await git.file(`objects/pack/${name}.pack`);
  if (!index || !pack || index.size > MAX_INDEX_BYTES || index.size < 8 + 1024) return null;
  const raw = await bytesOf(index);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  // "\377tOc", then version 2. Version 1 indexes have no header and are not read.
  if (view.getUint32(0) !== 0xff744f63 || view.getUint32(4) !== 2) return null;
  const fanout = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) fanout[i] = view.getUint32(8 + i * 4);
  const count = fanout[255];
  const idsAt = 8 + 1024;
  const offsetsAt = idsAt + count * 20 + count * 4;
  const largeAt = offsetsAt + count * 4;
  if (largeAt > raw.byteLength) return null;
  const offsets = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const value = view.getUint32(offsetsAt + i * 4);
    if (value & 0x80000000) {
      const at = largeAt + (value & 0x7fffffff) * 8;
      if (at + 8 > raw.byteLength) return null;
      offsets[i] = view.getUint32(at) * 2 ** 32 + view.getUint32(at + 4);
    } else {
      offsets[i] = value;
    }
  }
  return {
    pack,
    count,
    fanout,
    ids: raw.subarray(idsAt, idsAt + count * 20),
    offsets,
    sorted: Float64Array.from(offsets).sort(),
  };
}

function findInPack(pack: Pack, id: Uint8Array): number | null {
  let low = id[0] === 0 ? 0 : pack.fanout[id[0] - 1];
  let high = pack.fanout[id[0]] - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    let order = 0;
    for (let i = 0; i < 20 && order === 0; i += 1) order = pack.ids[mid * 20 + i] - id[i];
    if (order === 0) return pack.offsets[mid];
    if (order < 0) low = mid + 1;
    else high = mid - 1;
  }
  return null;
}

/** Where the object starting at `offset` ends: the next object, or the trailer. */
function endOf(pack: Pack, offset: number): number {
  let low = 0;
  let high = pack.sorted.length - 1;
  let next = pack.pack.size - 20;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (pack.sorted[mid] > offset) {
      next = pack.sorted[mid];
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return next;
}

/** Applies a git delta to its base. */
function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let at = 0;
  const size = () => {
    let value = 0;
    let shift = 0;
    let byte = 0;
    do {
      byte = delta[at];
      at += 1;
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80 && at < delta.length);
    return value;
  };
  const baseSize = size();
  const outSize = size();
  if (baseSize !== base.length || outSize > MAX_OBJECT_BYTES) throw new Stop("delta does not match its base");
  const out = new Uint8Array(outSize);
  let written = 0;
  while (at < delta.length) {
    const op = delta[at];
    at += 1;
    if (op & 0x80) {
      let offset = 0;
      let length = 0;
      if (op & 0x01) offset |= delta[at++];
      if (op & 0x02) offset |= delta[at++] << 8;
      if (op & 0x04) offset |= delta[at++] << 16;
      if (op & 0x08) offset += delta[at++] * 2 ** 24;
      if (op & 0x10) length |= delta[at++];
      if (op & 0x20) length |= delta[at++] << 8;
      if (op & 0x40) length |= delta[at++] << 16;
      if (length === 0) length = 0x10000;
      if (offset + length > base.length || written + length > outSize) throw new Stop("delta copy out of range");
      out.set(base.subarray(offset, offset + length), written);
      written += length;
    } else if (op > 0) {
      if (at + op > delta.length || written + op > outSize) throw new Stop("delta insert out of range");
      out.set(delta.subarray(at, at + op), written);
      written += op;
      at += op;
    } else {
      throw new Stop("reserved delta instruction");
    }
  }
  if (written !== outSize) throw new Stop("delta produced the wrong size");
  return out;
}

/** The object store of one repository: loose objects first, then packs. */
function objectStore(git: GitFiles, limits: { maxObjects: number; deadline: number; now: () => number }) {
  let packs: Pack[] | null = null;
  let reads = 0;
  const cache = new Map<string, GitObject>();

  const spend = () => {
    reads += 1;
    if (reads > limits.maxObjects) throw new Stop("object budget spent");
    if (limits.now() > limits.deadline) throw new Stop("time budget spent");
  };

  const loadPacks = async (): Promise<Pack[]> => {
    if (packs) return packs;
    const names = (await git.list("objects/pack"))
      .filter((name) => name.endsWith(".idx"))
      .map((name) => name.slice(0, -4));
    const opened: Pack[] = [];
    for (const name of names) {
      const pack = await openPack(git, name).catch(() => null);
      if (pack) opened.push(pack);
    }
    packs = opened;
    return opened;
  };

  const readPacked = async (pack: Pack, offset: number, depth: number): Promise<GitObject> => {
    if (depth > 64) throw new Stop("delta chain too deep");
    spend();
    const end = endOf(pack, offset);
    if (end <= offset || end - offset > MAX_OBJECT_BYTES) throw new Stop("packed object out of range");
    const raw = await bytesOf(pack.pack, offset, end);
    let at = 0;
    let byte = raw[at++];
    const type = (byte >> 4) & 7;
    while (byte & 0x80) byte = raw[at++];
    if (type === OBJ_OFS_DELTA) {
      byte = raw[at++];
      let back = byte & 0x7f;
      while (byte & 0x80) {
        byte = raw[at++];
        back = (back + 1) * 128 + (byte & 0x7f);
      }
      const base = await readPacked(pack, offset - back, depth + 1);
      return { type: base.type, data: applyDelta(base.data, await inflate(raw.subarray(at))) };
    }
    if (type === OBJ_REF_DELTA) {
      const baseId = hex(raw, at, 20);
      at += 20;
      const base = await read(baseId, depth + 1);
      if (!base) throw new Stop("delta base is missing");
      return { type: base.type, data: applyDelta(base.data, await inflate(raw.subarray(at))) };
    }
    if (!TYPE_NAME[type]) throw new Stop("unknown packed object type");
    return { type, data: await inflate(raw.subarray(at)) };
  };

  const read = async (id: string, depth = 0): Promise<GitObject | null> => {
    if (!SHA.test(id)) return null;
    const hit = cache.get(id);
    if (hit) return hit;
    let found: GitObject | null = null;
    const loose = await git.file(`objects/${id.slice(0, 2)}/${id.slice(2)}`);
    if (loose) {
      spend();
      if (loose.size > MAX_OBJECT_BYTES) throw new Stop("loose object too large");
      const raw = await inflate(await bytesOf(loose));
      const nul = raw.indexOf(0);
      if (nul < 0) throw new Stop("loose object has no header");
      const type = TYPE_CODE[decoder.decode(raw.subarray(0, nul)).split(" ")[0]];
      if (!type) throw new Stop("unknown loose object type");
      found = { type, data: raw.subarray(nul + 1) };
    } else {
      const wanted = fromHex(id);
      for (const pack of await loadPacks()) {
        const offset = findInPack(pack, wanted);
        if (offset === null) continue;
        found = await readPacked(pack, offset, depth);
        break;
      }
    }
    if (found && (found.type === OBJ_COMMIT || found.type === OBJ_TREE) && cache.size < 2000) cache.set(id, found);
    return found;
  };

  return { read };
}

async function textOf(git: GitFiles, path: string): Promise<string | null> {
  const file = await git.file(path);
  if (!file || file.size > 4 * 1024 * 1024) return null;
  return decoder.decode(await bytesOf(file));
}

/** The commit HEAD points at, or null when it cannot be resolved. */
export async function resolveHead(git: GitFiles): Promise<string | null> {
  const head = (await textOf(git, "HEAD"))?.trim();
  if (!head) return null;
  if (SHA.test(head)) return head;
  const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
  if (!ref || ref.includes("..")) return null;
  const loose = (await textOf(git, ref))?.trim();
  if (loose && SHA.test(loose)) return loose;
  const packed = await textOf(git, "packed-refs");
  if (!packed) return null;
  for (const line of packed.split("\n")) {
    const [id, name] = line.trim().split(" ");
    if (name === ref && SHA.test(id ?? "")) return id;
  }
  return null;
}

type Commit = { tree: string; parent: string | null; date: string };

function parseCommit(data: Uint8Array): Commit | null {
  const text = decoder.decode(data);
  const header = text.slice(0, Math.max(0, text.indexOf("\n\n")) || text.length);
  const tree = /^tree ([0-9a-f]{40})$/m.exec(header)?.[1];
  if (!tree) return null;
  const parent = /^parent ([0-9a-f]{40})$/m.exec(header)?.[1] ?? null;
  // "committer Name <email> 1700000000 +0100". Only the timestamp is kept.
  const stamp = /^committer .*> (\d+) [+-]\d{4}$/m.exec(header)?.[1];
  const date = stamp ? new Date(Number(stamp) * 1000).toISOString() : "";
  return { tree, parent, date };
}

type TreeEntry = { name: string; id: string; tree: boolean };

function parseTree(data: Uint8Array): TreeEntry[] {
  const out: TreeEntry[] = [];
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    const nul = data.indexOf(0, space);
    if (space < 0 || nul < 0 || nul + 21 > data.length) break;
    const mode = decoder.decode(data.subarray(at, space));
    out.push({
      name: decoder.decode(data.subarray(space + 1, nul)),
      id: hex(data, nul + 1, 20),
      // 40000 is a tree. 160000 is a submodule link: a commit in another
      // repository, which has no tree here and is treated as a single entry.
      tree: mode === "40000",
    });
    at = nul + 21;
  }
  return out;
}

/**
 * The files the most recent commits changed, newest change per path.
 *
 * Walks back from HEAD along first parents. A merge is compared with its
 * first parent, so it reports what the merge brought into the branch. The
 * root commit is not reported: with no parent, nothing in it changed.
 */
export async function readRecentChanges(git: GitFiles, options: GitHistoryOptions = {}): Promise<FileChange[]> {
  const maxCommits = options.maxCommits ?? GIT_HISTORY_DEFAULTS.maxCommits;
  const maxPaths = options.maxPaths ?? GIT_HISTORY_DEFAULTS.maxPaths;
  const now = options.now ?? (() => Date.now());
  const store = objectStore(git, {
    maxObjects: options.maxObjects ?? GIT_HISTORY_DEFAULTS.maxObjects,
    deadline: now() + (options.budgetMs ?? GIT_HISTORY_DEFAULTS.budgetMs),
    now,
  });
  const changes = new Map<string, FileChange>();

  const tree = async (id: string): Promise<TreeEntry[] | null> => {
    const object = await store.read(id);
    return object && object.type === OBJ_TREE ? parseTree(object.data) : null;
  };

  const note = (path: string, sha: string, date: string, age: number) => {
    if (changes.has(path)) return;
    if (changes.size >= maxPaths) throw new Stop("path budget spent");
    changes.set(path, { path, sha: sha.slice(0, 7), date, age });
  };

  /** Every file under a tree that exists on one side only. */
  const all = async (id: string, prefix: string, sha: string, date: string, age: number): Promise<void> => {
    for (const entry of (await tree(id)) ?? []) {
      const path = `${prefix}${entry.name}`;
      if (entry.tree) await all(entry.id, `${path}/`, sha, date, age);
      else note(path, sha, date, age);
    }
  };

  const diff = async (
    newer: string | null,
    older: string | null,
    prefix: string,
    sha: string,
    date: string,
    age: number,
  ): Promise<void> => {
    if (newer === older) return;
    const after = new Map((newer ? await tree(newer) : null)?.map((entry) => [entry.name, entry]) ?? []);
    const before = new Map((older ? await tree(older) : null)?.map((entry) => [entry.name, entry]) ?? []);
    for (const name of new Set([...after.keys(), ...before.keys()])) {
      const a = after.get(name);
      const b = before.get(name);
      if (a && b && a.id === b.id && a.tree === b.tree) continue;
      const path = `${prefix}${name}`;
      if (a?.tree && b?.tree) {
        await diff(a.id, b.id, `${path}/`, sha, date, age);
        continue;
      }
      // Added, deleted, edited, or changed between a file and a folder.
      if (a?.tree) await all(a.id, `${path}/`, sha, date, age);
      else if (a) note(path, sha, date, age);
      if (b?.tree) await all(b.id, `${path}/`, sha, date, age);
      else if (b && !a) note(path, sha, date, age);
    }
  };

  try {
    let id = await resolveHead(git);
    for (let age = 0; id && age < maxCommits; age += 1) {
      const object = await store.read(id);
      if (!object || object.type !== OBJ_COMMIT) break;
      const commit = parseCommit(object.data);
      if (!commit || !commit.parent) break;
      const parentObject = await store.read(commit.parent);
      // A shallow clone names a parent it does not have. History ends here.
      if (!parentObject || parentObject.type !== OBJ_COMMIT) break;
      const parent = parseCommit(parentObject.data);
      if (!parent) break;
      await diff(commit.tree, parent.tree, "", id, commit.date, age);
      id = commit.parent;
    }
  } catch {
    // Out of budget, or an object that could not be read. Keep what was learned.
  }
  return [...changes.values()].sort((a, b) => a.age - b.age || a.path.localeCompare(b.path));
}

/**
 * How recent a file's last change is, from 1 (changed by HEAD) down towards 0
 * (changed `window` commits ago). 0 for a file no recent commit touched.
 */
export function recencyOf(change: Pick<FileChange, "age"> | undefined, window: number = GIT_HISTORY_DEFAULTS.maxCommits): number {
  if (!change || window <= 0 || change.age < 0 || change.age >= window) return 0;
  return 1 - change.age / window;
}

/** Recency by path, for ranking. Paths no recent commit touched are absent. */
export function recencyByPath(changes: FileChange[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const change of changes ?? []) {
    const value = recencyOf(change);
    if (value > 0 && value > (out.get(change.path) ?? 0)) out.set(change.path, value);
  }
  return out;
}

/** `GitFiles` over files already in memory, keyed by path under `.git`. */
export function gitFilesFromMap(files: Map<string, Blob>): GitFiles {
  return {
    file: async (path) => files.get(path) ?? null,
    list: async (dir) => {
      const prefix = `${dir.replace(/\/+$/, "")}/`;
      const names = new Set<string>();
      for (const path of files.keys()) {
        if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split("/")[0]);
      }
      return [...names];
    },
  };
}
