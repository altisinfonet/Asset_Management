import type { components } from '@assettracker/api-client';
import { getApi } from '@/lib/api';
import type { Page } from '@/lib/registry/types';

/** Saved views of the asset list on the server (M2-REG-01): personal, or shared with the organisation. */
type S = components['schemas'];
export type SavedView = S['SavedView'];
export type SavedViewDefinition = S['SavedViewDefinition'];

/** Permission that allows sharing a view with the whole organisation. */
export const SHARE_PERMISSION = 'view:share';

const http = () => getApi().http;

export const savedViewsApi = {
  /** Every view the user can see: their own, then the shared ones. */
  async list(): Promise<SavedView[]> {
    const views: SavedView[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const { data } = await http().GET('/v1/saved-views', {
        params: { query: { entity: 'asset', limit: 100, cursor } },
      });
      const page = data as Page<SavedView>;
      views.push(...page.data);
      if (!page.page.has_more || !page.page.next_cursor) break;
      cursor = page.page.next_cursor;
    }
    return views;
  },
  async create(body: {
    name: string;
    shared: boolean;
    definition: SavedViewDefinition;
  }): Promise<SavedView> {
    const { data } = await http().POST('/v1/saved-views', {
      body: { entity: 'asset', ...body },
    });
    return data as SavedView;
  },
  async update(
    id: string,
    body: Partial<{ name: string; shared: boolean; definition: SavedViewDefinition }>,
  ): Promise<SavedView> {
    const { data } = await http().PATCH('/v1/saved-views/{id}', {
      params: { path: { id } },
      body,
    });
    return data as SavedView;
  },
  async remove(id: string): Promise<void> {
    await http().DELETE('/v1/saved-views/{id}', { params: { path: { id } } });
  },
};
