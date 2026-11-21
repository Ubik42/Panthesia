import { useApp } from "./AppContext";
import { ApplicationMenu } from "./ApplicationMenu";
import { PreparationButton } from "./PreparationButton";
import { pathKey } from "../engine/pathIdentity";
import { product } from "../product.generated";

import { Maximize2 } from "lucide-react";
import { api } from "../api";
import { MediaExportButton } from "../features/exports/MediaExportButton";
const normalize = pathKey;

/** The application menu (file, practice, view, settings, help) and engine indicator. */
export function AppMenu() {
  const {
    appMenuOpen,
    workspaceSessions,
    workspace,
    setDisplayDialog,
    setView,
    playback,
    state,
    song,
    connected,
    setError,
    setSongOptions,
    setScoresDialog,
    setFingeringWorkbenchOpen,
    clearLiveNotes,
    startupReady,
    busy,
    setCommandsOpen,
    setAboutOpen,
    setEditDraftsOpen,
    setMetadataDraftPath,
    openSoundSettings,
    setExerciseDialog,
    setMetadata,
    setProgressOpen,
    setMediaExport,
    run,
    action,
    workspaceUnavailable,
    setSongFilesOpen,
    chooseFile,
    scorePairing,
    exportMidi,
    fullscreen,
    openRecovery,
    openingActive,
    goHome,
  } = useApp();
  return (
    <>
      <header
        className="workspace-topbar"
        hidden={!appMenuOpen}
        role={appMenuOpen ? "dialog" : undefined}
        aria-modal={appMenuOpen || undefined}
        aria-label="应用菜单"
      >
        <button
          className="app-name"
          onClick={() => void goHome()}
          disabled={!!workspaceUnavailable}
          title="返回主页"
        >
          <img
            src="/brand.svg"
            alt=""
            aria-hidden="true"
            width={27}
            height={27}
          />
          {product.name}
        </button>
        <ApplicationMenu
          disabled={
            !startupReady ||
            !!state.storage?.operation ||
            !!workspaceSessions.desktopClose.status
          }
          groups={[
            {
              label: "文件",
              content: (
                <>
                  <button
                    disabled={busy || state.recording}
                    onClick={() => void chooseFile()}
                  >
                    打开乐曲…
                  </button>
                  <button
                    disabled={!song || song.generated || busy}
                    onClick={() => {
                      setMetadataDraftPath(null);
                      setMetadata(true);
                    }}
                  >
                    当前曲目信息…
                  </button>
                  {song && (
                    <button
                      disabled={busy}
                      onClick={() => setSongFilesOpen(true)}
                    >
                      歌曲文件与版本…
                    </button>
                  )}
                  <MediaExportButton
                    source={song}
                    kind="practiceMidi"
                    disabled={!song || busy}
                    open={() => {
                      if (song)
                        setMediaExport({
                          contentId: song.contentId,
                          title: song.title,
                          path: song.sourcePath,
                          engineId: song.engineId,
                          kind: "practiceMidi",
                        });
                    }}
                  />
                  <MediaExportButton
                    source={song}
                    kind="midi"
                    disabled={!song || busy}
                    open={exportMidi}
                  />
                </>
              ),
            },
            {
              label: "练习",
              content: (
                <>
                  <button
                    disabled={!song || state.recording}
                    onClick={() =>
                      action({
                        type: ["playing", "countIn"].includes(
                          playback.getSnapshot().status,
                        )
                          ? "pause"
                          : "play",
                      })
                    }
                  >
                    播放 / 暂停
                  </button>
                  <button
                    disabled={!song}
                    onClick={() => action({ type: "restart" })}
                  >
                    从头开始
                  </button>
                  <button
                    disabled={!song}
                    onClick={() => action({ type: "mode", value: "wait" })}
                  >
                    弹对后继续
                  </button>
                  <button
                    disabled={!song}
                    onClick={() => action({ type: "mode", value: "listen" })}
                  >
                    连续播放
                  </button>
                  <button
                    disabled={busy || openingActive}
                    onClick={() =>
                      void run(
                        { type: "recording", active: !state.recording },
                        state.recording,
                      )
                    }
                  >
                    {" "}
                    {state.recording ? "停止录制" : "录制演奏"}
                  </button>
                  <PreparationButton
                    store={workspaceSessions.exercise}
                    name="技术练习…"
                    readyLabel="已生成"
                    disabled={openingActive}
                    open={() => setExerciseDialog(true)}
                  />
                </>
              ),
            },
            {
              label: "视图",
              content: (
                <>
                  <button onClick={() => setView("score")}>五线谱</button>
                  <button disabled={!song} onClick={() => setView("combined")}>
                    谱面与瀑布
                  </button>
                  <button onClick={() => setView("keyboard")}>
                    瀑布与琴键
                  </button>
                  <button disabled={!song} onClick={() => setView("paper")}>
                    PDF / 图片谱页
                  </button>
                  <button disabled={!song} onClick={() => setSongOptions(true)}>
                    歌曲选项…
                  </button>
                  <button onClick={fullscreen}>切换全屏</button>
                  <button onClick={() => setDisplayDialog(true)}>
                    显示与光效…
                  </button>
                </>
              ),
            },
            {
              label: "设置",
              content: (
                <>
                  <button onClick={() => openSoundSettings()}>
                    键盘与音源…
                  </button>
                  <button onClick={() => setDisplayDialog(true)}>
                    界面与快捷键…
                  </button>
                  <button
                    disabled={!song}
                    onClick={() => setScoresDialog(true)}
                  >
                    谱面管理…
                  </button>
                  <button disabled={!song} onClick={scorePairing.request}>
                    配对原谱…
                  </button>
                  <button
                    disabled={!song || busy}
                    onClick={() => setFingeringWorkbenchOpen(true)}
                  >
                    指法工作台…
                  </button>
                  <button onClick={() => setSongOptions(true)}>
                    练习参数…
                  </button>
                </>
              ),
            },
            {
              label: "帮助",
              content: (
                <>
                  <button
                    onClick={() => {
                      clearLiveNotes();
                      setCommandsOpen(true);
                    }}
                  >
                    查找操作…
                  </button>
                  <button
                    onClick={() =>
                      void api.openLogs().catch((e) => setError(String(e)))
                    }
                  >
                    打开日志文件夹
                  </button>
                  <button onClick={openRecovery}>诊断详情…</button>
                  <button
                    onClick={() => {
                      clearLiveNotes();
                      setProgressOpen(true);
                    }}
                  >
                    后台任务…
                  </button>
                  <button onClick={() => setEditDraftsOpen(true)}>
                    编辑中的草稿…
                  </button>
                  <button onClick={() => setAboutOpen(true)}>
                    关于 Panthesia…
                  </button>
                </>
              ),
            },
          ]}
        />
        <span className="menu-spacer" />
        <span
          className={`engine-indicator ${connected ? "connected" : ""}`}
          role="status"
          title={
            connected
              ? startupReady
                ? "练习室已连接"
                : "正在恢复练习室"
              : "练习室连接中断"
          }
        >
          <i />
          {connected
            ? startupReady
              ? "练习室已连接"
              : "正在恢复练习室"
            : "练习室连接中断"}
        </span>
        <button className="icon-button" aria-label="全屏" onClick={fullscreen}>
          <Maximize2 size={16} />
        </button>
      </header>
    </>
  );
}
