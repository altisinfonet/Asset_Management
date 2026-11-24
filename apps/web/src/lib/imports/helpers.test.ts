import { describe, expect, it } from 'vitest';
import type { ImportJob, ImportLookup, ImportTargetField } from './api';
import {
  applicableMapping,
  canCreateMissing,
  commitPercent,
  createAllMissing,
  isResumable,
  isRunning,
  kindOf,
  listRouteFor,
  mappedReferences,
  mappingProblems,
  openValueCount,
  rowKey,
  rowMessages,
  rowsToWrite,
  stepFor,
  stepperIndex,
  suggestedMapping,
  unmatchedValues,
} from './helpers';

const field = (key: string, extra: Partial<ImportTargetField> = {}): ImportTargetField => ({
  key,
  label: key,
  required: false,
  type: 'text',
  reference: null,
  custom: false,
  ...extra,
});

const lookup = (
  fieldKey: string,
  reference: ImportLookup['reference'],
  values: Array<[string, boolean]>,
): ImportLookup => ({
  field: fieldKey,
  reference,
  values: values.map(([value, matched]) => ({
    value,
    rows: 3,
    match: matched ? { id: 'x', name: value } : null,
  })),
});

describe('which step a job is on', () => {
  const job = (state: ImportJob['state'], file: string | null = 'f') => ({
    state,
    file_attachment_id: file,
  });

  it('follows the state, so a reload lands in the right place', () => {
    expect(stepFor(job('draft', null))).toBe('file');
    expect(stepFor(job('draft'))).toBe('mapping');
    expect(stepFor(job('dry_run_queued'))).toBe('review');
    expect(stepFor(job('dry_run_running'))).toBe('review');
    expect(stepFor(job('dry_run_complete'))).toBe('review');
    expect(stepFor(job('commit_queued'))).toBe('import');
    expect(stepFor(job('committing'))).toBe('import');
    expect(stepFor(job('committed'))).toBe('done');
    expect(stepFor(job('failed'))).toBe('done');
    expect(stepFor(job('cancelled'))).toBe('done');
  });

  it('lets only a draft go back to an earlier step', () => {
    expect(stepFor(job('draft'), 'values')).toBe('values');
    expect(stepFor(job('draft'), 'file')).toBe('file');
    expect(stepFor(job('draft'), 'import')).toBe('mapping');
    expect(stepFor(job('draft', null), 'values')).toBe('file');
    expect(stepFor(job('dry_run_complete'), 'mapping')).toBe('review');
    expect(stepFor(job('committed'), 'file')).toBe('done');
  });

  it('puts the finished screen on the last step of the indicator', () => {
    expect(stepperIndex('type')).toBe(0);
    expect(stepperIndex('review')).toBe(4);
    expect(stepperIndex('done')).toBe(5);
  });

  it('polls while the worker is busy and offers to continue what is not finished', () => {
    expect(isRunning('dry_run_queued')).toBe(true);
    expect(isRunning('committing')).toBe(true);
    expect(isRunning('draft')).toBe(false);
    expect(isRunning('dry_run_complete')).toBe(false);
    expect(isResumable('draft')).toBe(true);
    expect(isResumable('dry_run_complete')).toBe(true);
    expect(isResumable('committed')).toBe(false);
    expect(isResumable('cancelled')).toBe(false);
  });
});

describe('kinds of data', () => {
  it('knows the ChromeOS export is assets from Google Admin', () => {
    expect(kindOf({ entity_type: 'asset', source: 'google_admin_csv' })).toBe('chromeos');
    expect(kindOf({ entity_type: 'asset', source: 'csv' })).toBe('asset');
    expect(kindOf({ entity_type: 'person', source: 'csv' })).toBe('person');
    expect(kindOf({ entity_type: 'department', source: 'csv' })).toBe('department');
  });

  it('opens the list of what was imported', () => {
    expect(listRouteFor('asset')).toBe('/assets');
    expect(listRouteFor('person')).toBe('/people');
    expect(listRouteFor('location')).toBe('/locations');
    expect(listRouteFor('department')).toBe('/settings/departments');
  });
});

