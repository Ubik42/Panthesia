import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  CornerDownLeft,
  LoaderCircle,
  Search,
  VolumeX,
  X,
} from "lucide-react";
import { eventShortcut, shortcutLabel } from "./shortcuts";
import {
  searchCommands,
  type ApplicationCommand,
  type ApplicationCommandId,
} from "./applicationCommands";
import "./actionSearch.css";

interface Props {
  actions: ApplicationCommand[];
  recent: ApplicationCommandId[];
  context: string;
  shortcut: string | null;
  close: () => void;
  used: (id: ApplicationCommandId) => void;
  silence: () => void | Promise<void>;
}
export function ActionSearch({
  actions,
  recent,
  context,
  shortcut,
  close,
  used,
  silence,
}: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ApplicationCommandId | null>(null);
  const [running, setRunning] = useState<ApplicationCommandId | null>(null);
  const [error, setError] = useState("");
  const [silencing, setSilencing] = useState(false);
  const stopping = useRef(false);
  const input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const controller = useRef<AbortController | null>(null),
    working = useRef(false),
    mounted = useRef(true);
  const latest = useRef({
    actions,
    close,
    used,
  });
  latest.current = { actions, close, used };
  const id = useId();
  const groups = useMemo(() => {
    if (query.trim())
      return [{ label: "匹配的操作", actions: searchCommands(actions, query) }];
    const first = recent.length
      ? recent
          .map((key) => actions.find((action) => action.id === key))
          .filter((action): action is ApplicationCommand => !!action)
      : actions.filter((action) => action.featured);
    const included = new Set(first.map((action) => action.id));
    const remaining = actions.filter((action) => !included.has(action.id));
    return [
      { label: recent.length ? "最近使用" : "常用操作", actions: first },
      ...(["工作区", "练习与编排", "曲目与乐谱", "应用设置"] as const).map(
        (group) => ({
          label: group,
          actions: remaining.filter((action) => action.group === group),
        }),
      ),
    ].filter((group) => group.actions.length);
  }, [actions, recent, query]);
  const results = useMemo(
    () => groups.flatMap((group) => group.actions),
    [groups],
  );
  const active = results.find((action) => action.id === selected) ?? results[0];
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => {
      mounted.current = false;
      controller.current?.abort();
      requestAnimationFrame(() => {
        const hasDialog = [
          ...document.querySelectorAll('[role="dialog"]'),
        ].some((node) => node.getClientRects().length);
        if (hasDialog) return;
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          active !== document.body &&
          active !== document.documentElement
        )
          return;
        if (previous?.isConnected && !previous.closest("[hidden],[inert]"))
          previous.focus();
        else
          document
            .querySelector<HTMLElement>(
              '.workspace-navigation [aria-current="page"]',
            )
            ?.focus();
      });
    };
  }, []);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active?.id]);
  const activate = async (
    key: ApplicationCommandId,
    run: ApplicationCommand["run"],
    unavailable: string | null,
  ) => {
    if (working.current) return;
    if (unavailable) {
      setError(unavailable);
      return;
    }
    const request = new AbortController();
    controller.current = request;
    working.current = true;
    setRunning(key);
    setError("");
    try {
      const result = await run(request.signal);
      if (!mounted.current || request.signal.aborted) return;
      if (result === false) {
        setError("操作尚未完成，请先处理当前编辑或练习提示，再重新选择。");
        return;
      }
      latest.current.used(key);
      latest.current.close();
    } catch (failure) {
      if (mounted.current && !request.signal.aborted)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      working.current = false;
      if (controller.current === request) controller.current = null;
      if (mounted.current) setRunning(null);
    }
  };
  const execute = (key: ApplicationCommandId) => {
    const action = latest.current.actions.find((item) => item.id === key);
    if (action) return activate(key, action.run, action.unavailable);
  };
  const stopSound = async () => {
    if (stopping.current) return;
    stopping.current = true;
    setSilencing(true);
    setError("");
    try {
      await silence();
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      stopping.current = false;
      if (mounted.current) setSilencing(false);
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.isDefaultPrevented() ||
      composing.current ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    )
      return;
    if (
      event.key === "Escape" ||
      (shortcut && eventShortcut(event.nativeEvent) === shortcut)
    ) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey || event.altKey)
    )
      return;
    if (event.key === "Enter" && event.shiftKey && !query.trim()) {
      event.preventDefault();
      return;
    }
    if (
      event.key === "Enter" &&
      event.target === input.current &&
      !event.repeat &&
      query.trim() &&
      (event.shiftKey || !active)
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      ["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(event.key) &&
      event.target === input.current &&
      results.length
    ) {
      event.preventDefault();
      event.stopPropagation();
      const index = Math.max(
        0,
        results.findIndex((action) => action.id === active?.id),
      );
      const offset =
        event.key === "ArrowDown"
          ? 1
          : event.key === "ArrowUp"
            ? -1
            : event.key === "PageDown"
              ? 6
              : -6;
      setSelected(
        results[(index + offset + results.length * 6) % results.length].id,
      );
      setError("");
    } else if (
      event.key === "Enter" &&
      event.target === input.current &&
      !event.repeat &&
      active
    ) {
      event.preventDefault();
      event.stopPropagation();
      void execute(active.id);
    } else if (event.key === "Tab") {
      const focusable = [
        ...event.currentTarget.querySelectorAll<HTMLElement>(
          "input,button:not(:disabled),[tabindex='0']",
        ),
      ].filter((item) => item.getClientRects().length && item.tabIndex >= 0);
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };
  return (
    <div
      className="action-search-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="action-search"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-context`}
        onKeyDown={keyDown}
      >
        <header className="action-search-heading">
          <div>
            <h2 id={`${id}-title`}>查找操作</h2>
            <p id={`${id}-context`} title={context}>
              {context}
            </p>
          </div>
          <button
            className="icon-button"
            onClick={close}
            aria-label="关闭查找操作"
          >
            <X size={19} />
          </button>
        </header>
        <div className="action-search-input">
          <Search size={21} aria-hidden="true" />
          <input
            ref={input}
            data-dialog-initial-focus
            role="combobox"
            aria-label="搜索应用操作"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={`${id}-results`}
            aria-activedescendant={active ? `${id}-${active.id}` : undefined}
            value={query}
            placeholder="搜索指法、导入、备份或其他操作…"
            autoComplete="off"
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            spellCheck={false}
            maxLength={256}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
              setError("");
              if (list.current) list.current.scrollTop = 0;
            }}
          />
          {shortcut && <kbd>{shortcutLabel(shortcut)}</kbd>}
        </div>
        <div
          className="action-search-results"
          ref={list}
          id={`${id}-results`}
          role="listbox"
          aria-label="应用操作"
          aria-busy={!!running}
        >
          {!results.length && (
            <div className="action-search-empty">
              <Search size={27} />
              <strong>没有找到匹配的操作</strong>
              <p>可试试“指法”“曲库”“声音”或“练习计划”。</p>
              <button
                onClick={() => {
                  setQuery("");
                  input.current?.focus();
                }}
              >
                查看全部操作
              </button>
            </div>
          )}
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <div className="action-search-group" aria-hidden="true">
                {group.label}
              </div>
              {group.actions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    id={`${id}-${action.id}`}
                    className="action-search-option"
                    role="option"
                    aria-selected={active?.id === action.id}
                    aria-disabled={!!action.unavailable || !!running}
                    tabIndex={-1}
                    onPointerDown={(event) => {
                      if (event.pointerType === "mouse") event.preventDefault();
                    }}
                    onPointerMove={() => {
                      if (!running && active?.id !== action.id) {
                        setSelected(action.id);
                        setError("");
                      }
                    }}
                    onClick={() => void execute(action.id)}
                  >
                    <span className="action-search-icon">
                      {running === action.id ? (
                        <LoaderCircle
                          size={19}
                          className="action-search-spinner"
                        />
                      ) : (
                        <Icon size={19} aria-hidden="true" />
                      )}
                    </span>
                    <span className="action-search-copy">
                      <strong>{action.label}</strong>
                      <span>{action.unavailable || action.description}</span>
                    </span>
                    {action.shortcut && (
                      <kbd>{shortcutLabel(action.shortcut)}</kbd>
                    )}
                    {!action.unavailable &&
                      !action.shortcut &&
                      active?.id === action.id && (
                        <CornerDownLeft
                          size={16}
                          aria-hidden="true"
                          className="action-search-enter"
                        />
                      )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div
          className="action-search-message"
          role={error ? "alert" : "status"}
          aria-live="polite"
        >
          {error ||
            (running
              ? "正在处理，按 Esc 可关闭并取消后续跳转。"
              : active?.unavailable || `${results.length} 个操作可查找`)}
        </div>
        <footer>
          <span className="action-search-hints">
            <span>
              <ArrowUp size={12} />
              <ArrowDown size={12} /> 选择
            </span>
            <span>
              <CornerDownLeft size={13} /> 执行
            </span>
            <span>Esc 关闭</span>
          </span>
          <button disabled={silencing} onClick={() => void stopSound()}>
            {silencing ? (
              <LoaderCircle size={15} className="action-search-spinner" />
            ) : (
              <VolumeX size={15} />
            )}
            {silencing ? "正在止音…" : "停止发声"}
          </button>
        </footer>
      </section>
    </div>
  );
}
