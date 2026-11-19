import { createPersistentSession } from "./createPersistentSession";
import {
  packLibraryBrowse,
  packHistoryBrowse,
  readPracticeBrowse,
  restoreWorkspaceBrowse,
  unpackHistoryBrowse,
  type WorkspaceBrowseState,
} from "./workspaceBrowseModel";
import type { LibraryBrowse } from "../features/library/libraryBrowse";
import type { HistoryBrowse } from "../features/review/historyBrowse";
import type { PracticeLibraryBrowse } from "../features/practice/practiceLibraryModel";

type Part = keyof WorkspaceBrowseState["issues"];
type Pending = Partial<{
  library: LibraryBrowse;
  history: HistoryBrowse;
  practice: PracticeLibraryBrowse;
  practiceScroll: WorkspaceBrowseState["practiceScroll"];
  returnWorkspace: WorkspaceBrowseState["returnWorkspace"];
}>;

/** Scroll handlers only retain the latest immutable input; packing and storage are batched. */
export function createWorkspaceBrowseStore() {
  const session = createPersistentSession(restoreWorkspaceBrowse, {
    key: "neothesia.workspace-browse.v1",
    maxCharacters: 1_000_000,
    failureMessage: "浏览位置暂未保存。当前列表和输入继续保留。",
  });
  let pending: Pending = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstAt: number | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    firstAt = null;
    if (!Object.keys(pending).length) return;
    const batch = pending;
    pending = {};
    const patch: Partial<WorkspaceBrowseState> = {};
    const issues = { ...session.getSnapshot().issues };
    const capture = (part: Part, make: () => Partial<WorkspaceBrowseState>) => {
      try {
        Object.assign(patch, make());
        issues[part] = "";
      } catch (error) {
        issues[part] =
          `这次浏览位置尚未保留：${error instanceof Error ? error.message : String(error)}`;
      }
    };
    if (batch.library)
      capture("library", () => ({
        library: packLibraryBrowse(batch.library!),
      }));
    if (batch.history)
      capture("history", () => ({
        history: packHistoryBrowse(batch.history!),
      }));
    if (batch.practice)
      capture("practice", () => ({
        practice: readPracticeBrowse(batch.practice),
      }));
    if (batch.practiceScroll) patch.practiceScroll = batch.practiceScroll;
    if ("returnWorkspace" in batch) {
      patch.returnWorkspace = batch.returnWorkspace;
      issues.navigation = "";
    }
    session.update({ ...patch, issues });
  };
  const stage = (patch: Pending) => {
    pending = { ...pending, ...patch };
    firstAt ??= performance.now();
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      flush,
      Math.min(450, Math.max(0, 1800 - (performance.now() - firstAt))),
    );
  };
  const initial = session.getSnapshot();
  const { update: _update, ...recovery } = session;
  return {
    ...recovery,
    initialLibrary: () => initial.library ?? undefined,
    initialHistory: () => unpackHistoryBrowse(initial.history),
    initialPractice: () => initial.practice,
    initialPracticeScroll: () => initial.practiceScroll,
    initialReturn: () => {
      const target = initial.returnWorkspace;
      return target &&
        (target === "library" ? initial.library : initial.history)
        ? target
        : null;
    },
    rememberLibrary: (value: LibraryBrowse) => stage({ library: value }),
    rememberHistory: (value: HistoryBrowse) => stage({ history: value }),
    rememberPractice: (value: PracticeLibraryBrowse) =>
      stage({ practice: value }),
    rememberPracticeScroll: (key: string, top: number) => {
      if (
        key.length <= 32768 &&
        Number.isFinite(top) &&
        top >= 0 &&
        top <= 1_000_000_000
      )
        stage({ practiceScroll: { key, top } });
    },
    rememberReturn: (value: "library" | "review" | null) =>
      stage({ returnWorkspace: value }),
    flush,
    retrySave: () => {
      flush();
      session.retrySave();
    },
    copyInput: () => {
      flush();
      return session.copyInput();
    },
    adoptCurrent: () => {
      flush();
      session.adoptCurrent();
    },
  };
}
export type WorkspaceBrowseStore = ReturnType<
  typeof createWorkspaceBrowseStore
>;
