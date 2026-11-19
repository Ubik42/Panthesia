import { useId, useState, useSyncExternalStore } from "react";
import type { WorkspaceBrowseStore } from "./workspaceBrowseStore";
import { PersistentSessionRecovery } from "./PersistentSessionRecovery";
import "./workspaceBrowseRecovery.css";
export function WorkspaceBrowseRecovery({
  store,
}: {
  store: WorkspaceBrowseStore;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const problem =
    state.storageError ||
    Object.values(state.issues).filter(Boolean).join("；");
  if (!problem && !expanded) return null;
  return (
    <aside className="workspace-browse-recovery" aria-label="浏览位置保存">
      <div className="workspace-browse-summary">
        <span role="status">
          {problem
            ? "浏览位置暂未保存，当前页面可继续使用。"
            : "可以查看当前浏览位置及保留原文。"}
        </span>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "查看与恢复"}
        </button>
      </div>
      <div id={detailsId} hidden={!expanded}>
        {expanded && (
          <PersistentSessionRecovery
            store={store}
            error={problem}
            busy={false}
            label="浏览位置"
            inputLabel="当前浏览位置"
            adoptedMessage="当前浏览位置已采用。"
          />
        )}
      </div>
    </aside>
  );
}
