import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const product = JSON.parse(fs.readFileSync(path.join(root, "product.json"), "utf8"));
if (product.name !== "Panthesia" || product.identifier !== "com.ubik.panthesia" || !/^\d+\.\d+\.\d+$/.test(product.version)) throw Error("产品身份配置无效");
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), value);
const configPath = "panthesia-web/src-tauri/tauri.conf.json";
const config = JSON.parse(fs.readFileSync(path.join(root, configPath), "utf8"));
config.productName = product.name; config.identifier = product.identifier; config.version = product.version;
config.app.windows[0].title = product.name;
write(configPath, JSON.stringify(config, null, 2) + "\n");
write("panthesia-web/src/product.generated.ts", `// Generated from product.json by scripts/sync-product.mjs.\nexport const product = ${JSON.stringify(product, null, 2)} as const;\n`);
const corePath = "panthesia-core/src/product.rs";
let core = fs.readFileSync(path.join(root, corePath), "utf8");
core = core.replace(/pub const NAME: &str = "[^"]+";/, `pub const NAME: &str = ${JSON.stringify(product.name)};`)
  .replace(/pub const APP_ID: &str = "[^"]+";/, `pub const APP_ID: &str = ${JSON.stringify(product.identifier)};`);
write(corePath, core);
console.log(`产品身份已同步：${product.name} ${product.version}`);
