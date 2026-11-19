import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const version = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version;
export default defineConfig(({ command }) => {
  const identity = process.env.PANTHESIA_BUILD_INFO
    ? JSON.parse(process.env.PANTHESIA_BUILD_INFO)
    : {
        schemaVersion: 1,
        version,
        target: "Web",
        configuration: command === "build" ? "production" : "development",
        buildId: null,
        builtAt: null,
        revision: null,
        dirty: null,
        sourceFingerprint: null,
        sourceFiles: null,
      };
  if (
    !identity ||
    typeof identity !== "object" ||
    Array.isArray(identity) ||
    identity.schemaVersion !== 1 ||
    typeof identity.version !== "string"
  )
    throw new Error("构建来源信息无效");
  if (
    process.env.PANTHESIA_BUILD_INFO &&
    (!["Desktop", "Web"].includes(identity.target) ||
      typeof identity.configuration !== "string" ||
      typeof identity.buildId !== "string" ||
      !/^[a-f\d]{32}$/i.test(identity.buildId) ||
      typeof identity.sourceFingerprint !== "string" ||
      !/^[a-f\d]{64}$/i.test(identity.sourceFingerprint))
  )
    throw new Error("界面构建收到了不完整或目标不符的来源记录。");
  if (identity.version !== version)
    throw new Error("界面版本与构建记录不一致，请统一产品版本后再构建。");
  return {
    plugins: [react()],
    clearScreen: false,
    define: { __PANTHESIA_BUILD_INFO__: JSON.stringify(identity) },
  };
});
