import { describe, expect, it } from 'vitest';
import type { ImportJob, ImportMapping, ImportPreset, ImportRow, ImportValue } from './api';
import {
  analysisFailed,
  canCreate,
  columnsOf,
  createAllMissing,
  entryFor,
  entryKind,
  errorGroupsOf,
  fileFormatOf,
  hasDateTarget,
  isFinished,
  isPurged,
  isResumable,
  isRunning,
  kindOf,
  listRouteFor,
  mappedCount,
  mappedRefKinds,
  mappingProblems,
  needsDateFormat,
  needsDecision,
  normValue,
  policyOf,
  progressPercent,
  rowKey,
  rowQueryFor,
  rowsToWrite,
  setupOf,
  deferredRowsOf,
  rowWarnings,
  stepFor,
  stepperIndex,
  targetOptionsFor,
  willCreateOf,
  withDateFormat,
  withEntry,
  withImportContentType,
  withTarget,
} from './helpers';

const mapping = (
  targets: Array<string | null>,
  constants?: Record<string, string>,
): ImportMapping => ({
  columns: targets.map((target, index) => ({ index, target })),
  ...(constants ? { constants } : {}),
});

describe('which step a job is on', () => {
  const job = (state: ImportJob['state']) => ({ state });

  it('follows the state, so a reload lands in the right place', () => {
    expect(stepFor(job('draft'))).toBe('file');
    expect(stepFor(job('uploaded'))).toBe('file');
    expect(stepFor(job('analyzing'))).toBe('mapping');
    expect(stepFor(job('analyzed'))).toBe('mapping');
    expect(stepFor(job('mapped'))).toBe('mapping');
    expect(stepFor(job('dry_running'))).toBe('review');
    expect(stepFor(job('dry_run_done'))).toBe('review');
    expect(stepFor(job('committing'))).toBe('import');
    expect(stepFor(job('completed'))).toBe('done');
    expect(stepFor(job('failed'))).toBe('done');
    expect(stepFor(job('cancelled'))).toBe('done');
  });

  it('lets an analysed import go back to an earlier step, and a failed one take another file', () => {
    expect(stepFor(job('analyzed'), 'values')).toBe('values');
    expect(stepFor(job('mapped'), 'file')).toBe('file');
    expect(stepFor(job('dry_run_done'), 'mapping')).toBe('mapping');
    expect(stepFor(job('failed'), 'file')).toBe('file');
    // a running or finished import stays where its state puts it
    expect(stepFor(job('dry_running'), 'file')).toBe('review');
    expect(stepFor(job('committing'), 'mapping')).toBe('import');
    expect(stepFor(job('completed'), 'file')).toBe('done');
    expect(stepFor(job('draft'), 'values')).toBe('file');
  });

  it('numbers the stepper, the finished screen being the last step', () => {
    expect(stepperIndex('type')).toBe(0);
    expect(stepperIndex('values')).toBe(3);
    expect(stepperIndex('done')).toBe(5);
  });

  it('knows which states are being worked on, which are over and which can be resumed', () => {
    for (const state of ['analyzing', 'dry_running', 'committing'] as const) {
      expect(isRunning(state)).toBe(true);
    }
    for (const state of ['draft', 'analyzed', 'mapped', 'dry_run_done', 'completed'] as const) {
      expect(isRunning(state)).toBe(false);
    }
    expect(isFinished('completed')).toBe(true);
    expect(isFinished('failed')).toBe(true);
    expect(isFinished('cancelled')).toBe(true);
    expect(isFinished('dry_run_done')).toBe(false);
    expect(isResumable('mapped')).toBe(true);
    expect(isResumable('completed')).toBe(false);
  });

  it('tells a failed analysis (no headers) from a failed dry run, and a purged import', () => {
    expect(analysisFailed({ state: 'failed', headers: null })).toBe(true);
    expect(analysisFailed({ state: 'failed', headers: ['A'] })).toBe(false);
    expect(analysisFailed({ state: 'analyzed', headers: null })).toBe(false);
    expect(isPurged({ data_purged_at: null })).toBe(false);
    expect(isPurged({ data_purged_at: '2026-12-24T10:00:00.000Z' })).toBe(true);
  });
});

