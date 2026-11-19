import type { Location } from './types';

/**
 * Helpers for the location hierarchy (M2-LOC-04). The API returns a flat list with `parent_id`,
 * `depth` and `ancestor_ids` (root..self); the tree, the paths and the subtree checks are derived
 * here so every screen (tree, pickers, move dialog) agrees.
 */
export interface LocationNode {
  location: Location;
  children: LocationNode[];
}

const byName = (a: Location, b: Location) =>
  a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }) ||
  a.id.localeCompare(b.id);

/** The forest of a flat list, siblings sorted by name. A node whose parent is not in the list becomes a root. */
export function buildTree(locations: readonly Location[]): LocationNode[] {
  const nodes = new Map<string, LocationNode>(
    locations.map((location) => [location.id, { location, children: [] }]),
  );
  const roots: LocationNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.location.parent_id ? nodes.get(node.location.parent_id) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: LocationNode[]) => {
    list.sort((a, b) => byName(a.location, b.location));
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

export interface VisibleRow {
  node: LocationNode;
  /** 1-based depth (the `aria-level`). */
  level: number;
  /** Position among its siblings (`aria-posinset`) and their number (`aria-setsize`). */
  position: number;
  siblings: number;
}

/** The rows of the tree that are on screen: a node's children are listed when it is expanded. */
export function visibleRows(
  roots: readonly LocationNode[],
  isExpanded: (id: string) => boolean,
): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const walk = (list: readonly LocationNode[], level: number) => {
    list.forEach((node, index) => {
      rows.push({ node, level, position: index + 1, siblings: list.length });
      if (node.children.length > 0 && isExpanded(node.location.id)) walk(node.children, level + 1);
    });
  };
  walk(roots, 1);
  return rows;
}

/**
 * Ids matching a search (name or code, case-insensitive) together with all their ancestors, so a
 * match is always reachable in the tree; null when the query is empty (everything matches).
 */
export function searchMatches(
  locations: readonly Location[],
  query: string,
): { matches: Set<string>; keep: Set<string> } | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const matches = new Set<string>();
  const keep = new Set<string>();
  for (const location of locations) {
    if (
      location.name.toLowerCase().includes(needle) ||
      (location.code ?? '').toLowerCase().includes(needle)
    ) {
      matches.add(location.id);
      for (const id of location.ancestor_ids ?? [location.id]) keep.add(id);
      keep.add(location.id);
    }
  }
  return { matches, keep };
}

/** A tree restricted to the ids in `keep`. */
export function pruneTree(
  roots: readonly LocationNode[],
  keep: ReadonlySet<string>,
): LocationNode[] {
  return roots
    .filter((node) => keep.has(node.location.id))
    .map((node) => ({ location: node.location, children: pruneTree(node.children, keep) }));
}

/** Ids of `id` and everything below it. */
export function subtreeIds(locations: readonly Location[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const location of locations) {
    if (!location.parent_id) continue;
    const list = children.get(location.parent_id) ?? [];
    list.push(location.id);
    children.set(location.parent_id, list);
  }
  const result = new Set<string>([id]);
  const stack = [id];
  while (stack.length > 0) {
    for (const child of children.get(stack.pop()!) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        stack.push(child);
      }
    }
  }
  return result;
}

/** "Riverside > Main building > Room 101" for a location (empty for an unknown id). */
export function locationPathText(
  locations: readonly Location[],
  id: string | null | undefined,
  separator = ' > ',
): string {
  if (!id) return '';
  const byId = new Map(locations.map((l) => [l.id, l]));
  const target = byId.get(id);
  if (!target) return '';
  const ids = target.ancestor_ids?.length ? target.ancestor_ids : [target.id];
  return ids
    .map((x) => byId.get(x)?.name ?? '')
    .filter(Boolean)
    .join(separator);
}

/** Names of the ancestors above a location, nearest last (the context line under a picker option). */
export function ancestorNames(locations: readonly Location[], location: Location): string {
  const byId = new Map(locations.map((l) => [l.id, l]));
  return (location.ancestor_ids ?? [])
    .filter((id) => id !== location.id)
    .map((id) => byId.get(id)?.name ?? '')
    .filter(Boolean)
    .join(' > ');
}

/** Where a location of this kind is allowed to be put (any kind may sit under any other: no rule). */
export function canBeParentOf(
  locations: readonly Location[],
  candidateParentId: string | null,
  movingId: string,
): boolean {
  if (candidateParentId === null) return true;
  return !subtreeIds(locations, movingId).has(candidateParentId);
}
