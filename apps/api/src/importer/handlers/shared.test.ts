import { describe, expect, it } from 'vitest';
import { ApiProblem } from '../../platform/index.js';
import { takenBy } from '../../registry/registry-base.js';
import { assetPointer, issuesOf, plainPointer } from './shared.js';

describe('issuesOf: service problems as row issues', () => {
  it('a uniqueness error takes the sentence that names the field and the record (ED-40)', () => {
    const tag = takenBy('Asset tag CHR-00001 is already used by another asset.', '/asset_tag');
    expect(issuesOf(tag, assetPointer)).toEqual([
      {
        field: 'asset_tag',
        code: 'duplicate',
        message: 'Asset tag CHR-00001 is already used by another asset.',
      },
    ]);
    const email = takenBy('Email ana@example.com is already used by Ana Silva.', '/email');
    expect(issuesOf(email, plainPointer())).toEqual([
      {
        field: 'email',
        code: 'duplicate',
        message: 'Email ana@example.com is already used by Ana Silva.',
      },
    ]);
    // never the bare "is already in use" of the form field
    expect(issuesOf(email, plainPointer())[0]!.message).not.toBe('is already in use');
  });

  it('other field errors keep their own message; a problem without field errors gives its detail', () => {
    const invalid = new ApiProblem({
      code: 'validation',
      detail: 'The request is invalid.',
      errors: [{ pointer: '/category_id', message: 'No such category.', code: 'not-found' }],
    });
    expect(issuesOf(invalid, assetPointer)).toEqual([
      { field: 'category', code: 'not-found', message: 'No such category.' },
    ]);
    const conflict = new ApiProblem({ code: 'conflict', detail: 'The asset is archived.' });
    expect(issuesOf(conflict, assetPointer)).toEqual([
      { field: null, code: 'conflict', message: 'The asset is archived.' },
    ]);
  });
});
