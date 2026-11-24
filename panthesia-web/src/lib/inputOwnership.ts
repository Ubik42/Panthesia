export const dialogSelector = '[role="dialog"]';
export const inputScopeSelector = `${dialogSelector},[data-dialog-scope]`;
export const popupSelector = 'details[data-input-popup][open],[role="menu"]';
export const dismissInputPopup = "neothesia-dismiss-input-popup";
export const isComposingKey = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229 || event.key === "Process";

export function isVisibleInput(node: HTMLElement | null): node is HTMLElement {
  if (!node || !node.isConnected || node.closest('[hidden],[inert],[aria-hidden="true"]') || !node.getClientRects().length) return false;
  return !["hidden", "collapse"].includes(getComputedStyle(node).visibility);
}
export const visibleDialogs = () => [...document.querySelectorAll<HTMLElement>(dialogSelector)].filter(isVisibleInput);
export const topDialog = () => visibleDialogs().at(-1) ?? null;
export const visibleInputScopes = () => [...document.querySelectorAll<HTMLElement>(inputScopeSelector)].filter(isVisibleInput);
export const topInputScope = () => visibleInputScopes().at(-1) ?? null;
export function visiblePopups() {
  return [...document.querySelectorAll<HTMLElement>(popupSelector)].filter(isVisibleInput);
}
export function topPopup(modal = topInputScope()) {
  return visiblePopups().filter((popup) => !modal || modal.contains(popup)).at(-1) ?? null;
}
/** Global handlers act only for their foreground window or popup. */
export function ownsInputLayer(scope: HTMLElement | null) {
  if (!isVisibleInput(scope)) return false;
  const modal = topInputScope(), popup = topPopup(modal);
  return popup ? popup === scope || popup.contains(scope) : modal ? modal === scope || modal.contains(scope) : true;
}
export function isTextEntry(target: EventTarget | null) {
  return target instanceof Element && (
    target instanceof HTMLElement && target.isContentEditable ||
    !!target.closest('input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="spinbutton"]')
  );
}
export function isCapturingKeys() {
  const modal = topInputScope(), layer = topPopup(modal) ?? modal;
  return [...document.querySelectorAll<HTMLElement>('[data-shortcut-capturing="true"],[data-keyboard-capturing="true"]')]
    .some((node) => isVisibleInput(node) && (!layer || layer.contains(node)));
}
export function focusReturnKey(node: HTMLElement | null) {
  if (!node) return null;
  const explicit = node.getAttribute("data-focus-key");
  if (explicit && explicit.length <= 4096) return `key:${explicit}`;
  return node.id && node.id.length <= 4096 ? `id:${node.id}` : null;
}
export function findReturnFocus(root: ParentNode, key: string | null | undefined) {
  if (!key) return null;
  const attr = key.startsWith("key:") ? "data-focus-key" : "id";
  const value = key.slice(key.indexOf(":") + 1);
  return [...root.querySelectorAll<HTMLElement>(`[${attr}="${CSS.escape(value)}"]`)]
    .find((node) => isVisibleInput(node) && !node.matches(":disabled")) ?? null;
}

const tabSelector = 'button,input,select,textarea,a[href],area[href],summary,iframe,object,embed,audio[controls],video[controls],[tabindex],[contenteditable]:not([contenteditable="false"])';
function tabOrder(node: HTMLElement) {
  return !node.hasAttribute("tabindex") && node.isContentEditable && !node.parentElement?.isContentEditable ? 0 : node.tabIndex;
}
/** Match native tab order, including disabled fieldsets, radio groups and positive tabindex. */
export function dialogTabStops(dialog: HTMLElement) {
  const items = [...dialog.querySelectorAll<HTMLElement>(tabSelector)]
    .filter((node) => tabOrder(node) >= 0 && !node.matches(":disabled") && isVisibleInput(node));
  const radios = new Map<Node, Map<string, HTMLInputElement>>();
  for (const node of items) {
    if (!(node instanceof HTMLInputElement) || node.type !== "radio" || !node.name) continue;
    const owner = node.form ?? node.getRootNode();
    let groups = radios.get(owner);
    if (!groups) { groups = new Map(); radios.set(owner, groups); }
    if (!groups.has(node.name) || node.checked) groups.set(node.name, node);
  }
  return items.filter((node) => !(node instanceof HTMLInputElement) || node.type !== "radio" || !node.name || radios.get(node.form ?? node.getRootNode())?.get(node.name) === node)
    .sort((left, right) => (tabOrder(left) > 0 ? tabOrder(left) : Infinity) - (tabOrder(right) > 0 ? tabOrder(right) : Infinity) || 0);
}