describe('the kind of data and the file', () => {
  it('names the kind from the preset, so a Google Admin import is not a plain asset import', () => {
    expect(
      kindOf({
        entity_type: 'asset',
        source: 'google_admin_csv',
        preset_key: 'google_admin_chromeos',
      }),
    ).toBe('chromeos');
    expect(kindOf({ entity_type: 'asset', source: 'csv', preset_key: 'assets' })).toBe('asset');
    expect(kindOf({ entity_type: 'asset', source: 'xlsx', preset_key: null })).toBe('asset');
    expect(kindOf({ entity_type: 'person', source: 'csv', preset_key: 'people' })).toBe('person');
    expect(kindOf({ entity_type: 'department', source: 'csv', preset_key: null })).toBe(
      'department',
    );
  });

  it('accepts CSV and XLSX, by the extension', () => {
    expect(fileFormatOf('devices.csv')).toBe('csv');
    expect(fileFormatOf('Devices.XLSX')).toBe('xlsx');
    expect(fileFormatOf('devices.xls')).toBeNull();
    expect(fileFormatOf('devices')).toBeNull();
  });

  it('declares the content type the extension calls for (browsers report what Excel registered)', () => {
    const csv = withImportContentType(
      new File(['a,b'], 'x.csv', { type: 'application/vnd.ms-excel' }),
    );
    expect(csv.type).toBe('text/csv');
    expect(csv.name).toBe('x.csv');
    const bare = withImportContentType(new File(['a,b'], 'x.csv', { type: '' }));
    expect(bare.type).toBe('text/csv');
    const sheet = withImportContentType(new File(['x'], 'x.xlsx', { type: '' }));
    expect(sheet.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const same = new File(['a'], 'x.csv', { type: 'text/csv' });
    expect(withImportContentType(same)).toBe(same);
  });
});

describe('targets of a column', () => {
  const preset = (entity: ImportPreset['entity_type'], targets: string[]): ImportPreset =>
    ({
      key: entity,
      label: entity,
      description: '',
      entity_type: entity,
      source: 'csv',
      notes: [],
      sets_up: null,
      columns: targets.map((target) => ({
        column: `Col ${target}`,
        target,
        description: `About ${target}`,
        required: target === 'category' ? 'yes' : 'no',
        example: '',
      })),
    }) as ImportPreset;

  it('lists the data dictionary of the entity, then its custom fields, once each', () => {
    const options = targetOptionsFor(
      'asset',
      [
        preset('asset', ['serial', 'category']),
        preset('asset', ['serial', 'external_id', 'cf:os_version']),
        preset('person', ['email']),
      ],
      [{ key: 'os_version', label: 'OS version', category: 'Chromebook' }],
    );
    expect(options.map((o) => o.key)).toEqual([
      'serial',
      'category',
      'external_id',
      'cf:os_version',
    ]);
    expect(options.find((o) => o.key === 'category')).toMatchObject({
      required: true,
      label: 'Col category',
    });
    expect(options.find((o) => o.key === 'cf:os_version')).toMatchObject({
      custom: true,
      label: 'OS version (Chromebook)',
    });
  });

  it('offers custom fields for assets only, and keeps a target the job uses even when the dictionary lacks it', () => {
    const options = targetOptionsFor(
      'person',
      [preset('person', ['email'])],
      [{ key: 'os_version', label: 'OS version' }],
      ['parent_path'],
    );
    expect(options.map((o) => o.key)).toEqual(['email', 'parent_path']);
    expect(options[1]!.label).toBe('Parent path');
  });
});

describe('editing the mapping', () => {
  it('sends a column to a target once: the column that had it lets go', () => {
    const next = withTarget(mapping(['serial', 'name', null]), 3, 2, 'serial');
    expect(next.columns.map((c) => c.target)).toEqual([null, 'name', 'serial']);
    expect(withTarget(mapping(['serial']), 3, 1, 'name').columns).toHaveLength(3);
  });

  it('starts from the draft mapping of a job that was never analysed (`{}`)', () => {
    expect(columnsOf({})).toEqual([]);
    expect(withTarget({}, 2, 0, 'name').columns).toEqual([
      { index: 0, target: 'name' },
      { index: 1, target: null },
    ]);
  });

  it('sets and clears the date format of one column', () => {
    const set = withDateFormat(mapping(['purchase_date']), 0, 'dmy');
    expect(set.columns[0]).toEqual({ index: 0, target: 'purchase_date', date_format: 'dmy' });
    expect(withDateFormat(set, 0, null).columns[0]).toEqual({ index: 0, target: 'purchase_date' });
  });

  it('counts mapped columns and notices dates', () => {
    expect(mappedCount(mapping(['a', null, 'b']))).toBe(2);
    expect(hasDateTarget(mapping(['purchase_date']))).toBe(true);
    expect(hasDateTarget(mapping(['name']))).toBe(false);
    expect(
      hasDateTarget(mapping(['cf:other']), [{ index: 0, header: 'x', type: 'date' } as never]),
    ).toBe(true);
    expect(needsDateFormat({ type: 'date', date_order: 'ambiguous' })).toBe(true);
    expect(needsDateFormat({ type: 'date', date_order: 'mixed' })).toBe(true);
    expect(needsDateFormat({ type: 'date', date_order: 'iso' })).toBe(false);
    expect(needsDateFormat({ type: 'text', date_order: null })).toBe(false);
  });
});

describe('what stops a dry run (the rules of the API)', () => {
  it('asset: a category (a column, a fixed value or a default) and something that tells rows apart', () => {
    expect(mappingProblems('asset', mapping(['serial', 'category']), {})).toEqual([]);
    expect(mappingProblems('asset', mapping(['serial']), {})).toEqual([{ kind: 'category' }]);
    expect(mappingProblems('asset', mapping(['serial']), { category: 'c1' })).toEqual([]);
    expect(mappingProblems('asset', mapping(['serial'], { category: 'Chromebook' }), {})).toEqual(
      [],
    );
    expect(mappingProblems('asset', mapping(['category']), {})).toEqual([{ kind: 'identity' }]);
    expect(mappingProblems('asset', mapping(['external_id', 'category']), undefined)).toEqual([]);
    expect(mappingProblems('asset', mapping([]), undefined).map((p) => p.kind)).toEqual([
      'category',
      'identity',
    ]);
  });

  it('person, location and department need a name', () => {
    expect(mappingProblems('person', mapping(['email']), {})).toEqual([]);
    expect(mappingProblems('person', mapping(['first_name']), {})).toEqual([]);
    expect(mappingProblems('person', mapping(['phone']), {})).toEqual([{ kind: 'name' }]);
    expect(mappingProblems('location', mapping(['path']), {})).toEqual([]);
    expect(mappingProblems('location', mapping(['code']), {})).toEqual([{ kind: 'name' }]);
    expect(mappingProblems('department', mapping(['name']), {})).toEqual([]);
    expect(mappingProblems('department', mapping([null]), {})).toEqual([{ kind: 'name' }]);
  });

  it('a target on two columns is a problem of its own', () => {
    expect(mappingProblems('department', mapping(['name', 'name']), {})).toEqual([
      { kind: 'duplicate', field: 'name' },
    ]);
  });
});

describe('references and the value map', () => {
  it('knows which reference kinds have a column or a fixed value, in the order of the screen', () => {
    expect(
      mappedRefKinds('asset', mapping(['assigned_to', 'model', 'category', 'serial'])),
    ).toEqual(['category', 'model', 'person']);
    expect(mappedRefKinds('asset', mapping(['serial'], { category: 'Chromebook' }))).toEqual([
      'category',
    ]);
    expect(mappedRefKinds('person', mapping(['department', 'category']))).toEqual(['department']);
    expect(mappedRefKinds('location', mapping(['parent_path']))).toEqual(['location']);
    expect(mappedRefKinds('department', mapping(['manager']))).toEqual(['person']);
  });

  it('defaults to creating what is missing, except status labels and people', () => {
    expect(policyOf({ references: {} }, 'category')).toBe('create');
    expect(policyOf({ references: {} }, 'location')).toBe('create');
    expect(policyOf({ references: {} }, 'status')).toBe('must_exist');
    expect(policyOf({ references: {} }, 'person')).toBe('must_exist');
    expect(policyOf({ references: { person: 'create', model: 'must_exist' } }, 'person')).toBe(
      'create',
    );
    expect(policyOf({ references: { model: 'must_exist' } }, 'model')).toBe('must_exist');
    expect(policyOf(undefined, 'vendor')).toBe('create');
    expect(canCreate('status')).toBe(false);
    expect(canCreate('person')).toBe(true);
  });

  it('keys the value map by the normalised value, as the API does', () => {
    expect(normValue('  Room   101 ')).toBe('room 101');
    const map = withEntry({}, 'location', ' Room  999 ', { create: true });
    expect(map).toEqual({ location: { 'room 999': { create: true } } });
    expect(entryFor(map, 'location', 'ROOM 999')).toEqual({ create: true });
    expect(entryFor(map, 'category', 'Room 999')).toBeNull();
    const without = withEntry(map, 'location', 'room 999', null);
    expect(without.location).toEqual({});
    expect(entryKind({ id: 'x' })).toBe('use');
    expect(entryKind({ create: true })).toBe('create');
    expect(entryKind({ skip: true })).toBe('skip');
    expect(entryKind(null)).toBeNull();
  });

  const value = (text: string, matched: boolean): ImportValue => ({
    value: text,
    count: 2,
    suggestion: matched ? { id: 'rec', name: text } : null,
    entry: null,
  });

  it('a value needs a decision when nothing matches it, nothing was decided and missing records are not created', () => {
    const none = {};
    expect(needsDecision(value('Hovercraft', false), 'category', { references: {} }, none)).toBe(
      false,
    );
    expect(
      needsDecision(
        value('Hovercraft', false),
        'category',
        { references: { category: 'must_exist' } },
        none,
      ),
    ).toBe(true);
    expect(
      needsDecision(
        value('Hovercraft', true),
        'category',
        { references: { category: 'must_exist' } },
        none,
      ),
    ).toBe(false);
    expect(needsDecision(value('Ready', false), 'status', { references: {} }, none)).toBe(true);
    const decided = withEntry({}, 'status', 'Ready', { skip: true });
    expect(needsDecision(value('Ready', false), 'status', { references: {} }, decided)).toBe(false);
  });

  it('creates every missing value of the kinds that can be created, and leaves the rest and earlier decisions', () => {
    const groups = [
      { kind: 'category' as const, values: [value('Hovercraft', false), value('Laptop', true)] },
      { kind: 'status' as const, values: [value('Mystery', false)] },
      { kind: 'person' as const, values: [value('Ada', false), value('Bo', false)] },
    ];
    const before = withEntry({}, 'person', 'Bo', { skip: true });
    const next = createAllMissing(groups, before);
    expect(next.category).toEqual({ hovercraft: { create: true } });
    expect(next.status).toBeUndefined();
    expect(next.person).toEqual({ ada: { create: true }, bo: { skip: true } });
    // the input is not changed
    expect(before.person).toEqual({ bo: { skip: true } });
  });
});

describe('progress, rows and the summary of a dry run', () => {
  it('reads the percent of the running step and the rows the commit will write', () => {
    expect(
      progressPercent({ progress: { phase: 'commit', processed: 5, total: 12, percent: 41.6 } }),
    ).toBe(42);
    expect(
      progressPercent({ progress: { phase: null, processed: 0, total: 0, percent: 120 } }),
    ).toBe(100);
    expect(
      rowsToWrite({
        counts: {
          dry_run: { create: 3, update: 2, skip: 4, error: 1 },
          commit: { created: 0, updated: 0, skipped: 0, error: 0 },
        },
      }),
    ).toBe(5);
  });

  it('names a row by its typed record, else by its first filled cell', () => {
    const row = (mapped: unknown, source: Record<string, string>) =>
      ({ mapped, source }) as Pick<ImportRow, 'mapped' | 'source'>;
    expect(rowKey(row({ f: { asset_tag: ' LAP-1 ', serial: 'S' } }, {}))).toBe('LAP-1');
    expect(rowKey(row({ f: { serial: 'S-9' } }, {}))).toBe('S-9');
    expect(rowKey(row({ f: { path: 'HQ > Room' } }, {}))).toBe('HQ > Room');
    expect(rowKey(row(null, { Name: '', Other: ' x ' }))).toBe('x');
    expect(rowKey(row(null, {}))).toBe('');
  });

  it('turns a filter into the rows query of the phase', () => {
    expect(rowQueryFor('all', 'dry_run')).toEqual({});
    expect(rowQueryFor('error', 'dry_run')).toEqual({ outcome: ['error'] });
    expect(rowQueryFor('warnings', 'dry_run')).toEqual({ has_warnings: true });
    expect(rowQueryFor('create', 'commit')).toEqual({ outcome: ['created'] });
    expect(rowQueryFor('skip', 'commit')).toEqual({ outcome: ['skipped'] });
    expect(rowQueryFor('error', 'commit')).toEqual({ outcome: ['error'] });
  });

  it('reads errors by code, what will be created and the preset setup out of the summary', () => {
    const summary = {
      counts: { create: 1, update: 0, skip: 0, error: 2 },
      errors_by_code: [
        { code: 'required', field: 'category', n: 2 },
        { code: 'odd', field: null, n: 1 },
        { nope: true },
      ],
      will_create: [
        { field: 'location', message: 'Location "Annex" will be created.', n: 3 },
        { x: 1 },
      ],
      setup: { category_created: true, custom_fields_created: ['os_version'] },
    };
    expect(errorGroupsOf({ summary })).toEqual([
      { code: 'required', field: 'category', count: 2 },
      { code: 'odd', field: null, count: 1 },
    ]);
    expect(willCreateOf({ summary })).toEqual([
      { field: 'location', message: 'Location "Annex" will be created.', count: 3 },
    ]);
    expect(setupOf({ summary })).toEqual({
      categoryCreated: true,
      customFieldsCreated: ['os_version'],
    });
    expect(errorGroupsOf({ summary: null })).toEqual([]);
    expect(willCreateOf({ summary: null })).toEqual([]);
    expect(setupOf({ summary: { counts: {} } })).toBeNull();
  });

  it('opens the list of what was imported', () => {
    expect(listRouteFor('asset')).toBe('/assets');
    expect(listRouteFor('person')).toBe('/people');
    expect(listRouteFor('location')).toBe('/locations');
    expect(listRouteFor('department')).toBe('/settings/departments');
  });
});

describe('what the dry run leaves to the commit (ED-29)', () => {
  it('counts the deferred rows once, from the summary', () => {
    expect(deferredRowsOf({ summary: { validated_at_commit: 3 } })).toBe(3);
    expect(deferredRowsOf({ summary: { validated_at_commit: 0 } })).toBe(0);
    expect(deferredRowsOf({ summary: { counts: {} } })).toBe(0);
    expect(deferredRowsOf({ summary: null })).toBe(0);
  });

  it('keeps "checked when the import runs" off the rows', () => {
    const warnings = [
      { code: 'will-create', field: 'location', message: 'Will create location "Annex"' },
      { code: 'validated-at-commit', field: null, message: 'Checked when the import runs.' },
    ];
    expect(rowWarnings(warnings)).toEqual([warnings[0]]);
  });
});
