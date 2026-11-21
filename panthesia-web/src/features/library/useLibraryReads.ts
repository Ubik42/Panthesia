import type { CollectionRead } from "../practice/usePracticeSession";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { api, type CollectionSong } from "../../api";
import type { Entry } from "./libraryQueryModel";
import type { SongLearning } from "../../songLearning";
import { ReadCache, type ReadValue } from "../../engine/readCache";
import {
  createRepairSessionStore,
  type RepairSessionStore,
} from "./repairSessionStore";
export interface LibraryGroup {
  id: string;
  name: string;
  parent: string | null;
}
export interface LibraryWorkspace {
  groups: LibraryGroup[];
  entries: Record<string, Entry>;
  revision: number;
  learning?: Record<string, SongLearning>;
}
export interface LibraryFolder {
  path: string;
  available: boolean;
  automatic?: boolean;
  kind?: "folder" | "catalog";
}
export const createLibraryCache = () => {
  let repairs: RepairSessionStore | undefined;
  let revision = 0;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getRevision: () => revision,
    invalidate: () => {
      revision++;
      for (const listener of listeners) listener();
    },
    repairSession: () => (repairs ??= createRepairSessionStore()),
    repairDraftStatus: () => repairs?.getSnapshot(),
    positions: new Map<string, number>(),
    workspace: new ReadCache<LibraryWorkspace>(1),
    folders: new ReadCache<LibraryFolder[]>(1),
    collection: new ReadCache<CollectionSong[]>(1),
    completeAt: null as number | null,
  };
};
export type LibraryCache = ReturnType<typeof createLibraryCache>;
interface Parts {
  engineId?: string;
  revision: number;
  workspace?: ReadValue<LibraryWorkspace>;
  folders?: ReadValue<LibraryFolder[]>;
  collection?: ReadValue<CollectionSong[]>;
  errors: { workspace: string; folders: string; collection: string };
  completeAt: number | null;
  pending: Record<"workspace" | "folders" | "collection", boolean>;
}
const emptyWorkspace: LibraryWorkspace = {
  groups: [],
  entries: {},
  revision: 0,
};
export function useLibraryReads(
  supplied?: LibraryCache,
  readCollection?: () => Promise<CollectionRead>,
  engineId?: string,
) {
  const fallback = useMemo(createLibraryCache, []),
    cache = supplied ?? fallback;
  const revision = useSyncExternalStore(
    cache.subscribe,
    cache.getRevision,
    cache.getRevision,
  );
  const [parts, setParts] = useState<Parts>(() => ({
    engineId,
    revision,
    workspace: cache.workspace.get("all"),
    folders: cache.folders.get("all"),
    collection: cache.collection.get("all"),
    errors: { workspace: "", folders: "", collection: "" },
    completeAt: cache.completeAt,
    pending: { workspace: true, folders: true, collection: true },
  }));
  const alive = useRef(true),
    generation = useRef(0);
  const engine = useRef(engineId);
  if (engine.current !== engineId) {
    engine.current = engineId;
    generation.current++;
  }
  const collectionReceipt = useRef<CollectionRead | undefined>(undefined);
  const collectionReader = useRef(readCollection);
  collectionReader.current = readCollection;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  const reload = useCallback(async () => {
    if (engine.current !== engineId)
      return {
        current: false,
        workspace: false,
        folders: false,
        collection: false,
      };
    const request = ++generation.current;
    const readRevision = cache.getRevision();
    collectionReceipt.current = undefined;
    const current = () =>
      alive.current &&
      request === generation.current &&
      readRevision === cache.getRevision() &&
      engine.current === engineId;
    setParts((previous) => ({
      ...previous,
      engineId,
      revision: readRevision,
      errors:
        previous.engineId === engineId
          ? previous.errors
          : { workspace: "", folders: "", collection: "" },
      pending: { workspace: true, folders: true, collection: true },
    }));
    type Values = {
      workspace: LibraryWorkspace;
      folders: LibraryFolder[];
      collection: CollectionSong[];
    };
    const read = async <K extends keyof Values>(
      part: K,
      store: ReadCache<Values[K]>,
      load: () => Promise<Values[K]>,
    ) => {
      try {
        const value = await load();
        if (!current()) return false;
        const row = store.put("all", value);
        setParts((previous) =>
          current()
            ? {
                ...previous,
                [part]: row,
                errors: { ...previous.errors, [part]: "" },
                pending: { ...previous.pending, [part]: false },
              }
            : previous,
        );
        return true;
      } catch (failure) {
        if (current())
          setParts((previous) =>
            current()
              ? {
                  ...previous,
                  errors: {
                    ...previous.errors,
                    [part]:
                      failure instanceof Error
                        ? failure.message
                        : String(failure),
                  },
                  pending: { ...previous.pending, [part]: false },
                }
              : previous,
          );
        return false;
      }
    };
    const completed = await Promise.all([
      read("workspace", cache.workspace, () =>
        api.commandForEngine<LibraryWorkspace>(engineId, {
          type: "libraryWorkspace",
        }),
      ),
      read(
        "folders",
        cache.folders,
        async () =>
          (
            await api.commandForEngine<{ folders: LibraryFolder[] }>(engineId, {
              type: "libraryFolders",
            })
          ).folders,
      ),
      read("collection", cache.collection, async () => {
        if (!collectionReader.current)
          return (
            await api.commandForEngine<{ songs: CollectionSong[] }>(engineId, {
              type: "collection",
            })
          ).songs;
        const receipt = await collectionReader.current();
        if (engineId && receipt.engineId !== engineId)
          throw new Error("曲库连接已改变，请重新读取收藏与练习进度。");
        if (current()) collectionReceipt.current = receipt;
        return receipt.songs;
      }),
    ]);
    if (current() && completed.every(Boolean)) {
      cache.completeAt = Date.now();
      setParts((previous) => ({ ...previous, completeAt: cache.completeAt }));
    }
    // Each part publishes independently; a refresh failure never rejects an acknowledged edit.
    return {
      current: current(),
      workspace: completed[0],
      folders: completed[1],
      collection: completed[2],
    };
  }, [cache, engineId]);
  useEffect(() => {
    void reload();
  }, [reload, revision]);
  const stale = parts.engineId !== engineId || parts.revision !== revision;
  const error = (
    stale
      ? []
      : [
          ["曲目分组与资料", parts.errors.workspace],
          ["曲库文件夹", parts.errors.folders],
          ["收藏与练习进度", parts.errors.collection],
        ]
  )
    .filter(([, detail]) => detail)
    .map(([label, detail]) => `${label}：${detail}`)
    .join("；");
  const reading = stale || Object.values(parts.pending).some(Boolean);
  const pendingDetail = [
    ["曲目资料", parts.pending.workspace],
    ["文件夹", parts.pending.folders],
    ["收藏与练习进度", parts.pending.collection],
  ]
    .filter(([, pending]) => pending)
    .map(([label]) => label)
    .join("、");
  return {
    repairSession: cache.repairSession,
    positions: cache.positions,
    data: parts.workspace?.value ?? emptyWorkspace,
    folders: parts.folders?.value ?? [],
    collection: parts.collection?.value ?? [],
    workspaceReady: !!parts.workspace,
    current: !stale,
    collectionRead: () => collectionReceipt.current,
    reading,
    pendingDetail,
    readError: error,
    readAt: stale ? null : parts.completeAt,
    reload,
    verified: !reading && !error && !!parts.workspace,
    workspaceVerified:
      !stale &&
      !parts.pending.workspace &&
      !parts.errors.workspace &&
      !!parts.workspace,
    collectionVerified:
      !stale &&
      !parts.pending.collection &&
      !parts.errors.collection &&
      !!parts.collection,
  };
}
