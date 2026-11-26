import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachmentsApi, putToStorage } from '@/lib/files/api';
import {
  importsApi,
  importTemplatesApi,
  type ImportJob,
  type ImportUpdate,
} from '@/lib/imports/api';
import { assetsApi } from '@/lib/registry/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { setMockScanDelay } from '@/mocks/m2-handlers';
import { resetMockImportTiming, setMockImportTiming } from '@/mocks/w3-import-handlers';
import { mutateW3, w3 } from '@/mocks/w3-state';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { ImportsScreen } from './imports-screen';
import { JobScreen } from './job/job-screen';
import { NewImportScreen } from './new/new-import-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

const CSV = [
  'Serial Number,Asset ID,Category,Location,Assigned to',
  '5CG0001,IMP-0001,Chromebook,Room 101,',
  '5CG0002,IMP-0002,Chromebook,Room 999,',
  ',IMP-0003,Chromebook,Room 101,',
  '5CG0001,IMP-0004,Chromebook,Room 101,',
  '5CG0005,IMP-0005,Hovercraft,Room 101,',
  '5CG0006,IMP-0006,,Room 101,',
].join('\n');

const MATCHING = [
  'Serial Number,Asset ID,Category',
  '5CG0010,IMP-0010,Chromebook',
  '5CG0011,IMP-0011,Chromebook',
].join('\n');

const MAPPING = {
  columns: [
    { index: 0, target: 'serial' },
    { index: 1, target: 'asset_tag' },
    { index: 2, target: 'category' },
    { index: 3, target: 'location' },
    { index: 4, target: null },
  ],
};

/** A draft import with its file uploaded and scanned, not yet analysed (what the file step does first). */
async function uploaded(text: string, name = 'devices.csv', preset?: string) {
  const job = (
    await importsApi.create({ entity_type: 'asset', ...(preset ? { preset_key: preset } : {}) })
  ).value;
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
  return { job, attachmentId: created.attachment.id };
}

