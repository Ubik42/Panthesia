import { PersistentSessionRecovery } from "../../app/PersistentSessionRecovery";
import { useState, useSyncExternalStore } from "react";
import type {
  PaperLocationDraft,
  PaperLocationSession,
} from "./paperLocationDraftStore";
import { PaperListPager } from "./PaperListPager";
import { pitchName } from "../../api";
import "./paperLocationDrafts.css";

export function PaperLocationDrafts({
  session,
  disabled,
  issue,
  resume,
}: {
  session: PaperLocationSession;
  disabled: boolean;
  issue: (draft: PaperLocationDraft) => string | null;
  resume: (draft: PaperLocationDraft) => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [open, setOpen] = useState(state.restored),
    [page, setPage] = useState(0),
    [message, setMessage] = useState(""),
    [copyText, setCopyText] = useState("");
  const actual = Math.min(
    page,
    Math.max(0, Math.ceil(state.drafts.length / 8) - 1),
  );
  const copy = async () => {
    try {
      const text = session.copyInput();
      setCopyText(text);
      if (text === null) {
        setMessage("本机尚无已保存的草稿原文。");
        return;
      }
      await navigator.clipboard.writeText(text);
      setMessage("已复制当前全部位置草稿。");
    } catch (error) {
      setMessage(
        `可在下方选取原文复制：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  if (!state.drafts.length && !state.storageError) return null;
  return (
    <section className="paper-location-drafts" aria-label="谱页位置草稿">
      <div className="paper-location-drafts-heading">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          位置草稿 <strong>{state.drafts.length}</strong>
          <span>{open ? "收起" : "展开"}</span>
        </button>
        <span>
          {state.storageError
            ? "暂存需要处理"
            : "已暂存在本机，可切换曲目后继续"}
        </span>
      </div>
      <PersistentSessionRecovery
        store={session}
        error={state.storageError}
        busy={disabled}
        label="谱页位置草稿"
      />
      {open && (
        <>
          <p className="parameter-help">
            继续编辑会回到框选时的谱页。保存后移除对应草稿；网格或音符已变化的草稿可保留查看，再重新框选。
          </p>
          <ul>
            {state.drafts.slice(actual * 8, actual * 8 + 8).map((draft) => {
              const problem = issue(draft);
              return (
                <li key={draft.id}>
                  <div>
                    <strong>
                      第 {draft.measure} 小节
                      {draft.note
                        ? ` · ${pitchName(draft.note.pitch)}`
                        : " · 小节位置"}
                    </strong>
                    <span>
                      第 {draft.page} 页
                      {draft.note ? ` · 音轨 ${draft.note.track}` : ""}
                    </span>
                    {problem && <small>{problem}</small>}
                  </div>
                  <button disabled={disabled} onClick={() => resume(draft)}>
                    继续编辑
                  </button>
                  <button
                    disabled={disabled}
                    onClick={() => session.remove(draft.id, draft)}
                  >
                    移除草稿
                  </button>
                </li>
              );
            })}
          </ul>
          <PaperListPager
            page={actual}
            total={state.drafts.length}
            size={8}
            change={setPage}
            label="位置草稿分页"
          />
          <button onClick={() => void copy()}>复制全部位置草稿</button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {copyText && (
        <label className="paper-location-copy">
          位置草稿原文
          <textarea
            aria-label="位置草稿原文"
            readOnly
            rows={5}
            value={copyText}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </section>
  );
}
