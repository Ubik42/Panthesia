import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getInterfaceSettings } from "./interfaceSettingsStore";

export function InterfaceSaveStatus({
  openRecovery,
  draftError,
}: {
  openRecovery: () => void;
  draftError: string;
}) {
  const store = getInterfaceSettings(),
    state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const error = state.error || draftError;
  return (
    <div className="interface-save-status" data-error={!!error}>
      <p role={error ? "alert" : "status"}>
        {error ||
          (state.maintenance
            ? "正在处理本机设置…"
            : state.saving
              ? "正在保存…"
              : state.pending
                ? "调整已生效，等待保存。"
                : state.notice || "调整立即生效，自动保存在本机。")}
      </p>
      {(error || state.protected) && (
        <button onClick={openRecovery}>处理保存问题</button>
      )}
    </div>
  );
}
export function InterfaceStorageNotice() {
  const store = getInterfaceSettings(),
    state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [text, setText] = useState(""),
    [copies, setCopies] = useState<string[]>([]);
  const [selectedCopy, setSelectedCopy] = useState<{
    key: string;
    baseline: string;
  } | null>(null);
  const working = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async (job: () => unknown | Promise<unknown>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const show = (value: string, key?: string) => {
    setSelectedCopy(key ? { key, baseline: store.recoveryBaseline() } : null);
    setText(value);
  };
  return (
    <section
      className="interface-storage-notice"
      data-protected={state.protected}
      aria-label="界面设置保存状态"
    >
      <p role={state.error ? "alert" : "status"}>
        {state.error ||
          (state.maintenance
            ? "正在处理界面设置…"
            : state.saving
              ? "正在保存界面设置…"
              : state.pending
                ? "当前设置等待保存。"
                : state.notice || "调整立即生效，自动保存在本机。")}
      </p>
      {(state.error || state.protected) && (
        <div className="dialog-actions">
          <button
            disabled={
              busy || state.saving || state.maintenance || state.recovery
            }
            onClick={() => void run(store.retry)}
          >
            重试保存
          </button>
          <button
            disabled={busy || state.saving || state.maintenance}
            onClick={() =>
              void run(async () => {
                const value = store.copyInput();
                show(value);
                await navigator.clipboard.writeText(value);
              })
            }
          >
            复制当前设置
          </button>
          <button
            disabled={busy || state.saving || state.maintenance}
            onClick={() => void run(() => show(store.rawText()))}
          >
            查看本机原文
          </button>
          <button
            disabled={
              busy || state.saving || state.maintenance || state.recovery
            }
            onClick={() => void run(store.readSaved)}
          >
            保留输入副本并读取本机设置
          </button>
          <button
            disabled={busy || state.saving || state.maintenance}
            onClick={() => void run(store.adoptCurrent)}
          >
            保留原记录副本并采用当前设置
          </button>
          {state.recovery && (
            <>
              <button
                disabled={busy || state.saving || state.maintenance}
                onClick={() => void run(() => store.recover("after"))}
              >
                继续未完成的保存
              </button>
              <button
                disabled={busy || state.saving || state.maintenance}
                onClick={() => void run(() => store.recover("before"))}
              >
                恢复保存前的设置
              </button>
            </>
          )}
        </div>
      )}
      <details
        onToggle={(event) => {
          if (event.currentTarget.open)
            void run(() => setCopies(store.preserved()));
        }}
      >
        <summary>保留的界面设置副本</summary>
        <p className="parameter-help">
          采用当前输入或恢复保存记录前，会先保留本机原文与当前输入。显示最近 24
          份副本。
        </p>
        {copies.length === 0 ? (
          <p>暂无保留副本。</p>
        ) : (
          copies.map((key, index) => (
            <button
              key={key}
              disabled={busy}
              onClick={() =>
                void run(() =>
                  show(store.preservedText(key) ?? "这份副本已移除。", key),
                )
              }
            >
              查看副本 {index + 1} ·{" "}
              {new Date(
                Number(key.split(":").at(-1)?.split("-")[0]),
              ).toLocaleString("zh-CN")}
            </button>
          ))
        )}
      </details>
      {text && (
        <div className="interface-original">
          <textarea readOnly aria-label="界面设置原文或副本" value={text} />
          {selectedCopy && (
            <p className="parameter-help">
              采用这份副本会恢复其中的显示、按键和命名布局。现有记录与当前输入会另存为副本。
            </p>
          )}
          <div className="dialog-actions">
            {selectedCopy && (
              <button
                disabled={busy || state.saving || state.maintenance}
                onClick={() =>
                  void run(async () => {
                    await store.restorePreserved(
                      selectedCopy.key,
                      selectedCopy.baseline,
                    );
                    setSelectedCopy(null);
                    setCopies(store.preserved());
                  })
                }
              >
                采用这份副本的设置
              </button>
            )}
            <button
              onClick={() =>
                void run(() => navigator.clipboard.writeText(text))
              }
            >
              复制原文
            </button>
            <button
              onClick={() => {
                setText("");
                setSelectedCopy(null);
              }}
            >
              收起原文
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
