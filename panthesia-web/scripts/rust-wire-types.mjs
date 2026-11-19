// Deliberately supports the serde shapes used by the migrated wire domains.
// An unsupported attribute or field shape fails generation rather than weakening its type.
export function splitTopLevel(text, separator = ",") {
  const result = [], stack = [];
  let start = 0, quoted = false, escaped = false;
  const pairs = { "<": ">", "(": ")", "[": "]", "{": "}" };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (pairs[char]) stack.push(pairs[char]);
    else if (stack.at(-1) === char) stack.pop();
    else if (char === separator && stack.length === 0) {
      result.push(text.slice(start, i).trim()); start = i + 1;
    }
  }
  if (stack.length || quoted) throw Error("Unbalanced Rust wire declaration");
  result.push(text.slice(start).trim());
  return result.filter(Boolean);
}
export function attributes(text) {
  const values = [];
  while (text.startsWith("#[")) {
    let end = 2, depth = 1, quoted = false;
    for (; end < text.length && depth; end++) {
      const char = text[end];
      if (char === '"' && text[end - 1] !== "\\") quoted = !quoted;
      if (!quoted && char === "[") depth++;
      if (!quoted && char === "]") depth--;
    }
    if (depth) throw Error("Unterminated wire attribute");
    values.push(text.slice(0, end)); text = text.slice(end).trim();
  }
  return { values: values.join(" "), text };
}
function withoutComments(source) {
  let result = "", quoted = false, escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (quoted) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true; result += char;
    } else if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      result += "\n";
    } else if (char === "/" && next === "*") {
      let depth = 1; i += 2;
      while (depth && i < source.length) {
        if (source[i] === "/" && source[i + 1] === "*") { depth++; i += 2; }
        else if (source[i] === "*" && source[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      if (depth) throw Error("Unterminated Rust comment");
      i--; result += " ";
    } else result += char;
  }
  return result;
}
function serde(values, context) {
  const result = {};
  for (const name of values.matchAll(/#\[(\w+)/g)) {
    if (!["derive", "default", "serde", "doc"].includes(name[1])) throw Error(`Unsupported wire attribute in ${context}: ${name[1]}`);
  }
  for (const match of values.matchAll(/#\[serde\(([\s\S]*?)\)\]/g)) {
    for (const attribute of splitTopLevel(match[1])) {
      const parsed = attribute.match(/^(rename|rename_all|default|skip_serializing_if|deny_unknown_fields|deserialize_with|tag|skip|flatten)(?:\s*=\s*"([^"]+)")?$/);
      if (!parsed || (!["default", "deny_unknown_fields", "skip", "flatten"].includes(parsed[1]) && !parsed[2])) throw Error(`Unsupported serde attribute in ${context}: ${attribute}`);
      if (parsed[1] === "skip_serializing_if" && !["Vec::is_empty", "Option::is_none", "is_zero"].includes(parsed[2])) throw Error(`Unsupported serde omission in ${context}: ${attribute}`);
      if (parsed[1] === "deserialize_with" && parsed[2] !== "deserialize_parts") throw Error(`Unsupported wire decoder in ${context}: ${attribute}`);
      result[parsed[1]] = parsed[2] ?? true;
    }
  }
  return result;
}
function wireName(name, casing) {
  if (!casing) return name;
  if (casing === "camelCase") return name.replace(/_([a-z])/g, (_, char) => char.toUpperCase()).replace(/^[A-Z]/, c => c.toLowerCase());
  if (casing === "snake_case") return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  throw Error(`Unsupported serde rename_all: ${casing}`);
}
export function domainDeclaration(source, name, typeOf, direction = "input") {
  if (!["input", "output"].includes(direction)) throw Error(`Unsupported wire direction: ${direction}`);
  source = withoutComments(source);
  const match = new RegExp(`pub(?:\\([^)]*\\))?\\s+(struct|enum)\\s+${name}\\s*\\{`).exec(source);
  if (!match) throw Error(`Wire domain declaration missing: ${name}`);
  const prefix = source.slice(0, match.index).match(/((?:#\[[^\]]*\]\s*)+)$/)?.[1] ?? "";
  const options = serde(prefix, name);
  let end = match.index + match[0].length, depth = 1;
  const start = end;
  let quoted = false, escaped = false;
  while (depth && end < source.length) {
    const char = source[end];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    end++;
  }
  if (depth) throw Error(`Unterminated wire domain: ${name}`);
  const members = splitTopLevel(source.slice(start, end - 1));
  const flattened = [];
  const fieldLines = (members, options, context) => members.flatMap(member => {
    const item = attributes(member), field = item.text.match(/^(?:pub(?:\([^)]*\))?\s+)?(\w+)\s*:\s*([\s\S]+)$/);
    if (!field) throw Error(`Unsupported field in ${name}: ${member}`);
    const config = serde(item.values, name);
    if (config.skip) return [];
    if (config.flatten) {
      const base = typeOf(field[2], true);
      if (match[1] !== "struct" || !/^[A-Za-z_]\w*$/.test(base) || Object.keys(config).some(key => key !== "flatten")) throw Error(`Unsupported flattened field in ${name}: ${field[1]}`);
      flattened.push(base);
      return [];
    }
    const fieldName = config.rename ?? wireName(field[1], options.rename_all);
    const optional = direction === "output" ? config.skip_serializing_if !== undefined : options.default !== undefined || config.default !== undefined || /^Option\s*</.test(field[2]);
    const wireType = direction === "output" && config.skip_serializing_if === "Option::is_none"
      ? field[2].trim().match(/^Option<([\s\S]+)>$/)?.[1] : field[2];
    if (!wireType) throw Error(`Option omission requires an Option field in ${name}`);
    return `  ${JSON.stringify(fieldName)}${optional ? "?" : ""}: ${typeOf(wireType, true)};`;
  });
  if (match[1] === "enum") {
    if (options.tag) {
      const variants = members.map(member => {
        const item = attributes(member), config = serde(item.values, name);
        const variant = item.text.match(/^(\w+)(?:\s*\{([\s\S]*)\})?$/);
        if (!variant) throw Error(`Unsupported tagged variant in ${name}: ${item.text}`);
        const label = config.rename ?? wireName(variant[1], options.rename_all);
        const fields = variant[2] ? fieldLines(splitTopLevel(variant[2]), config, name) : [];
        return `  | { ${JSON.stringify(options.tag)}: ${JSON.stringify(label)}${fields.length ? "; " + fields.map(field => field.trim()).join(" ") : ""} }`;
      });
      return `export type ${name} =\n${variants.join("\n")};`;
    }
    const variants = members.map(member => {
      const item = attributes(member), config = serde(item.values, name);
      if (!/^\w+$/.test(item.text)) throw Error(`Unsupported data variant in ${name}: ${item.text}`);
      return JSON.stringify(config.rename ?? wireName(item.text, options.rename_all));
    });
    return `export const ${name}Values = [${variants.join(", ")}] as const;\nexport type ${name} = typeof ${name}Values[number];`;
  }
  const fields = fieldLines(members, options, name);
  return `export interface ${name}${flattened.length ? " extends " + flattened.join(", ") : ""} {\n${fields.join("\n")}\n}`;
}
