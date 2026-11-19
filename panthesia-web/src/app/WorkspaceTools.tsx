import { useEffect, useRef } from "react";
import { dismissInputPopup, isComposingKey, ownsInputLayer } from "./inputOwnership";
import {
  Archive,
  Info,
  KeyboardMusic,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";

/** Shared settings stay reachable while each workspace uses its own task toolbar. */
export function WorkspaceTools({
  disabled,
  closing = false,
  devices,
  display,
  backup,
  about,
}: {
  disabled: boolean;
  closing?: boolean;
  devices: () => void;
  display: () => void;
  backup: () => void;
  about: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null),
    trigger = useRef<HTMLElement>(null);
  const close = () => {
    if (menu.current) menu.current.open = false;
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        if (event.defaultPrevented || isComposingKey(event) || event.ctrlKey || event.altKey || event.metaKey || !ownsInputLayer(menu.current)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    const node = menu.current;
    node?.addEventListener(dismissInputPopup, close);
    window.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      node?.removeEventListener(dismissInputPopup, close);
      window.removeEventListener("keydown", escape, true);
    };
  }, []);
  useEffect(() => {
    if (closing) close();
  }, [closing]);
  const run = (action: () => void) => {
    close();
    trigger.current?.focus();
    action();
  };
  return (
    <details ref={menu} className="workspace-tools" data-input-popup=""
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}>
      <summary
        ref={trigger}
        aria-label="应用设置"
        title="设备、显示、备份与版本"
        aria-disabled={closing}
        tabIndex={closing ? -1 : 0}
        onClick={(event) => {
          if (closing) event.preventDefault();
        }}
      >
        <Settings2 size={17} />
      </summary>
      <div
        className="workspace-tools-menu"
        role="group"
        aria-label="应用设置选项"
      >
        <button disabled={disabled} onClick={() => run(devices)}>
          <KeyboardMusic size={16} />
          设备设置
        </button>
        <button disabled={disabled} onClick={() => run(display)}>
          <SlidersHorizontal size={16} />
          显示与快捷键
        </button>
        <button disabled={disabled} onClick={() => run(backup)}>
          <Archive size={16} />
          练习资料备份
        </button>
        <button disabled={closing} onClick={() => run(about)}>
          <Info size={16} />
          关于此版本
        </button>
      </div>
    </details>
  );
}
