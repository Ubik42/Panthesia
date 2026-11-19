import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { dismissInputPopup, isComposingKey, ownsInputLayer } from "../../app/inputOwnership";
import "./practiceFocus.css";

/** One settings surface; focus mode changes its presentation, not its command ownership. */
export function PracticeContextPanel({ focus, source, disabled, sound, children }: {
  focus: boolean;
  source: string;
  disabled: boolean;
  sound: { state: "ready" | "changing" | "error" | "offline"; label: string };
  children: (visible: boolean) => ReactNode;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const [opened, setOpened] = useState(false);
  useEffect(() => setOpened(false), [focus, source]);
  useEffect(() => {
    if (!focus) return;
    const node = root.current;
    const close = () => setOpened(false);
    const outside = (event: PointerEvent) => { if (!node?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !node?.open || event.defaultPrevented || isComposingKey(event) || event.ctrlKey || event.altKey || event.metaKey || !ownsInputLayer(node)) return;
      event.preventDefault(); event.stopImmediatePropagation(); close();
      node.querySelector("summary")?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape, true);
    node?.addEventListener(dismissInputPopup, close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape, true);
      node?.removeEventListener(dismissInputPopup, close);
    };
  }, [focus]);
  return <details className="practice-context" ref={root} open={!focus || opened}
    data-input-popup={focus ? "" : undefined} onToggle={event => { if (focus) setOpened(event.currentTarget.open); }}>
    <summary aria-disabled={disabled} aria-label={`版本与设置，${sound.label}`} title={sound.label} onClick={event => { if (disabled) event.preventDefault(); }}>
      <i className="practice-context-signal" data-state={sound.state} aria-hidden="true" />版本与设置 <ChevronDown size={13} />
    </summary>
    <div className="practice-context-body">
      {focus && <div className="practice-context-heading"><strong>当前演奏</strong><button type="button" aria-label="收起版本与设置" onClick={()=>{setOpened(false);root.current?.querySelector("summary")?.focus({preventScroll:true});}}><X size={15}/></button></div>}
      {children(!focus || opened)}
    </div>
  </details>;
}
