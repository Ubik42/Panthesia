import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import type { Plugin } from "postcss";

/** Every stylesheet goes into one cascade layer, so a later layer (state) can override any
 * component rule without !important. Order: tokens, components, screens, overrides, state
 * (src/layers.css). The redesigned screens (`src/screens`, `src/ui`) form their own layer above
 * the older component styles, so global legacy rules never reach them. */
const cascadeLayers: Plugin = {
  postcssPlugin: "panthesia-cascade-layers",
  Once(root, { AtRule }) {
    const file = root.source?.input.file ?? "";
    if (/node_modules|[\\/]layers\.css$/.test(file)) return;
    // Top-level `@layer overrides` and `@layer state` blocks keep their own layer.
    const own = root.nodes.filter(
      (node) => node.type === "atrule" && node.name === "layer" && /^(overrides|state)$/.test(node.params),
    );
    const name = /[\\/]tokens\.css$/.test(file) ? "tokens" : /[\\/]src[\\/](screens|ui)[\\/]/.test(file) ? "screens" : "components";
    const layer = new AtRule({ name: "layer", params: name });
    layer.append(root.nodes.filter((node) => !own.includes(node)));
    root.removeAll();
    root.append(layer, ...own);
  },
};

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
    css: { postcss: { plugins: [cascadeLayers] } },
    clearScreen: false,
    define: { __PANTHESIA_BUILD_INFO__: JSON.stringify(identity) },
  };
});
