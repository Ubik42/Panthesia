/** A shared query language for the song browser and the library manager. */
export const searchFields = [
  "title", "composer", "arranger", "artist", "collection", "tags", "difficulty", "notes", "path", "source",
] as const;
export type SearchField = (typeof searchFields)[number];
export interface SearchTerm {
  text: string;
  exclude: boolean;
  field?: SearchField;
}
export type SearchDocument = Record<SearchField, string>;

// A colon in an ordinary path or URL remains literal. Only known field names
// introduce a field predicate. Unclosed quotes still provide useful filtering
// while the user is typing, without discarding the remainder of the query.
export function parseSongSearch(query: string): SearchTerm[] {
  const result: SearchTerm[] = [];
  const input = query.slice(0, 4096);
  let at = 0;
  while (at < input.length) {
    while (/\s/.test(input[at] ?? "") && at < input.length) at++;
    if (at >= input.length) break;
    const exclude = input[at] === "-";
    if (exclude) at++;
    let field: SearchField | undefined;
    const prefix = input.slice(at).match(/^([a-z]+):/i);
    if (prefix && searchFields.includes(prefix[1].toLowerCase() as SearchField)) {
      field = prefix[1].toLowerCase() as SearchField;
      at += prefix[0].length;
    }
    let text = "", quoted = false;
    while (at < input.length) {
      const char = input[at];
      if (char === '"') {
        quoted = !quoted;
        at++;
      } else if (quoted && char === "\\" && ['"', "\\"].includes(input[at + 1])) {
        text += input[at + 1];
        at += 2;
      } else if (!quoted && /\s/.test(char)) {
        break;
      } else {
        text += char;
        at++;
      }
    }
    if (text) result.push({ text: text.toLocaleLowerCase(), exclude, ...(field ? { field } : {}) });
  }
  return result;
}

export function matchesSongSearch(
  document: SearchDocument,
  terms: readonly SearchTerm[],
  defaultField: SearchField | "all" = "all",
): boolean {
  if (!terms.length) return true;
  const normalized: Partial<SearchDocument> = {};
  let all: string | undefined;
  const textFor = (field: SearchField | "all") => field === "all"
    ? (all ??= searchFields.map((key) => document[key]).join(" ").toLocaleLowerCase())
    : (normalized[field] ??= document[field].toLocaleLowerCase());
  return terms.every((term) => {
    const found = textFor(term.field ?? defaultField).includes(term.text);
    return term.exclude ? !found : found;
  });
}
