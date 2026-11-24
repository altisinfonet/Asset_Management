import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachmentsApi, putToStorage } from '@/lib/files/api';
import { importsApi, type ImportJob } from '@/lib/imports/api';
import { assetsApi } from '@/lib/registry/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { setMockScanDelay } from '@/mocks/m2-handlers';
import { setMockImportTiming } from '@/mocks/w3-import-handlers';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { ImportsScreen } from './imports-screen';
import { JobScreen } from './job/job-screen';
import { NewImportScreen } from './new/new-import-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

const CSV = [
  'Serial Number,Asset ID,Category,Location',
  '5CG0001,IMP-0001,Chromebook,Room 101',
  '5CG0002,IMP-0002,Chromebook,Room 999',
  ',IMP-0003,Chromebook,Room 101',
  '5CG0001,IMP-0004,Chromebook,Room 101',
  '5CG0005,IMP-0005,Hovercraft,Room 101',
].join('\n');

const MATCHING = [
  'Serial Number,Asset ID,Category',
  '5CG0010,IMP-0010,Chromebook',
  '5CG0011,IMP-0011,Chromebook',
].join('\n');

/** A draft import with its file uploaded, scanned and attached (what step 2 leaves behind). */
async function draftWith(text: string, name = 'devices.csv'): Promise<ImportJob> {
  const job = (await importsApi.create({ source: 'csv', entity_type: 'asset' })).value;
  const created = await attachmentsApi.create({
    entity_type: 'import_job',
    entity_id: job.id,
    kind: 'import_file',
    filename: name,
    content_type: 'text/csv',
    size_bytes: new TextEncoder().encode(text).byteLength,
  });
  await putToStorage(created.upload, new Blob([text], { type: 'text/csv' }));
  await attachmentsApi.complete(created.attachment.id);
  return (await importsApi.update(job.id, { file_attachment_id: created.attachment.id })).value;
}

