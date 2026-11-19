import { ApiError, type components } from '@assettracker/api-client';
import { getCsrfToken } from '@/lib/auth/http';
import { getApi } from '@/lib/api';

/**
 * Label sheets (M2-TAG-03). The templates come from `GET /v1/labels/templates`; a sheet is made
 * by `POST /v1/labels/render`, which answers with the PDF itself. That answer is not JSON, which
 * the typed client rejects on purpose (a non-JSON 200 normally means a proxy answered), so the
 * render call is a plain same-origin `fetch` that still sends the CSRF token and turns a problem
 * document into the same `ApiError` every other call throws.
 */
type S = components['schemas'];
export type LabelTemplate = S['LabelTemplate'];
export type LabelRenderRequest = S['LabelRenderRequest'];
export type LabelCodeType = NonNullable<LabelRenderRequest['code_type']>;
export type LabelField = NonNullable<LabelRenderRequest['fields']>[number];

export interface RenderedLabels {
  blob: Blob;
  /** File name the server suggested (`Content-Disposition`), or a sensible default. */
  filename: string;
}

export const labelsApi = {
  async templates(): Promise<LabelTemplate[]> {
    const { data } = await getApi().http.GET('/v1/labels/templates');
    return (data as S['LabelTemplateList']).data;
  },

  async render(body: LabelRenderRequest, signal?: AbortSignal): Promise<RenderedLabels> {
    const csrf = getCsrfToken();
    const response = await fetch('/v1/labels/render', {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/pdf, application/problem+json',
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        parsed = undefined;
      }
      const problem =
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      throw new ApiError(`POST /v1/labels/render failed with ${response.status}`, response.status, {
        ...problem,
        request_id: problem.request_id ?? response.headers.get('x-request-id') ?? undefined,
      });
    }
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('pdf')) {
      throw new ApiError('POST /v1/labels/render did not return a PDF', 502);
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
    return {
      blob: await response.blob(),
      filename: named ? decodeURIComponent(named) : 'labels.pdf',
    };
  },
};
