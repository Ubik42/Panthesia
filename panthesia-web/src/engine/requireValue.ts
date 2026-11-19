/** Capture a valid identity before starting an asynchronous operation. */
export function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined || value === "")
    throw new Error(`${label}已失效，请重新读取后再操作`);
  return value;
}
