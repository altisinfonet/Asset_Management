import { ApiError } from '@assettracker/api-client';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/i18n';
import { toUiError } from './api';
import { uiErrorText, usageSummary } from './error-text';

const { t } = createTranslator();

describe('uiErrorText', () => {
  it('lists the counts of a 409 usage, singular and plural, dropping zeros', () => {
    const error = toUiError(
      new ApiError('x', 409, {
        code: 'conflict',
        detail: 'Category is in use (assets: 12, models: 1) and cannot be deleted.',
        usage: { assets: 12, models: 1, custom_fields: 0 },
      }),
    );
    expect(error.usage).toEqual({ assets: 12, models: 1 });
    expect(usageSummary(t, error.usage)).toBe('12 assets, 1 model');
    expect(uiErrorText(t, error)).toBe(
      'Still in use by 12 assets, 1 model. Move or archive those first.',
    );
  });

  it('keeps an unknown usage key readable and falls back to detail, then to the status text', () => {
    expect(usageSummary(t, { widgets: 2 })).toBe('widgets: 2');
    const withDetail = toUiError(
      new ApiError('x', 409, { code: 'conflict', detail: 'Tag taken.' }),
    );
    expect(uiErrorText(t, withDetail)).toBe('Tag taken.');
    const bare = toUiError(new ApiError('x', 409, { code: 'conflict' }));
    expect(uiErrorText(t, bare)).toBe(t('error.conflict'));
  });
});
