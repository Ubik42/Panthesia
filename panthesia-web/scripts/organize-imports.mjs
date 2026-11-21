// Remove unused imports (TypeScript organizeImports, keeping the original order of the rest).
// Usage: node scripts/organize-imports.mjs <file.ts(x)> [...]
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const files = process.argv.slice(2).map((f) => path.resolve(f));
const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.app.json") ?? ts.findConfigFile(process.cwd(), ts.sys.fileExists);
const config = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, path.dirname(configPath));
const versions = new Map();
const host = {
  getScriptFileNames: () => [...new Set([...config.fileNames, ...files])],
  getScriptVersion: (f) => String(versions.get(f) ?? 0),
  getScriptSnapshot: (f) => fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf8")) : undefined,
  getCurrentDirectory: () => process.cwd(),
  getCompilationSettings: () => config.options,
  getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry());
for (const file of files) {
  const changes = service.organizeImports({ type: "file", fileName: file, mode: ts.OrganizeImportsMode.RemoveUnused }, {}, undefined);
  let text = fs.readFileSync(file, "utf8");
  for (const change of changes) {
    for (const edit of [...change.textChanges].sort((a, b) => b.span.start - a.span.start))
      text = text.slice(0, edit.span.start) + edit.newText + text.slice(edit.span.start + edit.span.length);
  }
  fs.writeFileSync(file, text);
  versions.set(file, (versions.get(file) ?? 0) + 1);
  console.log(path.relative(process.cwd(), file), "imports organized");
}
