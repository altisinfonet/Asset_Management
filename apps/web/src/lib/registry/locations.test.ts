import { describe, expect, it } from 'vitest';
import {
  ancestorNames,
  buildTree,
  canBeParentOf,
  locationPathText,
  pruneTree,
  searchMatches,
  subtreeIds,
  visibleRows,
} from './locations';
import type { Location } from './types';

function loc(id: string, name: string, parent: string | null, ancestors: string[], code?: string) {
  return {
    id,
    name,
    parent_id: parent,
    code: code ?? null,
    depth: ancestors.length - 1,
    ancestor_ids: ancestors,
  } as Location;
}

// site > (building > (room 2, room 10), annex), plus a second site
const site = loc('s', 'Riverside', null, ['s']);
const building = loc('b', 'Main building', 's', ['s', 'b']);
const room2 = loc('r2', 'Room 2', 'b', ['s', 'b', 'r2']);
const room10 = loc('r10', 'Room 10', 'b', ['s', 'b', 'r10'], 'R-10');
const annex = loc('a', 'Annex', 's', ['s', 'a']);
const north = loc('n', 'Northside', null, ['n']);
const all = [room10, north, annex, room2, building, site];

describe('buildTree', () => {
  it('nests by parent and sorts siblings by name with numbers in order', () => {
    const roots = buildTree(all);
    expect(roots.map((r) => r.location.name)).toEqual(['Northside', 'Riverside']);
    const riverside = roots[1]!;
    expect(riverside.children.map((c) => c.location.name)).toEqual(['Annex', 'Main building']);
    expect(riverside.children[1]!.children.map((c) => c.location.name)).toEqual([
      'Room 2',
      'Room 10',
    ]);
  });

  it('puts a node whose parent is missing at the top instead of losing it', () => {
    const roots = buildTree([room2]);
    expect(roots.map((r) => r.location.id)).toEqual(['r2']);
  });
});

describe('visibleRows', () => {
  it('lists children only of expanded nodes, with level and position among siblings', () => {
    const roots = buildTree(all);
    const collapsed = visibleRows(roots, () => false);
    expect(collapsed.map((r) => r.node.location.id)).toEqual(['n', 's']);
    const open = visibleRows(roots, (id) => id === 's' || id === 'b');
    expect(open.map((r) => [r.node.location.id, r.level, r.position, r.siblings])).toEqual([
      ['n', 1, 1, 2],
      ['s', 1, 2, 2],
      ['a', 2, 1, 2],
      ['b', 2, 2, 2],
      ['r2', 3, 1, 2],
      ['r10', 3, 2, 2],
    ]);
  });
});

describe('searchMatches and pruneTree', () => {
  it('matches name or code and keeps the ancestors so a match is reachable', () => {
    const result = searchMatches(all, 'r-10')!;
    expect([...result.matches]).toEqual(['r10']);
    expect([...result.keep].sort()).toEqual(['b', 'r10', 's']);
    const pruned = pruneTree(buildTree(all), result.keep);
    expect(pruned.map((n) => n.location.id)).toEqual(['s']);
    expect(pruned[0]!.children[0]!.children.map((n) => n.location.id)).toEqual(['r10']);
  });

  it('an empty query means everything (null), a query without matches keeps nothing', () => {
    expect(searchMatches(all, '  ')).toBeNull();
    expect(searchMatches(all, 'zzz')!.keep.size).toBe(0);
  });
});

describe('subtrees and paths', () => {
  it('subtreeIds includes the node and everything below it', () => {
    expect([...subtreeIds(all, 'b')].sort()).toEqual(['b', 'r10', 'r2']);
    expect([...subtreeIds(all, 'r2')]).toEqual(['r2']);
  });

  it('canBeParentOf refuses the node itself and its descendants (no cycles)', () => {
    expect(canBeParentOf(all, 'r2', 'b')).toBe(false);
    expect(canBeParentOf(all, 'b', 'b')).toBe(false);
    expect(canBeParentOf(all, 'n', 'b')).toBe(true);
    expect(canBeParentOf(all, null, 'b')).toBe(true);
  });

  it('builds the path text and the context line above a node', () => {
    expect(locationPathText(all, 'r10')).toBe('Riverside > Main building > Room 10');
    expect(locationPathText(all, 'nope')).toBe('');
    expect(locationPathText(all, null)).toBe('');
    expect(ancestorNames(all, room10)).toBe('Riverside > Main building');
    expect(ancestorNames(all, site)).toBe('');
  });
});
