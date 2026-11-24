import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  api,
  type EngineCommand,
  type LoadedSong,
  type Snapshot,
} from "../../api";
import type { Workspace } from "../../stores/route";
import type { RecentFile } from "../../screens/home/HomeScreen";

/** Opening a song from its own location (current-plan 3.7): the file picker, recent files,
 * and files handed over by Explorer, Keel, the command line, a second launch or a drop. */
export function useSongOpening(o: {
  connected: boolean;
  startupReady: boolean;
  busy: boolean;
  recording: boolean;
  song: LoadedSong | null;
  playback: { getSnapshot: () => Snapshot };
  requestBusy: MutableRefObject<boolean>;
  songOpeningActive: MutableRefObject<boolean>;
  changeWorkspace: (next: Workspace) => Promise<boolean>;
  clearLiveNotes: () => void;
  run: (command: EngineCommand, changesSong?: boolean) => Promise<boolean>;
  showOpened: (screen: "setup" | "performance") => void;
  setNotice: (message: string) => void;
  setError: (message: string) => void;
}) {
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [opening, setOpening] = useState(false);
  const refreshRecent = useCallback(() => {
    void api
      .command<RecentFile[]>({ type: "recentFiles" })
      .then(setRecentFiles)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (o.connected && o.startupReady) refreshRecent();
  }, [o.connected, o.startupReady, refreshRecent]);

  const openPath = async (
    path: string,
    screen: "setup" | "performance" = "setup",
  ) => {
    if (o.requestBusy.current || o.songOpeningActive.current) return false;
    if (!o.connected || !o.startupReady) {
      o.setNotice("练习室连接完成后可打开曲目。");
      return false;
    }
    if (o.playback.getSnapshot().recording) {
      o.setNotice("请先停止并保存当前录音。");
      return false;
    }
    if (!(await o.changeWorkspace("practice"))) return false;
    o.clearLiveNotes();
    setOpening(true);
    let opened = false;
    try {
      opened = await o.run({ type: "openFile", path }, true);
    } finally {
      setOpening(false);
      refreshRecent();
    }
    if (!opened) return false;
    o.showOpened(screen);
    // Report manifest problems once; details are in the song files dialog.
    const files = await api
      .command<{ files?: { missing: boolean }[]; unmatched?: number }>({
        type: "songFiles",
      })
      .catch(() => null);
    const missing = files?.files?.filter((file) => file.missing).length ?? 0;
    const problems = [
      missing ? `${missing} 个文件缺失` : "",
      files?.unmatched ? `${files.unmatched} 条标注无法对应到音符` : "",
    ].filter(Boolean);
    if (problems.length)
      o.setError(
        `歌曲清单中${problems.join("，")}；可在歌曲设置的“歌曲文件与版本”中查看。`,
      );
    return true;
  };
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;

  const chooseFile = async () => {
    if (o.requestBusy.current || o.busy || !o.startupReady || o.recording)
      return false;
    const path = api.desktop
      ? await api.pickSongFile("music", o.song?.sourcePath ?? undefined)
      : window.prompt("MIDI、MusicXML、ABC 或 .panthesia 文件的完整路径")?.trim();
    return path ? openPath(path) : false;
  };

  const openRequestsBusy = useRef(false);
  const { connected, startupReady, setError } = o;
  const takeOpenRequests = useCallback(async () => {
    if (openRequestsBusy.current || !connected || !startupReady) return;
    openRequestsBusy.current = true;
    try {
      const path = (await api.takeOpenRequests()).at(-1);
      if (path) await openPathRef.current(path, "performance");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      openRequestsBusy.current = false;
    }
  }, [connected, startupReady, setError]);
  useEffect(() => {
    if (!api.desktop) return;
    void takeOpenRequests();
    let release: (() => void) | undefined,
      active = true;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("panthesia://open-requested", () => void takeOpenRequests()).then(
        (stop) => {
          if (active) release = stop;
          else stop();
        },
      ),
    );
    return () => {
      active = false;
      release?.();
    };
  }, [takeOpenRequests]);

  const forgetRecent = (path: string) =>
    void api
      .command<RecentFile[]>({ type: "forgetRecentFile", path })
      .then(setRecentFiles)
      .catch(() => {});

  return { recentFiles, forgetRecent, opening, openPath, chooseFile };
}