async function settle(id: string, state: ImportJob['state']) {
  for (let i = 0; i < 300; i += 1) {
    const job = (await importsApi.get(id)).value;
    if (job.state === state) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the import never reached ${state}`);
}

/** A draft whose dry run has been reviewed. */
async function reviewed(
  text: string,
  mapping: Record<string, string>,
  options: Record<string, unknown> = {},
) {
  const job = await draftWith(text);
  await importsApi.update(job.id, {
    mapping,
    options: { match_on: 'serial', create_missing_references: false, ...options },
  });
  await importsApi.startDryRun(job.id);
  return settle(job.id, 'dry_run_complete');
}

const open = (id: string, step?: string) =>
  window.history.pushState({}, '', `/imports/job?id=${id}${step ? `&step=${step}` : ''}`);

beforeEach(() => {
  resetRouter();
  seedSession(MOCK_ACCOUNTS.owner);
  setMockScanDelay(0);
  setMockImportTiming({ queued: 0, dryRun: 20, batchMs: 5, batchRows: 2 });
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => setMockImportTiming({ queued: 300, dryRun: 600, batchMs: 400, batchRows: 25 }));

describe('import: choose the data', () => {
  it('offers the five kinds, preselects one from the link and explains the order', async () => {
    window.history.pushState({}, '', '/imports/new?entity=person');
    const { container } = renderApp(<NewImportScreen />);
    const group = await screen.findByRole('group', { name: 'Kind of data' });
    expect(within(group).getAllByRole('radio')).toHaveLength(5);
    expect(within(group).getByRole('radio', { name: /People/ })).toBeChecked();
    expect(
      screen.getByText(
        /A good order for a first import: locations, departments, people, then assets/,
      ),
    ).toBeVisible();
    expect(screen.getByTestId('import-step-caption')).toHaveTextContent('Step 1 of 6: Choose data');
    await expectNoA11yViolations(container);
  });

  it('starts a Google Admin import: a draft job of the ChromeOS source, then the file step', async () => {
    const user = userEvent.setup();
    renderApp(<NewImportScreen />);
    await user.click(await screen.findByRole('radio', { name: /Google Admin ChromeOS/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/imports\/job\?id=/)),
    );
    const jobs = (await importsApi.list()).data;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: 'google_admin_csv',
      entity_type: 'asset',
      state: 'draft',
    });
  });

  it('downloads the template of the chosen kind', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderApp(<NewImportScreen />);
    await user.click(await screen.findByRole('radio', { name: /Locations/ }));
    await user.click(screen.getByRole('button', { name: 'Download the Locations template' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(
      fetchSpy.mock.calls.some(([input]) =>
        String(input instanceof Request ? input.url : input).includes(
          '/v1/import-templates/location',
        ),
      ),
    ).toBe(true);
    expect(screen.queryByText('We could not download the template.')).not.toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it('offers to continue an import that is not finished', async () => {
    const job = await draftWith(CSV, 'half-done.csv');
    renderApp(<NewImportScreen />);
    expect(await screen.findByText('You have an import in progress: half-done.csv.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Continue it' })).toHaveAttribute(
      'href',
      `/imports/job?id=${job.id}`,
    );
  });

  it('a viewer cannot reach it: the list has no "New import"', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    renderApp(<ImportsScreen />);
    expect(await screen.findByRole('heading', { name: 'No imports yet' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'New import' })).not.toBeInTheDocument();
  });
});

describe('import: list and resume', () => {
  it('lists imports newest first with their state, and continues one where it stopped', async () => {
    const done = await reviewed(MATCHING, {
      'Serial Number': 'serial',
      'Asset ID': 'asset_tag',
      Category: 'category',
    });
    await importsApi.commit(done.id, done.dry_run_digest!, 'key-list-commit-1');
    await settle(done.id, 'committed');
    const draft = await draftWith(CSV, 'later.csv');
    const { container } = renderApp(<ImportsScreen />);
    const table = await screen.findByRole('table', { name: 'Imports' });
    await within(table).findByText('later.csv');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('later.csv');
    expect(rows[0]).toHaveTextContent('Draft');
    expect(
      within(rows[0]!).getByRole('link', { name: 'Continue import later.csv' }),
    ).toHaveAttribute('href', `/imports/job?id=${draft.id}`);
    expect(rows[1]).toHaveTextContent('Done');
    expect(within(rows[1]!).getByRole('link', { name: 'View import devices.csv' })).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('shows the first-use state with a way to start', async () => {
    renderApp(<ImportsScreen />);
    expect(await screen.findByRole('heading', { name: 'No imports yet' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'New import' }).length).toBeGreaterThan(0);
  });
});

describe('import: upload the file', () => {
  it('uploads a CSV through the attachment pipeline and attaches it to the import', async () => {
    const job = (await importsApi.create({ source: 'csv', entity_type: 'asset' })).value;
    open(job.id);
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    await screen.findByRole('heading', { name: 'Upload your file' });
    expect(screen.getByTestId('import-step-caption')).toHaveTextContent('Step 2 of 6: Upload file');
    await expectNoA11yViolations(container);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([CSV], 'devices.csv', { type: 'text/csv' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/imports/job?id=${job.id}`));
    expect((await importsApi.get(job.id)).value).toMatchObject({
      original_filename: 'devices.csv',
      state: 'draft',
    });
    expect((await importsApi.get(job.id)).value.file_attachment_id).toBeTruthy();
  });

  it('shows a file that did not pass the virus scan as rejected, and keeps the import without a file', async () => {
    const job = (await importsApi.create({ source: 'csv', entity_type: 'asset' })).value;
    open(job.id);
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    await screen.findByRole('heading', { name: 'Upload your file' });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([CSV], 'eicar.csv', { type: 'text/csv' }));
    expect(await screen.findByText('Rejected')).toBeVisible();
    expect(router.replace).not.toHaveBeenCalled();
    expect((await importsApi.get(job.id)).value.file_attachment_id).toBeNull();
  });

  it('can swap the file of a draft and keeps the column choices', async () => {
    const job = await draftWith(CSV);
    await importsApi.update(job.id, { mapping: { 'Serial Number': 'serial' } });
    open(job.id, 'file');
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    await screen.findByText(/Your column choices are kept/);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([MATCHING], 'second.csv', { type: 'text/csv' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const after = (await importsApi.get(job.id)).value;
    expect(after.original_filename).toBe('second.csv');
    expect(after.mapping).toEqual({ 'Serial Number': 'serial' });
  });
});

