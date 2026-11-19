import type { components } from '@assettracker/api-client';
import { getApi } from '@/lib/api';
import type { Page } from '@/lib/registry/types';

/**
 * Saved views of the asset list on the server (M2-REG-01): personal, or shared with the
 * organisation. A view is `{ filters, columns, sort }` (the list's own state, opaque to the
 * server apart from the id references it checks for `warnings`). Only the owner changes or deletes
 * a view (`If-Match` required); sharing is its own call and needs `view:share`.
 */
type S = components['schemas'];
export type SavedView = S['SavedView'];
export type SavedViewWarning = SavedView['warnings'][number];

/** What the list state is stored as: the part of a view the client owns. */
export interface ViewDefinition {
  filters: Record<string, unknown>;
  columns: string[];
  sort: string | null;
}

/** Permission that allows sharing a view with the whole organisation. */
export const SHARE_PERMISSION = 'view:share';

const http = () => getApi().http;
const etagFor = (id: string) => getApi().etags.etagFor(`/v1/saved-views/${id}`);

/** The `If-Match` of a view: the current one is read first, so a view changed elsewhere is not overwritten blindly. */
async function currentEtag(id: string): Promise<string> {
  await http().GET('/v1/saved-views/{id}', { params: { path: { id } } });
  return etagFor(id) ?? '';
}

export const savedViewsApi = {
  /** Every view the user can see (own and shared), in the API's order (by name). */
  async list(): Promise<SavedView[]> {
    const views: SavedView[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const { data } = await http().GET('/v1/saved-views', {
        params: { query: { resource: 'assets', scope: 'all', limit: 100, cursor } },
      });
      const page = data as Page<SavedView>;
      views.push(...page.data);
      if (!page.page.has_more || !page.page.next_cursor) break;
      cursor = page.page.next_cursor;
    }
    return views;
  },
  /** Creates a private view; share it afterwards with {@link savedViewsApi.share}. */
  async create(body: { name: string } & ViewDefinition): Promise<SavedView> {
    const { data } = await http().POST('/v1/saved-views', {
      body: { resource: 'assets', ...body },
    });
    return data as SavedView;
  },
  async update(id: string, body: Partial<{ name: string } & ViewDefinition>): Promise<SavedView> {
    const ifMatch = await currentEtag(id);
    const { data } = await http().PATCH('/v1/saved-views/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return data as SavedView;
  },
  async share(id: string, shared: boolean): Promise<SavedView> {
    const ifMatch = await currentEtag(id);
    const { data } = await http().PUT('/v1/saved-views/{id}/sharing', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body: { shared },
    });
    return data as SavedView;
  },
  async remove(id: string): Promise<void> {
    const ifMatch = await currentEtag(id);
    await http().DELETE('/v1/saved-views/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
    });
  },
};
