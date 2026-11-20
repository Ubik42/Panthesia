/** Keep readable spelling while removing equivalent Windows namespace prefixes. */
export function portablePath(path: string | null | undefined): string {
  return (path ?? "")
    .replaceAll("\\", "/")
    .replace(/^\/\/\?\/unc\//i, "//")
    .replace(/^\/\/\?\//, "")
    .replace(/\/$/, "");
}
/** Compare paths consistently across the catalog, history and native replies. */
export const pathKey = (path: string | null | undefined): string =>
  portablePath(path).toLowerCase();