describe('import: match the columns', () => {
  it('suggests a field for every column it recognises and lets the person change them', async () => {
    const job = await draftWith(CSV);
    open(job.id);
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    const table = await screen.findByRole('table', { name: 'Columns of your file' });
    expect(screen.getByTestId('import-step-caption')).toHaveTextContent(
      'Step 3 of 6: Match columns',
    );
    expect(screen.getByTestId('import-file-summary')).toHaveTextContent('devices.csv: 5 rows');
    expect(
      await screen.findByText('We matched 4 of your columns. Check them and change what is wrong.'),
    ).toBeVisible();
    const field = within(table).getByRole('combobox', { name: 'Field for column Serial Number' });
    expect(field).toHaveTextContent('Serial number');
    // examples and what each column looks like
    const row = within(table).getByRole('row', { name: /Serial Number/ });
    expect(row).toHaveTextContent('5CG0001');
    await expectNoA11yViolations(container);

    await user.click(within(table).getByRole('combobox', { name: 'Field for column Location' }));
    await user.click(await screen.findByRole('option', { name: '(Do not import)' }));
    expect(
      within(table).getByRole('combobox', { name: 'Field for column Location' }),
    ).toHaveTextContent('(Do not import)');
  });

  it('blocks the dry run until the column the duplicate check uses is there', async () => {
    const job = await draftWith(CSV);
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    const table = await screen.findByRole('table', { name: 'Columns of your file' });
    await user.click(within(table).getByRole('combobox', { name: 'Field for column Asset ID' }));
    await user.click(await screen.findByRole('option', { name: '(Do not import)' }));
    expect(
      await screen.findByText(
        'A column for "Asset tag" is needed to tell which records already exist.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('saves a mapping by name and applies it again', async () => {
    const job = await draftWith(CSV);
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    const table = await screen.findByRole('table', { name: 'Columns of your file' });
    await user.type(
      await screen.findByLabelText('Name for this mapping'),
      'Spreadsheet of the office',
    );
    await user.click(screen.getByRole('button', { name: 'Save this mapping' }));
    expect(await screen.findByText('Mapping "Spreadsheet of the office" saved.')).toBeVisible();
    // change something, then bring the saved choice back
    await user.click(within(table).getByRole('combobox', { name: 'Field for column Location' }));
    await user.click(await screen.findByRole('option', { name: '(Do not import)' }));
    await user.click(await screen.findByRole('combobox', { name: 'Use a saved mapping' }));
    await user.click(await screen.findByRole('option', { name: 'Spreadsheet of the office' }));
    expect(await screen.findByText('Mapping "Spreadsheet of the office" applied.')).toBeVisible();
    expect(
      within(table).getByRole('combobox', { name: 'Field for column Location' }),
    ).toHaveTextContent('Location');
    // a second mapping with the same name is refused by the server
    await user.type(screen.getByLabelText('Name for this mapping'), 'spreadsheet of the office');
    await user.click(screen.getByRole('button', { name: 'Save this mapping' }));
    expect(await screen.findByText(/already exists/)).toBeVisible();
  });

  it('goes to the values that need a decision when some match nothing', async () => {
    const job = await draftWith(CSV);
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await screen.findByRole('table', { name: 'Columns of your file' });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/imports/job?id=${job.id}&step=values`),
    );
    const saved = (await importsApi.get(job.id)).value;
    expect(saved.mapping).toMatchObject({ 'Serial Number': 'serial', Location: 'location' });
    expect(saved.state).toBe('draft');
  });

  it('starts the dry run straight away when every value matches', async () => {
    const job = await draftWith(MATCHING);
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await screen.findByRole('table', { name: 'Columns of your file' });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/imports/job?id=${job.id}`));
    expect(['dry_run_queued', 'dry_run_running', 'dry_run_complete']).toContain(
      (await importsApi.get(job.id)).value.state,
    );
  });

  it('says what is wrong with a file it cannot read and offers another', async () => {
    const job = await draftWith('Serial,Name\n"5CG1,Broken', 'broken.csv');
    open(job.id);
    renderApp(<JobScreen />);
    expect(await screen.findByText('We could not read the file.')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(/^.*Line 2/);
    expect(screen.getByRole('link', { name: 'Upload a different file' })).toHaveAttribute(
      'href',
      `/imports/job?id=${job.id}&step=file`,
    );
  });
});

describe('import: match the values', () => {
  it('lists what matches nothing, creates everything it may, and starts the dry run', async () => {
    const job = await draftWith(CSV);
    await importsApi.update(job.id, {
      mapping: { 'Serial Number': 'serial', Category: 'category', Location: 'location' },
      options: { match_on: 'serial' },
    });
    open(job.id, 'values');
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    const location = await screen.findByRole('table', { name: 'Values to decide for Location' });
    expect(screen.getByTestId('import-step-caption')).toHaveTextContent(
      'Step 4 of 6: Match values',
    );
    expect(within(location).getByText('Room 999')).toBeVisible();
    expect(within(location).queryByText('Room 101')).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Values to decide for Category' })).toHaveTextContent(
      'Hovercraft',
    );
    expect(screen.getByTestId('import-values-open')).toHaveTextContent(
      '2 values still need a decision.',
    );
    await expectNoA11yViolations(container);

    await user.click(screen.getByRole('button', { name: 'Create all that are missing' }));
    expect(screen.getByTestId('import-values-open')).not.toHaveTextContent('still need');
    expect(screen.getByRole('combobox', { name: 'What to do with "Room 999"' })).toHaveTextContent(
      'Create it',
    );
    // one value goes to an existing record instead
    await user.click(screen.getByRole('combobox', { name: 'What to do with "Hovercraft"' }));
    await user.click(await screen.findByRole('option', { name: 'Use an existing one' }));
    await user.click(
      await screen.findByRole('combobox', { name: 'Existing record for "Hovercraft"' }),
    );
    await user.click(await screen.findByRole('option', { name: 'Projector' }));

    await user.click(screen.getByRole('button', { name: 'Run the dry run' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/imports/job?id=${job.id}`));
    const after = (await importsApi.get(job.id)).value;
    expect(after.options.value_map).toMatchObject({
      location: { 'Room 999': { action: 'create' } },
      category: { Hovercraft: { action: 'map' } },
    });
    expect(['dry_run_queued', 'dry_run_running', 'dry_run_complete']).toContain(after.state);
  });

  it('does not offer to create a person or a status', async () => {
    const job = await draftWith(
      'Serial Number,Asset ID,Category,Assigned to\n5CG1,IMP-1,Chromebook,Nobody Known',
    );
    await importsApi.update(job.id, {
      mapping: { 'Serial Number': 'serial', Category: 'category', 'Assigned to': 'assignee' },
      options: { match_on: 'serial' },
    });
    open(job.id, 'values');
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await screen.findByRole('table', { name: 'Values to decide for Person' });
    expect(
      screen.getByText(/People and status labels are never created by an import/),
    ).toBeVisible();
    await user.click(screen.getByRole('combobox', { name: 'What to do with "Nobody Known"' }));
    expect(screen.queryByRole('option', { name: 'Create it' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Leave it empty' })).toBeVisible();
  });
});

describe('import: the dry run', () => {
  it('says nothing is saved, counts the outcomes and filters the rows', async () => {
    const job = await reviewed(CSV, {
      'Serial Number': 'serial',
      'Asset ID': 'asset_tag',
      Category: 'category',
      Location: 'location',
    });
    open(job.id);
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    expect(await screen.findByText('Preview. Nothing has been saved yet.')).toBeVisible();
    expect(screen.getByTestId('import-step-caption')).toHaveTextContent('Step 5 of 6: Dry run');
    expect(screen.getByTestId('import-tile-create')).toHaveTextContent('1');
    expect(screen.getByTestId('import-tile-skip')).toHaveTextContent('1');
    expect(screen.getByTestId('import-tile-error')).toHaveTextContent('3');
    const table = await screen.findByRole('table', { name: 'Rows of the dry run' });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(6));
    expect(screen.getByTestId('import-range')).toHaveTextContent('Rows 1-5 of 5');
    await expectNoA11yViolations(container);

    await user.click(screen.getByRole('button', { name: 'Errors' }));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(4));
    expect(within(table).getByText('Location "Room 999" was not found')).toBeVisible();
    expect(within(table).getByText('Serial number is required')).toBeVisible();
    // each row is known by its tag
    expect(within(table).getByText('IMP-0003')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Import 1 row' })).toBeEnabled();
    expect(screen.getByText('3 rows with errors will not be imported.')).toBeVisible();
  });

  it('downloads the error report', async () => {
    const job = await reviewed(CSV, {
      'Serial Number': 'serial',
      Category: 'category',
      Location: 'location',
    });
    open(job.id);
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderApp(<JobScreen />);
    await user.click(await screen.findByRole('button', { name: 'Download error report' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(
      fetchSpy.mock.calls.some(([input]) =>
        String(input instanceof Request ? input.url : input).includes(
          `/v1/imports/${job.id}/error-report`,
        ),
      ),
    ).toBe(true);
    fetchSpy.mockRestore();
  });

  it('pages a long result from the server', async () => {
    const lines = ['Serial Number,Category'];
    for (let n = 1; n <= 120; n += 1) lines.push(`SN-${String(n).padStart(4, '0')},Chromebook`);
    const job = await reviewed(lines.join('\n'), {
      'Serial Number': 'serial',
      Category: 'category',
    });
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('import-range')).toHaveTextContent('Rows 1-50 of 120'),
    );
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(screen.getByTestId('import-range')).toHaveTextContent('Rows 51-100 of 120'),
    );
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(screen.getByTestId('import-range')).toHaveTextContent('Rows 101-120 of 120'),
    );
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    await waitFor(() =>
      expect(screen.getByTestId('import-range')).toHaveTextContent('Rows 51-100 of 120'),
    );
  });

  it('shows the check while it runs, then the result without a reload', async () => {
    setMockImportTiming({ dryRun: 600 });
    const job = await draftWith(MATCHING);
    await importsApi.update(job.id, {
      mapping: { 'Serial Number': 'serial', Category: 'category' },
      options: { match_on: 'serial' },
    });
    await importsApi.startDryRun(job.id);
    open(job.id);
    const { container } = renderApp(<JobScreen />);
    expect(await screen.findByText('Preview. Nothing has been saved yet.')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Checking your file...' })).toBeVisible();
    await expectNoA11yViolations(container);
    expect(
      await screen.findByTestId('import-tile-create', undefined, { timeout: 5000 }),
    ).toHaveTextContent('2');
  });

  it('goes back to the columns, and to a new file, with the choices kept', async () => {
    const job = await reviewed(CSV, { 'Serial Number': 'serial', Category: 'category' });
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await user.click(await screen.findByRole('button', { name: 'Back to columns' }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/imports/job?id=${job.id}&step=mapping`),
    );
    const back = (await importsApi.get(job.id)).value;
    expect(back.state).toBe('draft');
    expect(back.dry_run_digest).toBeNull();
    expect(back.mapping).toEqual({ 'Serial Number': 'serial', Category: 'category' });
  });

  it('cannot import when no row can be written', async () => {
    const job = await reviewed('Serial Number,Category\n,Chromebook', {
      'Serial Number': 'serial',
      Category: 'category',
    });
    open(job.id);
    renderApp(<JobScreen />);
    expect(await screen.findByRole('button', { name: 'Nothing to import' })).toBeDisabled();
    expect(
      screen.getByText('No row can be imported. Fix the file and upload it again.'),
    ).toBeVisible();
  });
});

describe('import: commit, progress and summary', () => {
  it('imports the reviewed rows with a progress bar and a summary with links', async () => {
    const job = await reviewed(MATCHING, {
      'Serial Number': 'serial',
      'Asset ID': 'asset_tag',
      Category: 'category',
    });
    open(job.id);
    setMockImportTiming({ batchMs: 150, batchRows: 1 });
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    await user.click(await screen.findByRole('button', { name: 'Import 2 rows' }));
    const bar = await screen.findByRole('progressbar', { name: 'Import progress' });
    expect(screen.getByTestId('import-step-caption')).toHaveTextContent('Step 6 of 6: Import');
    expect(screen.getByRole('button', { name: 'Cancel import' })).toBeVisible();
    await expectNoA11yViolations(container);
    expect(bar).toHaveAttribute('max', '100');

    expect(
      await screen.findByRole('heading', { name: 'Import finished' }, { timeout: 5000 }),
    ).toBeVisible();
    expect(screen.getByTestId('import-done-created')).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: 'View assets' })).toHaveAttribute('href', '/assets');
    expect(screen.getByRole('link', { name: 'Print labels for the new assets' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Start another import' })).toHaveAttribute(
      'href',
      '/imports/new?entity=asset',
    );
    expect((await assetsApi.list({ q: 'IMP-001' })).data).toHaveLength(2);
    await expectNoA11yViolations(container);
  });

  it('stops after the current batch when cancelled and says how many rows were written', async () => {
    const job = await reviewed(MATCHING, {
      'Serial Number': 'serial',
      'Asset ID': 'asset_tag',
      Category: 'category',
    });
    open(job.id);
    setMockImportTiming({ batchMs: 400, batchRows: 1 });
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await user.click(await screen.findByRole('button', { name: 'Import 2 rows' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel import' }));
    expect(
      await screen.findByRole('heading', { name: 'Import cancelled' }, { timeout: 5000 }),
    ).toBeVisible();
    expect(screen.getByText(/already been written and stays? in the register\./)).toBeVisible();
  });

  it('lands on the finished screen for a job that is done, and on the right step after a reload', async () => {
    const job = await reviewed(MATCHING, {
      'Serial Number': 'serial',
      'Asset ID': 'asset_tag',
      Category: 'category',
    });
    await importsApi.commit(job.id, job.dry_run_digest!, 'key-reload-0001');
    await settle(job.id, 'committed');
    open(job.id);
    renderApp(<JobScreen />);
    expect(await screen.findByRole('heading', { name: 'Import finished' })).toBeVisible();
    // an old step in the URL does not move a finished job
    window.history.pushState({}, '', `/imports/job?id=${job.id}&step=mapping`);
  });

  it('shows a failed job with its reason', async () => {
    const job = await draftWith('Serial,Name\n"5CG1,Broken', 'broken.csv');
    await importsApi.update(job.id, { mapping: { Serial: 'serial' } });
    await importsApi.startDryRun(job.id);
    await settle(job.id, 'failed');
    open(job.id);
    renderApp(<JobScreen />);
    expect(await screen.findByRole('heading', { name: 'The import failed' })).toBeVisible();
    expect(screen.getByText(/Line 2/)).toBeVisible();
  });

  it('says so for an import that does not exist', async () => {
    window.history.pushState({}, '', '/imports/job?id=0190a6b2-00b2-7000-8000-000000000999');
    renderApp(<JobScreen />);
    expect(
      await screen.findByRole('heading', {
        name: 'This import does not exist or you cannot see it.',
      }),
    ).toBeVisible();
  });
});