describe('column mapping', () => {
  it('starts from the suggestions and uses each target once', () => {
    const columns = [
      {
        index: 0,
        name: 'Serial No',
        sample_values: [],
        distinct_count: 0,
        empty_count: 0,
        detected_type: 'text' as const,
        suggested_field: 'serial',
      },
      {
        index: 1,
        name: 'S/N',
        sample_values: [],
        distinct_count: 0,
        empty_count: 0,
        detected_type: 'text' as const,
        suggested_field: 'serial',
      },
      {
        index: 2,
        name: 'Colour',
        sample_values: [],
        distinct_count: 0,
        empty_count: 0,
        detected_type: 'text' as const,
        suggested_field: null,
      },
    ];
    expect(suggestedMapping({ columns })).toEqual({ 'Serial No': 'serial' });
  });

  it('blocks a dry run without a required field, a double target or the match key', () => {
    const fields = [field('display_name', { required: true }), field('email')];
    expect(mappingProblems({ Name: 'display_name' }, fields, 'person', 'asset_tag').ok).toBe(true);
    const missing = mappingProblems({ Mail: 'email' }, fields, 'person', 'asset_tag');
    expect(missing.ok).toBe(false);
    expect(missing.missingRequired.map((f) => f.key)).toEqual(['display_name']);
    const twice = mappingProblems(
      { A: 'email', B: 'email', N: 'display_name' },
      fields,
      'person',
      'asset_tag',
    );
    expect(twice.duplicates).toEqual(['email']);
    expect(twice.ok).toBe(false);
    const assetFields = [field('asset_tag'), field('serial')];
    expect(
      mappingProblems({ Serial: 'serial' }, assetFields, 'asset', 'asset_tag').missingKey,
    ).toBe('asset_tag');
    expect(mappingProblems({ Serial: 'serial' }, assetFields, 'asset', 'serial').ok).toBe(true);
  });

  it('finds the reference fields that have a column and drops columns the file lacks', () => {
    const fields = [field('name'), field('location', { type: 'reference', reference: 'location' })];
    expect(mappedReferences({ Room: 'location', Name: 'name' }, fields).map((f) => f.key)).toEqual([
      'location',
    ]);
    expect(mappedReferences({ Name: 'name' }, fields)).toEqual([]);
    const columns = [
      {
        index: 0,
        name: 'Room',
        sample_values: [],
        distinct_count: 0,
        empty_count: 0,
        detected_type: 'text' as const,
        suggested_field: null,
      },
    ];
    expect(applicableMapping({ Room: 'location', Gone: 'name' }, { columns })).toEqual({
      Room: 'location',
    });
  });
});

describe('value decisions', () => {
  const lookups = [
    lookup('location', 'location', [
      ['Room 101', true],
      ['Room 999', false],
    ]),
    lookup('assignee', 'person', [['Nobody Known', false]]),
    lookup('category', 'category', [['Chromebook', true]]),
  ];

  it('lists only what matches nothing', () => {
    expect(unmatchedValues(lookups).map((l) => [l.field, l.values.map((v) => v.value)])).toEqual([
      ['location', ['Room 999']],
      ['assignee', ['Nobody Known']],
    ]);
  });

  it('never invents a person or a status label', () => {
    expect(canCreateMissing('location')).toBe(true);
    expect(canCreateMissing('person')).toBe(false);
    expect(canCreateMissing('status_label')).toBe(false);
  });

  it('creates everything it may and keeps earlier decisions', () => {
    expect(createAllMissing(lookups)).toEqual({ location: { 'Room 999': { action: 'create' } } });
    expect(createAllMissing(lookups, { location: { 'Room 999': { action: 'skip' } } })).toEqual({
      location: { 'Room 999': { action: 'skip' } },
    });
  });

  it('counts the values that still have no decision', () => {
    expect(openValueCount(lookups, {})).toBe(2);
    expect(openValueCount(lookups, { location: { 'Room 999': { action: 'create' } } })).toBe(1);
    expect(
      openValueCount(lookups, {
        location: { 'Room 999': { action: 'create' } },
        assignee: { 'Nobody Known': { action: 'skip' } },
      }),
    ).toBe(0);
  });
});

describe('progress and rows', () => {
  it('turns the commit counters into a percentage', () => {
    expect(
      commitPercent({
        rows_total: 200,
        commit_progress: { processed: 50, created: 50, updated: 0, skipped: 0, failed: 0 },
      }),
    ).toBe(25);
    expect(commitPercent({ rows_total: 0, commit_progress: null })).toBe(0);
    expect(
      commitPercent({
        rows_total: 10,
        commit_progress: { processed: 99, created: 0, updated: 0, skipped: 0, failed: 0 },
      }),
    ).toBe(100);
    expect(rowsToWrite({ rows_create: 1102, rows_update: 118 })).toBe(1220);
  });

  it('knows a row by the first of tag, serial, name, email the mapping gives', () => {
    const mapping = { 'Serial Number': 'serial', 'Asset ID': 'asset_tag' };
    expect(rowKey({ source_data: { 'Serial Number': '5CG1', 'Asset ID': 'AT-9' } }, mapping)).toBe(
      'AT-9',
    );
    expect(rowKey({ source_data: { 'Serial Number': '5CG1', 'Asset ID': '' } }, mapping)).toBe(
      '5CG1',
    );
    expect(rowKey({ source_data: null }, mapping)).toBe('');
  });

  it('lists a row problems errors first', () => {
    expect(
      rowMessages({
        errors: [{ pointer: '/serial', message: 'Serial number is required' }],
        warnings: [{ pointer: '/location', message: 'Location "X" will be created' }],
      }),
    ).toEqual(['Serial number is required', 'Location "X" will be created']);
  });
});
