// Remove CSS selectors that name a class no TypeScript source can produce.
// A class counts as used when its name appears as a token in src/**/*.{ts,tsx} or index.html,
// or when a source builds it from a prefix such as `note-${kind}` or "note-" + kind.
// Usage: node scripts/prune-css.mjs [--list] [--write]
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";

const root = path.resolve("src");
const write = process.argv.includes("--write");
const list = process.argv.includes("--list");
const deadNames = new Map();
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const all = files(root);
const source = [...all.filter((f) => /\.(tsx?|mjs)$/.test(f)), path.resolve("index.html")]
  .map((f) => fs.readFileSync(f, "utf8")).join("\n");
const tokens = new Set(source.match(/[A-Za-z_][\w-]*/g));
const prefixes = [...source.matchAll(/([A-Za-z_][\w-]*-)(?:\$\{|["'`]\s*\+)/g)].map((m) => m[1]);
const used = (name) => tokens.has(name) || prefixes.some((p) => name.startsWith(p));
const classes = (selector) => [...selector.replace(/url\([^)]*\)|"[^"]*"|'[^']*'/g, "")
  .matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);

let removedSelectors = 0, removedRules = 0;
for (const file of all.filter((f) => f.endsWith(".css"))) {
  const text = fs.readFileSync(file, "utf8");
  const tree = postcss.parse(text);
  let changed = false;
  tree.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
    for (const s of rule.selectors) for (const c of classes(s)) if (!used(c)) deadNames.set(c, path.relative(root, file));
    const keep = rule.selectors.filter((s) => classes(s).every(used));
    if (keep.length === rule.selectors.length) return;
    removedSelectors += rule.selectors.length - keep.length;
    changed = true;
    if (keep.length) rule.selectors = keep;
    else { rule.remove(); removedRules++; }
  });
  tree.walkAtRules((at) => {
    if (at.nodes && at.nodes.length === 0) { at.remove(); changed = true; }
  });
  if (changed) {
    const before = text.split("\n").length, after = tree.toString().split("\n").length;
    console.log(`${path.relative(root, file)}: ${before} → ${after} 行`);
    if (write) fs.writeFileSync(file, tree.toString());
  }
}
if (list) console.log([...deadNames].map(([c, f]) => `${c} ${f}`).sort().join("\n"));
console.log(`选择器 ${removedSelectors}，整条规则 ${removedRules}${write ? "" : "（预演）"}`);
