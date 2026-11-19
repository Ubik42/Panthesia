import type { LibraryGroup } from "./useLibraryReads";
const collator = new Intl.Collator("zh");
export function libraryGroups(groups: LibraryGroup[]) {
  const byId = new Map<string, LibraryGroup>(),
    children = new Map<string, string[]>();
  for (const group of groups) {
    if (!byId.has(group.id)) byId.set(group.id, group);
    if (group.parent) {
      const siblings = children.get(group.parent);
      if (siblings) siblings.push(group.id);
      else children.set(group.parent, [group.id]);
    }
  }
  const names = new Map<string, string>();
  for (const group of groups) {
    const chain: string[] = [],
      seen = new Set<string>();
    let current = byId.get(group.id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.unshift(current.name);
      current = current.parent ? byId.get(current.parent) : undefined;
    }
    names.set(group.id, chain.join(" / "));
  }
  return {
    names,
    sorted: [...groups].sort((left, right) =>
      collator.compare(names.get(left.id) ?? "", names.get(right.id) ?? ""),
    ),
    descendants: (id: string) => {
      const found = new Set<string>(),
        pending = [id];
      while (pending.length) {
        const current = pending.pop()!;
        if (found.has(current)) continue;
        found.add(current);
        pending.push(...(children.get(current) ?? []));
      }
      return found;
    },
  };
}