async function settle(id: string, state: ImportJob['state']) {
  for (let i = 0; i < 300; i += 1) {
    const job = (await importsApi.get(id)).value;
    if (job.state === state) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the import never reached ${state}`);
}

async function analysed(text: string, name = 'devices.csv') {
  const { job, attachmentId } = await uploaded(text, name);
  await importsApi.analyze(job.id, { file_attachment_id: attachmentId });
  return settle(job.id, 'analyzed');
}

/** An analysed import with the standard mapping, the serial number as the key and more options on request. */
async function mapped(text = CSV, update: ImportUpdate = {}) {
  const job = await analysed(text);
  return (
    await importsApi.update(job.id, {
      mapping: { columns: MAPPING.columns.slice(0, job.headers!.length) },
      ...update,
      options: { match_on: 'serial', ...update.options },
    })
  ).value;
}

async function reviewed(text = CSV, update: ImportUpdate = {}) {
  const job = await mapped(text, update);
  await importsApi.startDryRun(job.id);
  return settle(job.id, 'dry_run_done');
}

async function completed(text = CSV) {
  const job = await reviewed(text);
  await importsApi.commit(job.id, job.dry_run_digest!, `key-${job.id.slice(-8)}`);
  return settle(job.id, 'completed');
}

const open = (id: string, step?: string) =>
  window.history.pushState({}, '', `/imports/job?id=${id}${step ? `&step=${step}` : ''}`);

/** The mapping table once its field selects are there (they wait for the data dictionary). */
async function mappingTable() {
  const table = await screen.findByRole('table', { name: 'Columns of your file' });
  await waitFor(() => expect(within(table).getAllByRole('combobox').length).toBeGreaterThan(0));
  return table;
}

const fileInput = (container: HTMLElement) =>
  container.querySelector('input[type="file"]') as HTMLInputElement;

const SLOW = { batchMs: 60_000, batchRows: 1 };

beforeEach(() => {
  resetRouter();
  seedSession(MOCK_ACCOUNTS.owner);
  setMockScanDelay(0);
  setMockImportTiming({ analyze: 0, start: 0, batchMs: 5, batchRows: 2 });
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => resetMockImportTiming());

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

  it('starts an import from the preset of the kind: a draft job for the Google Admin ChromeOS preset', async () => {
    const user = userEvent.setup();
    renderApp(<NewImportScreen />);
    await user.click(await screen.findByRole('radio', { name: /Google Admin ChromeOS/ }));
    // the preset says what creating the import sets up
    expect(
      await screen.findByText(/creates the Chromebook category and these custom fields/),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/imports\/job\?id=/)),
    );
    const jobs = (await importsApi.list()).data;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: 'google_admin_csv',
      preset_key: 'google_admin_chromeos',
      entity_type: 'asset',
      state: 'draft',
    });
  });

  it('a plain kind creates its own preset', async () => {
    const user = userEvent.setup();
    renderApp(<NewImportScreen />);
    await user.click(await screen.findByRole('radio', { name: /Departments/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect((await importsApi.list()).data[0]).toMatchObject({
      entity_type: 'department',
      preset_key: 'departments',
    });
  });

  it('downloads the template of the chosen kind as CSV or Excel', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderApp(<NewImportScreen />);
    await user.click(await screen.findByRole('radio', { name: /Locations/ }));
    await user.click(screen.getByRole('button', { name: 'Download the Locations template (CSV)' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    await user.click(
      screen.getByRole('button', { name: 'Download the Locations template (Excel)' }),
    );
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2));
    const urls = fetchSpy.mock.calls.map(([input]) =>
      String(input instanceof Request ? input.url : input),
    );
    expect(
      urls.some((url) => url.includes('/v1/imports/presets/locations/template?format=csv')),
    ).toBe(true);
    expect(
      urls.some((url) => url.includes('/v1/imports/presets/locations/template?format=xlsx')),
    ).toBe(true);
    expect(screen.queryByText('We could not download the template.')).not.toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it('describes the columns of the template from the data dictionary and its notes', async () => {
    const { container } = renderApp(<NewImportScreen />);
    const table = await screen.findByRole(
      'table',
      { name: 'Columns of the Assets template' },
      { timeout: 5000 },
    );
    expect(within(table).getByText('Serial number')).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /Category/ })).toHaveTextContent('Yes');
    expect(screen.getByText(/Recommended order: locations, departments, people/)).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('offers to continue an import that is not finished', async () => {
    const { job } = await uploaded(CSV, 'half-done.csv');
    renderApp(<NewImportScreen />);
    expect(await screen.findByText('You have an import in progress: a new import.')).toBeVisible();
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
    await completed(MATCHING);
    const waiting = await analysed(CSV, 'later.csv');
    const { container } = renderApp(<ImportsScreen />);
    const table = await screen.findByRole('table', { name: 'Imports' });
    await within(table).findByText('later.csv');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('later.csv');
    expect(rows[0]).toHaveTextContent('Match the columns');
    expect(
      within(rows[0]!).getByRole('link', { name: 'Continue import later.csv' }),
    ).toHaveAttribute('href', `/imports/job?id=${waiting.id}`);
    expect(rows[1]).toHaveTextContent('Done');
    expect(within(rows[1]!).getByRole('link', { name: 'View import devices.csv' })).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('shows the progress of an import that is running', async () => {
    setMockImportTiming(SLOW);
    const job = await mapped();
    await importsApi.startDryRun(job.id);
    renderApp(<ImportsScreen />);
    const table = await screen.findByRole('table', { name: 'Imports' });
    expect(await within(table).findByText(/Checking 17%/)).toBeVisible();
  });

  it('shows the first-use state with a way to start', async () => {
    renderApp(<ImportsScreen />);
    expect(await screen.findByRole('heading', { name: 'No imports yet' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'New import' }).length).toBeGreaterThan(0);
  });
});

describe('import: upload the file', () => {
  it('uploads a CSV through the attachment pipeline and queues the analysis', async () => {
    const job = (await importsApi.create({ entity_type: 'asset', preset_key: 'assets' })).value;
    open(job.id);
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    await screen.findByRole('heading', { name: 'Upload your file' });
    expect(screen.getByTestId('import-step-caption')).toHaveTextContent('Step 2 of 6: Upload file');
    expect(screen.getByText(/A CSV or Excel \(\.xlsx\)/)).toBeVisible();
    await expectNoA11yViolations(container);
    await user.upload(fileInput(container), new File([CSV], 'devices.csv', { type: 'text/csv' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/imports/job?id=${job.id}`));
    const after = await settle(job.id, 'analyzed');
    expect(after).toMatchObject({ filename: 'devices.csv', source: 'csv', rows_total: 6 });
    expect(after.file_attachment_id).toBeTruthy();
  });

  it('accepts an Excel file and says so', async () => {
    const job = (await importsApi.create({ entity_type: 'asset' })).value;
    open(job.id);
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    await screen.findByRole('heading', { name: 'Upload your file' });
    expect(fileInput(container).accept).toBe('.csv,.xlsx');
    await user.upload(fileInput(container), new File(['PK'], 'devices.xlsx', { type: '' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const after = await settle(job.id, 'analyzed');
    expect(after).toMatchObject({ source: 'xlsx', filename: 'devices.xlsx' });
    expect(after.parse.format).toBe('xlsx');
  });

  it('declares text/csv for a CSV the browser calls an Excel file, and ignores other kinds of file', async () => {
    const job = (await importsApi.create({ entity_type: 'asset' })).value;
    open(job.id);
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    await screen.findByRole('heading', { name: 'Upload your file' });
    await user.upload(fileInput(container), new File(['a'], 'notes.txt', { type: 'text/plain' }));
    expect(router.replace).not.toHaveBeenCalled();
    await user.upload(
      fileInput(container),
      new File([CSV], 'devices.csv', { type: 'application/vnd.ms-excel' }),
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const after = await settle(job.id, 'analyzed');
    expect((await attachmentsApi.get(after.file_attachment_id!)).content_type).toBe('text/csv');
  });

  it('shows a file that did not pass the virus scan as rejected, and keeps the import without a file', async () => {
    const job = (await importsApi.create({ entity_type: 'asset' })).value;
    open(job.id);
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    await screen.findByRole('heading', { name: 'Upload your file' });
    await user.upload(fileInput(container), new File([CSV], 'eicar.csv', { type: 'text/csv' }));
    expect(await screen.findByText('Rejected')).toBeVisible();
    expect(router.replace).not.toHaveBeenCalled();
    expect((await importsApi.get(job.id)).value).toMatchObject({
      state: 'draft',
      file_attachment_id: null,
    });
  });

  it('can take another file for an import that was read: it is read again and the columns are matched afresh', async () => {
    const job = await mapped();
    open(job.id, 'file');
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    await screen.findByText(/The new file is read again and the columns are matched afresh/);
    await user.upload(
      fileInput(container),
      new File([MATCHING], 'second.csv', { type: 'text/csv' }),
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const after = await settle(job.id, 'analyzed');
    expect(after).toMatchObject({ filename: 'second.csv', rows_total: 2 });
    expect(after.headers).toEqual(['Serial Number', 'Asset ID', 'Category']);
  });

  it('says that too many imports are running, and reads the file when asked again', async () => {
    setMockImportTiming({ analyze: 60_000 });
    for (let i = 0; i < 2; i += 1) {
      const busy = await uploaded(CSV, `busy-${i}.csv`);
      await importsApi.analyze(busy.job.id, { file_attachment_id: busy.attachmentId });
    }
    const job = (await importsApi.create({ entity_type: 'asset' })).value;
    open(job.id);
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    await screen.findByRole('heading', { name: 'Upload your file' });
    await user.upload(fileInput(container), new File([CSV], 'devices.csv', { type: 'text/csv' }));
    expect(
      await screen.findByText('Too many imports are running at once. Try again in 30 seconds.'),
    ).toBeVisible();
    expect(router.replace).not.toHaveBeenCalled();
    // one of them finishes
    mutateW3(() => {
      const first = w3().importJobs[0]!;
      first.state = 'failed';
      first.phase_started_at = null;
    });
    await user.click(screen.getByRole('button', { name: 'Read the file again' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });
});

describe('import: match the columns', () => {
  it('shows that the file is being read, then the columns with a suggestion for each', async () => {
    setMockImportTiming({ analyze: 300 });
    const { job, attachmentId } = await uploaded(CSV);
    await importsApi.analyze(job.id, { file_attachment_id: attachmentId });
    open(job.id);
    renderApp(<JobScreen />);
    expect(await screen.findByText('Reading your file...')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Reading your file' })).toBeVisible();
    expect(screen.getByTestId('import-step-caption')).toHaveTextContent(
      'Step 3 of 6: Match columns',
    );
    expect(
      await screen.findByRole('table', { name: 'Columns of your file' }, { timeout: 5000 }),
    ).toBeVisible();
  });

  it('suggests a field for every column it recognises, with how sure it is, and lets the person change them', async () => {
    const job = await analysed(CSV);
    open(job.id);
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    const table = await mappingTable();
    expect(screen.getByTestId('import-file-summary')).toHaveTextContent('devices.csv: 6 rows');
    expect(
      await screen.findByText('We matched 5 of your columns. Check them and change what is wrong.'),
    ).toBeVisible();
    const field = within(table).getByRole('combobox', { name: 'Field for column Serial Number' });
    expect(field).toHaveTextContent('Serial number');
    // examples, how full the column is, what it looks like, and how sure the match is
    const row = within(table).getByRole('row', { name: /Serial Number/ });
    expect(row).toHaveTextContent('5CG0001');
    expect(row).toHaveTextContent('5 filled, 1 empty, 4 different');
    expect(row).toHaveTextContent('Exact');
    expect(within(table).getByRole('row', { name: /Asset ID/ })).toHaveTextContent('Suggested');
    await expectNoA11yViolations(container);

    await user.click(within(table).getByRole('combobox', { name: 'Field for column Location' }));
    await user.click(await screen.findByRole('option', { name: '(Do not import)' }));
    expect(
      within(table).getByRole('combobox', { name: 'Field for column Location' }),
    ).toHaveTextContent('(Do not import)');
    // choosing a field for another column takes it away from the first
    await user.click(within(table).getByRole('combobox', { name: 'Field for column Asset ID' }));
    await user.click(await screen.findByRole('option', { name: 'Serial number' }));
    expect(
      within(table).getByRole('combobox', { name: 'Field for column Serial Number' }),
    ).toHaveTextContent('(Do not import)');
    expect(within(table).getByRole('row', { name: /Asset ID/ })).toHaveTextContent('Chosen by you');
  });

  it('shows the first rows of the file', async () => {
    const job = await analysed(CSV);
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await mappingTable();
    await user.click(screen.getByText('First rows of your file'));
    const preview = screen.getByRole('table', {
      name: 'The first rows of your file',
      hidden: true,
    });
    expect(within(preview).getAllByRole('row', { hidden: true })).toHaveLength(6);
  });

  it('blocks the dry run until the asset has a category: a column, or a default', async () => {
    const job = await analysed(CSV);
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    const table = await mappingTable();
    await user.click(within(table).getByRole('combobox', { name: 'Field for column Category' }));
    await user.click(await screen.findByRole('option', { name: '(Do not import)' }));
    expect(
      await screen.findByText(/Choose a column for the category, or a default category below/),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    const defaults = screen.getByRole('group', { name: 'Defaults for empty cells' });
    await user.click(within(defaults).getByRole('combobox', { name: 'Category' }));
    await user.click(await screen.findByRole('option', { name: 'Laptop' }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    expect(screen.queryByText(/Choose a column for the category/)).not.toBeInTheDocument();
  });

  it('asks for the date format of a column whose dates can be read two ways, and keeps it', async () => {
    const job = await analysed(
      'Serial,Category,Purchase date\nS-1,Chromebook,03/04/2024\nS-2,Chromebook,05/06/2024',
    );
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await mappingTable();
    await user.click(screen.getByRole('combobox', { name: 'Date format of column Purchase date' }));
    await user.click(await screen.findByRole('option', { name: 'Day/month/year (24/11/2026)' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const saved = (await importsApi.get(job.id)).value;
    expect(saved.mapping.columns.find((c) => c.target === 'purchase_date')).toMatchObject({
      date_format: 'dmy',
    });
  });

  it('saves the options for records that exist already, and shows the ones that belong to them', async () => {
    const job = await analysed(CSV);
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await mappingTable();
    expect(screen.queryByText('An empty cell when updating')).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'When the record exists already' }));
    await user.click(await screen.findByRole('option', { name: 'Update it with the file' }));
    expect(screen.getByRole('combobox', { name: 'An empty cell when updating' })).toBeVisible();
    expect(
      screen.getByRole('checkbox', {
        name: 'Leave a record alone that was edited after the dry run',
      }),
    ).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect((await importsApi.get(job.id)).value.options).toMatchObject({ on_match: 'update' });
  });

  it('saves a mapping by name, applies it again, refuses a second name and deletes it', async () => {
    const job = await analysed(CSV);
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await mappingTable();
    await user.type(
      await screen.findByLabelText('Name for this mapping'),
      'Spreadsheet of the office',
    );
    await user.click(screen.getByRole('button', { name: 'Save this mapping' }));
    expect(await screen.findByText('Mapping "Spreadsheet of the office" saved.')).toBeVisible();
    expect((await importTemplatesApi.list('asset')).map((t) => t.name)).toEqual([
      'Spreadsheet of the office',
    ]);

    // the import is read again from the server (the page remounts); bring the saved choice back
    const table = await mappingTable();
    await user.click(within(table).getByRole('combobox', { name: 'Field for column Location' }));
    await user.click(await screen.findByRole('option', { name: '(Do not import)' }));
    await user.click(await screen.findByRole('combobox', { name: 'Saved mapping' }));
    await user.click(await screen.findByRole('option', { name: 'Spreadsheet of the office' }));
    await user.click(screen.getByRole('button', { name: 'Use this mapping' }));
    expect(await screen.findByText('Mapping "Spreadsheet of the office" applied.')).toBeVisible();
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: 'Columns of your file' })).getByRole('combobox', {
          name: 'Field for column Location',
        }),
      ).toHaveTextContent('Location'),
    );

    await user.type(screen.getByLabelText('Name for this mapping'), 'spreadsheet of the office');
    await user.click(screen.getByRole('button', { name: 'Save this mapping' }));
    expect(await screen.findByText('A saved mapping with this name exists already.')).toBeVisible();

    await user.click(await screen.findByRole('combobox', { name: 'Saved mapping' }));
    await user.click(await screen.findByRole('option', { name: 'Spreadsheet of the office' }));
    await user.click(screen.getByRole('button', { name: 'Delete the chosen mapping' }));
    expect(await screen.findByText('Mapping "Spreadsheet of the office" deleted.')).toBeVisible();
    expect(await importTemplatesApi.list()).toEqual([]);
  });

  it('goes to the values that need a decision when one matches nothing and may not be created', async () => {
    const job = await analysed(CSV);
    await importsApi.update(job.id, { options: { references: { location: 'must_exist' } } });
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await mappingTable();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/imports/job?id=${job.id}&step=values`),
    );
    const saved = (await importsApi.get(job.id)).value;
    expect(saved.state).toBe('mapped');
    expect(saved.mapping.columns[0]).toMatchObject({ index: 0, target: 'serial' });
  });

  it('starts the dry run straight away when every value matches or may be created', async () => {
    const job = await analysed(MATCHING);
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await mappingTable();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/imports/job?id=${job.id}`));
    expect(['dry_running', 'dry_run_done']).toContain((await importsApi.get(job.id)).value.state);
  });

  it('says what is wrong with a file it cannot read, with the line, and offers another', async () => {
    const { job, attachmentId } = await uploaded('Serial,Name\n"5CG1,Broken', 'broken.csv');
    await importsApi.analyze(job.id, { file_attachment_id: attachmentId });
    await settle(job.id, 'failed');
    open(job.id);
    renderApp(<JobScreen />);
    expect(await screen.findByRole('heading', { name: 'The import failed' })).toBeVisible();
    expect(screen.getByText(/^Line 2/)).toBeVisible();
    expect(screen.getByText('The file could not be read, so nothing was imported.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Upload a different file' })).toHaveAttribute(
      'href',
      `/imports/job?id=${job.id}&step=file`,
    );
  });

  it('without import:run it shows the file but offers nothing to change', async () => {
    const job = await analysed(CSV);
    seedSession(MOCK_ACCOUNTS.viewer);
    open(job.id);
    renderApp(<JobScreen />);
    const table = await mappingTable();
    expect(
      screen.getByText(/You can see where this import stands, but not the rows of the file/),
    ).toBeVisible();
    expect(within(table).getByRole('row', { name: /Serial Number/ })).not.toHaveTextContent(
      '5CG0001',
    );
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Name for this mapping')).not.toBeInTheDocument();
    expect(
      screen.getByText('The rows of your file are only shown to people who may run imports.'),
    ).toBeVisible();
  });
});

describe('import: match the values', () => {
  it('lists the values with how many rows have them and what happens to each', async () => {
    const job = await mapped();
    open(job.id, 'values');
    const { container } = renderApp(<JobScreen />);
    const location = await screen.findByRole('table', { name: 'Values of Location' });
    expect(screen.getByTestId('import-step-caption')).toHaveTextContent(
      'Step 4 of 6: Match values',
    );
    expect(within(location).getByRole('row', { name: /Room 101/ })).toHaveTextContent(
      'Matches Riverside Elementary > Main building > Room 101',
    );
    expect(within(location).getByRole('row', { name: /Room 999/ })).toHaveTextContent(
      'Will be created',
    );
    const category = screen.getByRole('table', { name: 'Values of Category' });
    expect(within(category).getByRole('row', { name: /Chromebook/ })).toHaveTextContent(
      'Matches Chromebook',
    );
    expect(within(category).getByRole('row', { name: /Hovercraft/ })).toHaveTextContent(
      'Will be created',
    );
    expect(screen.getByText('Column: Location')).toBeVisible();
    expect(
      screen.getByText(
        'Every value matches a record or will be created. There is nothing to decide.',
      ),
    ).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('creates what is missing, picks an existing record, saves the value map and starts the dry run', async () => {
    const job = await mapped(CSV, {
      options: { references: { location: 'must_exist', category: 'must_exist' } },
    });
    open(job.id, 'values');
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    await screen.findByRole('table', { name: 'Values of Location' });
    expect(screen.getByTestId('import-values-open')).toHaveTextContent(
      '2 values still need a decision.',
    );
    expect(screen.getByRole('row', { name: /Room 999/ })).toHaveTextContent(
      'Not found: its rows will be errors',
    );
    await expectNoA11yViolations(container);

    await user.click(screen.getByRole('button', { name: 'Create all that are missing' }));
    expect(screen.queryByTestId('import-values-open')).not.toBeInTheDocument();
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
    expect(after.value_map!.location).toEqual({ 'room 999': { create: true } });
    expect(after.value_map!.category?.hovercraft).toMatchObject({ id: expect.any(String) });
    expect(after.options.references).toEqual({ location: 'must_exist', category: 'must_exist' });
    expect(['dry_running', 'dry_run_done']).toContain(after.state);
  });

  it('decides what a name that matches nothing turns into, for the whole kind', async () => {
    const job = await mapped();
    open(job.id, 'values');
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await screen.findByRole('table', { name: 'Values of Location' });
    await user.click(screen.getByRole('combobox', { name: 'When a location matches nothing' }));
    await user.click(await screen.findByRole('option', { name: 'Report an error' }));
    expect(screen.getByRole('row', { name: /Room 999/ })).toHaveTextContent('Not found');
    await user.click(screen.getByRole('button', { name: 'Run the dry run' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect((await importsApi.get(job.id)).value.options.references).toMatchObject({
      location: 'must_exist',
    });
  });

  it('shows a name that matches but would still fail as needing a decision (ED-37, BUG-5)', async () => {
    const job = await mapped(
      [
        'Serial Number,Asset ID,Category,Location',
        '5CG0201,AMB-0201,Chromebook,Room 101',
        '5CG0202,AMB-0202,Chromebook,Annex / Room 101',
      ].join('\n'),
    );
    open(job.id, 'values');
    renderApp(<JobScreen />);
    await screen.findByRole('table', { name: 'Values of Location' });
    const row = screen.getByRole('row', { name: /^Room 101/ });
    expect(row).toHaveTextContent('Needs a decision: its rows will be errors');
    expect(row).toHaveTextContent('"Annex > Room 101" named in this file');
    expect(row).not.toHaveTextContent('Matches');
    expect(screen.getByTestId('import-values-open')).toHaveTextContent('1 value still needs');
  });

  it('does not offer to create a status label, and searches the values of a long column', async () => {
    const text = [
      'Serial Number,Asset ID,Category,Status',
      ...Array.from({ length: 230 }, (_, i) => `S-${i},A-${i},Chromebook,Mystery ${i}`),
    ].join('\n');
    const job = await analysed(text);
    await importsApi.update(job.id, {
      mapping: {
        columns: [
          { index: 0, target: 'serial' },
          { index: 1, target: 'asset_tag' },
          { index: 2, target: 'category' },
          { index: 3, target: 'status' },
        ],
      },
    });
    open(job.id, 'values');
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    const status = await screen.findByRole('table', { name: 'Values of Status' });
    expect(screen.getByText(/Status labels are never created by an import/)).toBeVisible();
    expect(
      screen.getByText('Showing 200 of 230 different values. Search to find another one.'),
    ).toBeVisible();
    await user.click(screen.getByRole('combobox', { name: 'What to do with "Mystery 0"' }));
    expect(screen.queryByRole('option', { name: 'Create it' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Leave it empty' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.type(screen.getByLabelText('Search the values of status'), 'Mystery 99');
    await waitFor(() => expect(within(status).getByText('Mystery 99')).toBeVisible());
    expect(within(status).queryByText('Mystery 0')).not.toBeInTheDocument();
  });
});

describe('import: the dry run', () => {
  it('shows the check while it runs, with a way to stop it, then the result without a reload', async () => {
    setMockImportTiming({ batchMs: 400, batchRows: 2 });
    const job = await mapped();
    await importsApi.startDryRun(job.id);
    open(job.id);
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    expect(await screen.findByText('Preview. Nothing has been saved yet.')).toBeVisible();
    expect(await screen.findByTestId('import-check-text')).toHaveTextContent(
      /Checking your file|Checked \d of 6 rows/,
    );
    expect(screen.getByRole('progressbar', { name: 'Checking your file...' })).toBeVisible();
    await expectNoA11yViolations(container);
    expect(await screen.findByTestId('import-tile-create', {}, { timeout: 8000 })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run the dry run again' })).toBeVisible();
    void user;
  });

  it('stops a check that is running', async () => {
    setMockImportTiming({ batchMs: 400, batchRows: 1 });
    const job = await mapped();
    await importsApi.startDryRun(job.id);
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    expect(await screen.findByTestId('import-check-text')).toHaveTextContent(
      /Checked [0-9] of 6 rows/,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel the check' }));
    // the check stops at the end of the batch in flight
    expect((await settle(job.id, 'cancelled')).finished_at).toBeTruthy();
  });

  it('says nothing is saved, counts the outcomes, explains the errors and what will be created, and filters the rows', async () => {
    const before = (await assetsApi.list({ limit: 1, include_total: true })).page.total;
    const job = await reviewed();
    open(job.id);
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />);
    expect(await screen.findByText('Preview. Nothing has been saved yet.')).toBeVisible();
    expect(screen.getByTestId('import-step-caption')).toHaveTextContent('Step 5 of 6: Dry run');
    // what the dry run checked is said once for the import (ED-29); nothing waits for the commit here
    expect(screen.getByTestId('import-checks-note')).toHaveTextContent(
      'Every row was checked as it will be imported',
    );
    expect(screen.getByTestId('import-checks-note')).not.toHaveTextContent('location sits below');
    await screen.findByTestId('import-tile-create');
    expect(screen.getByTestId('import-tile-create')).toHaveTextContent('4');
    expect(screen.getByTestId('import-tile-update')).toHaveTextContent('0');
    expect(screen.getByTestId('import-tile-skip')).toHaveTextContent('1');
    expect(screen.getByTestId('import-tile-error')).toHaveTextContent('1');
    // why a row was rejected, and what the import would create on the way
    expect(screen.getByRole('list', { name: 'Reasons rows were rejected' })).toHaveTextContent(
      '1 row: a required value is missing (category)',
    );
    const willCreate = screen.getByRole('list', { name: 'Records the import would create' });
    expect(willCreate).toHaveTextContent('Location "Room 999" will be created.');
    expect(willCreate).toHaveTextContent('Category "Hovercraft" will be created.');
    const table = await screen.findByRole('table', { name: 'Rows of the dry run' });
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBe(7));
    expect(within(table).getByRole('row', { name: /IMP-0006/ }).textContent).toBeDefined();
    await expectNoA11yViolations(container);

    await user.click(screen.getByRole('button', { name: 'Errors' }));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    expect(table).toHaveTextContent('Category is required.');
    expect(screen.getByTestId('import-range')).toHaveTextContent('Rows 1-1 of 1');
    await user.click(screen.getByRole('button', { name: 'With warnings' }));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(4));
    expect(screen.getByTestId('import-range')).toHaveTextContent('Rows 1-3');
    await user.click(screen.getByRole('button', { name: 'Skipped' }));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    expect(table).toHaveTextContent('Repeats row 1 of the file; skipped.');
    // nothing was written
    expect((await assetsApi.list({ limit: 1, include_total: true })).page.total).toBe(before);
  });

  it('downloads the error report', async () => {
    const job = await reviewed();
    open(job.id);
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderApp(<JobScreen />);
    await user.click(await screen.findByRole('button', { name: 'Download error report' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(
      fetchSpy.mock.calls.some(([input]) =>
        String(input instanceof Request ? input.url : input).includes(
          `/v1/imports/${job.id}/errors.csv`,
        ),
      ),
    ).toBe(true);
    expect(screen.queryByText('We could not download the error report.')).not.toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it('pages a long result from the server', async () => {
    const text = [
      'Serial Number,Asset ID,Category',
      ...Array.from({ length: 120 }, (_, i) => `S-${i + 1},A-${i + 1},Chromebook`),
    ].join('\n');
    const job = await reviewed(text);
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    const range = await screen.findByTestId('import-range');
    await waitFor(() => expect(range).toHaveTextContent('Rows 1-50 of 120'));
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(range).toHaveTextContent('Rows 51-100 of 120'));
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(range).toHaveTextContent('Rows 101-120 of 120'));
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('lets the person go back to the columns or to a new file, and run the check again', async () => {
    const job = await reviewed();
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    expect(await screen.findByRole('link', { name: 'Back to columns' })).toHaveAttribute(
      'href',
      `/imports/job?id=${job.id}&step=mapping`,
    );
    expect(screen.getByRole('link', { name: 'Fix and upload again' })).toHaveAttribute(
      'href',
      `/imports/job?id=${job.id}&step=file`,
    );
    await user.click(screen.getByRole('button', { name: 'Run the dry run again' }));
    await waitFor(async () =>
      expect(['dry_running', 'dry_run_done']).toContain((await importsApi.get(job.id)).value.state),
    );
  });

  it('cannot import when no row can be written', async () => {
    const job = await reviewed('Serial Number,Asset ID,Category\n5CG1,A-1,');
    open(job.id);
    renderApp(<JobScreen />);
    expect(
      await screen.findByText('No row can be imported. Fix the file and upload it again.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Nothing to import' })).toBeDisabled();
  });

  it('shows the counts but no rows and no way to import without import:run', async () => {
    const job = await reviewed();
    seedSession(MOCK_ACCOUNTS.viewer);
    open(job.id);
    renderApp(<JobScreen />);
    expect(await screen.findByTestId('import-tile-create')).toHaveTextContent('4');
    expect(screen.getByText(/only people who may run imports see the rows/)).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Rows of the dry run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import \d+ rows?$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download error report' })).not.toBeInTheDocument();
  });

  it('says to run the dry run again when it changed after the one that was reviewed (import-stale-dry-run)', async () => {
    const job = await reviewed();
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await screen.findByTestId('import-tile-create');
    // somebody else changes an option and runs the dry run again: the digest moves on
    await importsApi.update(job.id, { options: { on_match: 'error' } });
    await importsApi.startDryRun(job.id);
    await settle(job.id, 'dry_run_done');
    await user.click(screen.getByRole('button', { name: 'Import 4 rows' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The file, your choices or the dry run changed after the one you reviewed. Run the dry run again and review the new result.',
    );
    expect((await importsApi.get(job.id)).value.state).toBe('dry_run_done');
  });

  it('says where the import is when it is in the wrong state (import-wrong-state)', async () => {
    const job = await reviewed();
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await screen.findByTestId('import-tile-create');
    await importsApi.cancel(job.id);
    await user.click(screen.getByRole('button', { name: 'Import 4 rows' }));
    // the screen follows the import to where it is, so the reason is also a toast
    expect(
      (
        await screen.findAllByText(
          'That is not possible while the import is "Cancelled". Reload the page to see where it stands.',
        )
      ).length,
    ).toBeGreaterThan(0);
  });

  it('says how long to wait when too many imports are running (import-quota-exceeded)', async () => {
    const job = await reviewed();
    setMockImportTiming(SLOW);
    for (let i = 0; i < 2; i += 1) {
      const other = await mapped();
      await importsApi.startDryRun(other.id);
    }
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await screen.findByTestId('import-tile-create');
    await user.click(screen.getByRole('button', { name: 'Import 4 rows' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many imports are running at once. Try again in 30 seconds.',
    );
  });
});

describe('import: commit, progress and summary', () => {
  it('imports the reviewed rows with a progress bar, then a summary with the rows that failed', async () => {
    setMockImportTiming({ batchMs: 250, batchRows: 1 });
    const job = await reviewed();
    open(job.id);
    const user = userEvent.setup();
    const { container } = renderApp(<JobScreen />, { workflows: true });
    await user.click(await screen.findByRole('button', { name: 'Import 4 rows' }));
    const progress = await screen.findByTestId('import-progress-text');
    expect(screen.getByTestId('import-step-caption')).toHaveTextContent('Step 6 of 6: Import');
    expect(progress).toHaveTextContent(/Importing|Imported \d of 4 rows|Waiting/);
    expect(screen.getByRole('progressbar', { name: 'Import progress' })).toBeVisible();
    await expectNoA11yViolations(container);

    expect(
      await screen.findByRole('heading', { name: 'Import finished' }, { timeout: 8000 }),
    ).toBeVisible();
    expect(screen.getByTestId('import-done-created')).toHaveTextContent('4');
    expect(screen.getByTestId('import-done-skipped')).toHaveTextContent('1');
    expect(screen.getByTestId('import-done-failed')).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: 'View assets' })).toHaveAttribute('href', '/assets');
    // the row that could not be imported is listed, with the problem
    const failed = await screen.findByRole('table', { name: 'Rows that could not be imported' });
    await waitFor(() => expect(within(failed).getAllByRole('row')).toHaveLength(2));
    expect(failed).toHaveTextContent('Category is required.');
    expect(screen.getByRole('button', { name: 'Download error report' })).toBeVisible();
    expect(
      (await assetsApi.list({ q: 'IMP-000', limit: 20 })).data.map((a) => a.asset_tag).sort(),
    ).toEqual(['IMP-0001', 'IMP-0002', 'IMP-0003', 'IMP-0005']);
    // BUG-2 (ED-38): the label window opens for exactly the assets this import created
    expect(
      (await assetsApi.list({ import_job_id: job.id, limit: 20 })).data
        .map((a) => a.asset_tag)
        .sort(),
    ).toEqual(['IMP-0001', 'IMP-0002', 'IMP-0003', 'IMP-0005']);
    await user.click(screen.getByRole('button', { name: 'Print labels for the new assets' }));
    const dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    expect(await within(dialog).findByText('4 assets match the current filter')).toBeVisible();
  });

  it('stops after the current batch when cancelled and says how many rows were written', async () => {
    setMockImportTiming({ batchMs: 300, batchRows: 1 });
    const job = await reviewed();
    await importsApi.commit(job.id, job.dry_run_digest!, 'key-cancel-ui-0001');
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    await screen.findByTestId('import-progress-text');
    await user.click(screen.getByRole('button', { name: 'Cancel import' }));
    expect(await screen.findByText('Stopping after the current batch...')).toBeVisible();
    expect(
      await screen.findByRole('heading', { name: 'Import cancelled' }, { timeout: 8000 }),
    ).toBeVisible();
    expect(screen.getByText(/had already been written and stay in the register/)).toBeVisible();
  });

  it('lands on the finished screen for a job that is done, and offers another import', async () => {
    const job = await completed(MATCHING);
    open(job.id);
    renderApp(<JobScreen />);
    expect(await screen.findByRole('heading', { name: 'Import finished' })).toBeVisible();
    expect(screen.getByTestId('import-step-caption')).toHaveTextContent('Step 6 of 6: Import');
    expect(screen.queryByTestId('import-done-failed-rows')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('table', { name: 'Rows that could not be imported' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start another import' })).toHaveAttribute(
      'href',
      '/imports/new?entity=asset',
    );
  });

  it('shows a failed job with its reason, and reads the file again when asked', async () => {
    const { job, attachmentId } = await uploaded('Serial,Name\n"5CG1,Broken', 'broken.csv');
    await importsApi.analyze(job.id, { file_attachment_id: attachmentId });
    await settle(job.id, 'failed');
    open(job.id);
    const user = userEvent.setup();
    renderApp(<JobScreen />);
    expect(await screen.findByRole('heading', { name: 'The import failed' })).toBeVisible();
    setMockImportTiming({ analyze: 60_000 });
    await user.click(screen.getByRole('button', { name: 'Read the file again' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/imports/job?id=${job.id}`));
    expect((await importsApi.get(job.id)).value.state).toBe('analyzing');
  });

  it('says that the details were removed when the retention period has passed, and offers no rows', async () => {
    const job = await completed(CSV);
    mutateW3(() => {
      w3().importJobs.find((j) => j.id === job.id)!.finished_at = new Date(
        Date.now() - 40 * 86_400_000,
      ).toISOString();
    });
    open(job.id);
    const { container } = renderApp(<JobScreen />);
    expect(await screen.findByRole('heading', { name: 'Import finished' })).toBeVisible();
    const note = await screen.findByText(
      /the rows, the column statistics, the sample rows, your value choices and the uploaded file of this import were removed/,
    );
    expect(note).toBeVisible();
    expect(screen.getByText('The details of this import were removed')).toBeVisible();
    // the counts stay, the rows and the error report do not
    expect(screen.getByTestId('import-done-created')).toHaveTextContent('4');
    expect(
      screen.queryByRole('table', { name: 'Rows that could not be imported' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download error report' })).not.toBeInTheDocument();
    expect((await importsApi.get(job.id)).value.data_purged_at).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it('says so for an import that does not exist', async () => {
    open('0190a6b2-00b2-7000-8000-000000000999');
    renderApp(<JobScreen />);
    expect(
      await screen.findByText('This import does not exist or you cannot see it.'),
    ).toBeVisible();
  });
});
