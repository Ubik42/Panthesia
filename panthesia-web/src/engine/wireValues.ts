/** Retain equal JSON subtrees without mutating either decoded response or current state. */
export function shareWireValue<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (
    !previous ||
    !next ||
    typeof previous !== "object" ||
    typeof next !== "object"
  )
    return next;
  if (Array.isArray(previous) && Array.isArray(next)) {
    let unchanged = previous.length === next.length;
    let result: unknown[] | undefined;
    for (let index = 0; index < next.length; index++) {
      const child = shareWireValue(previous[index], next[index]);
      unchanged &&= Object.is(child, previous[index]);
      if (!Object.is(child, next[index])) {
        result ??= next.slice();
        result[index] = child;
      }
    }
    return unchanged ? previous : ((result ?? next) as T);
  }
  if (Array.isArray(previous) || Array.isArray(next)) return next;
  const plain = (value: object) =>
    Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null;
  if (!plain(previous) || !plain(next)) return next;
  const old = previous as Record<string, unknown>,
    value = next as Record<string, unknown>;
  const keys = Object.keys(value);
  let unchanged = Object.keys(old).length === keys.length;
  let result: Record<string, unknown> | undefined;
  for (const key of keys) {
    const exists = Object.hasOwn(old, key);
    const child = exists ? shareWireValue(old[key], value[key]) : value[key];
    unchanged &&= exists && Object.is(child, old[key]);
    if (!Object.is(child, value[key])) {
      result ??= { ...value };
      result[key] = child;
    }
  }
  return unchanged ? previous : ((result ?? next) as T);
}
