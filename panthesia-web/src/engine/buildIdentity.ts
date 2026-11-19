export interface BuildIdentity {
  schemaVersion: 1;
  version: string;
  target: string;
  configuration: string;
  buildId: string | null;
  builtAt: string | null;
  revision: string | null;
  dirty: boolean | null;
  sourceFingerprint: string | null;
  sourceFiles: number | null;
}
export interface DesktopBuildReport {
  identity: BuildIdentity;
  architecture: string;
  executable: string;
  dataRoot: string;
  bundledFont: string;
  selectedFont: string;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, maximum = 32768): value is string =>
  typeof value === "string" && value.length <= maximum;
export function readBuildIdentity(value: unknown): BuildIdentity | null {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !text(value.version, 64) ||
    !text(value.target, 64) ||
    !text(value.configuration, 64)
  )
    return null;
  const nullableText = (key: string, maximum = 256) =>
    value[key] === null || value[key] === undefined
      ? null
      : text(value[key], maximum)
        ? (value[key] as string)
        : null;
  const hex = (key: string, lengths: number[]) => {
    const part = nullableText(key);
    return part && lengths.includes(part.length) && /^[a-f\d]+$/i.test(part)
      ? part.toLowerCase()
      : null;
  };
  return {
    schemaVersion: 1,
    version: value.version,
    target: value.target,
    configuration: value.configuration,
    buildId: hex("buildId", [32]),
    revision: hex("revision", [40, 64]),
    sourceFingerprint: hex("sourceFingerprint", [64]),
    builtAt:
      text(value.builtAt, 256) && Number.isFinite(Date.parse(value.builtAt))
        ? value.builtAt
        : null,
    dirty: typeof value.dirty === "boolean" ? value.dirty : null,
    sourceFiles:
      Number.isSafeInteger(value.sourceFiles) &&
      (value.sourceFiles as number) >= 0
        ? (value.sourceFiles as number)
        : null,
  };
}
export function readDesktopBuildReport(value: unknown): DesktopBuildReport {
  if (!object(value)) throw new Error("程序版本信息未返回，请重新读取。");
  const identity = readBuildIdentity(value.identity);
  const paths = [
    "architecture",
    "executable",
    "dataRoot",
    "bundledFont",
    "selectedFont",
  ] as const;
  if (
    !identity ||
    identity.target !== "Desktop" ||
    paths.some((key) => !text(value[key]))
  )
    throw new Error("程序版本信息尚未读齐，请重新读取。");
  return {
    identity,
    ...Object.fromEntries(paths.map((key) => [key, value[key]])),
  } as DesktopBuildReport;
}
declare const __PANTHESIA_BUILD_INFO__: unknown;
export const frontendBuildIdentity = readBuildIdentity(
  typeof __PANTHESIA_BUILD_INFO__ === "undefined"
    ? null
    : __PANTHESIA_BUILD_INFO__,
);

export function buildReportText(
  report: DesktopBuildReport | null,
  desktop = !!report,
): string {
  const identity = report?.identity ?? frontendBuildIdentity;
  const rows = [
    "Panthesia · 版本与来源",
    `${desktop && !report ? "界面版本" : "版本"}：${identity?.version ?? "未登记"}`,
    `运行方式：${report ? "桌面程序" : desktop ? "桌面程序（程序信息尚未读齐，以下为界面信息）" : "浏览器界面"}`,
    `构建时间：${identity?.builtAt ?? "未登记"}`,
    `构建编号：${identity?.buildId ?? "未登记"}`,
    `源码提交：${identity?.revision ?? "未登记"}`,
    `本地修改：${identity?.dirty === null || identity?.dirty === undefined ? "未登记" : identity.dirty ? "有" : "无"}`,
    `源码内容标识：${identity?.sourceFingerprint ?? "未登记"}`,
    `构建模式：${identity?.configuration ?? "未登记"}`,
  ];
  if (report)
    rows.push(
      `程序架构：${report.architecture}`,
      `程序：${report.executable}`,
      `练习资料：${report.dataRoot}`,
      `随包钢琴音色：${report.bundledFont}`,
      `钢琴音色文件：${report.selectedFont}`,
    );
  if (report && frontendBuildIdentity)
    rows.push(
      `界面构建编号：${frontendBuildIdentity.buildId ?? "未登记"}`,
      `界面源码标识：${frontendBuildIdentity.sourceFingerprint ?? "未登记"}`,
    );
  return rows.join("\n");
}
