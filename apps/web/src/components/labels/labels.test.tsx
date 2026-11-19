import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { labelsApi } from '@/lib/labels/api';
import { assetsApi } from '@/lib/registry/api';
import { toAssetQuery, defaultViewState } from '@/lib/registry/asset-view';
import { LABEL_CHOICE_KEY } from '@/lib/labels/helpers';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { setMockLabelDelay, setMockLabelFailure } from '@/mocks/w2-misc-handlers';
import { expectNoA11yViolations } from '@/test/axe';
import { renderApp, seedSession } from '@/test/render';
import { LabelDialog, type LabelsRequest } from './label-dialog';

async function someAssets(count: number) {
  return (await assetsApi.list({ sort: ['asset_tag'], limit: count })).data;
}

function open(request: LabelsRequest) {
  const onClose = vi.fn();
  const view = renderApp(<LabelDialog request={request} onClose={onClose} />);
  return { ...view, onClose };
}

/** What the dialog sends to `POST /v1/labels/batches`, with the `Idempotency-Key` it carried. */
function captureBatches() {
  const sent: Array<{ body: Record<string, unknown>; key: string | null }> = [];
  const listener = ({ request }: { request: Request }) => {
    if (request.method === 'POST' && new URL(request.url).pathname === '/v1/labels/batches') {
      const key = request.headers.get('idempotency-key');
      void request
        .clone()
        .json()
        .then((body: Record<string, unknown>) => sent.push({ body, key }));
    }
  };
  server.events.on('request:start', listener);
  return { sent, stop: () => server.events.removeListener('request:start', listener) };
}

describe('LabelDialog', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedSession(MOCK_ACCOUNTS.owner);
    // the mock "worker" renders the sheet at once, unless a test wants to see it queued
    setMockLabelDelay(0);
  });
  afterEach(() => {
    setMockLabelDelay(1200);
    setMockLabelFailure(undefined);
  });

  it('shows the first template, the selection and a true-to-scale preview, with no axe violations', async () => {
    const assets = await someAssets(3);
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    expect(await within(dialog).findByTestId('labels-source')).toHaveTextContent(
      '3 selected assets',
    );
    expect(
      await within(dialog).findByRole('combobox', { name: 'Sheet template' }),
    ).toHaveTextContent('US Letter 30-up (Avery 5160 layout), QR');
    const preview = await within(dialog).findByTestId('label-preview');
    expect(preview.style.width).toBe('66.68mm');
    expect(preview.style.height).toBe('25.4mm');
    // this template draws a QR code and no barcode, with the tag and the name
    expect(within(preview).getByRole('img', { name: 'QR code' })).toBeVisible();
    expect(within(preview).queryByRole('img', { name: 'Code 128 barcode' })).toBeNull();
    expect(within(preview).getByText(assets[0]!.asset_tag)).toBeVisible();
    await waitFor(() => expect(within(dialog).getByTestId('sheet-grid')).toBeVisible());
    await expectNoA11yViolations(dialog);
  });

  it('offers the six fixed templates of the API', async () => {
    const assets = await someAssets(1);
    const user = userEvent.setup();
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: /^Print label for / });
    await user.click(await within(dialog).findByRole('combobox', { name: 'Sheet template' }));
    expect(await screen.findAllByRole('option')).toHaveLength(6);
  });

  it('picks the start position on a partly used sheet from the grid and shows the sheets it needs', async () => {
    const user = userEvent.setup();
    const assets = await someAssets(30);
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    const grid = await within(dialog).findByRole('radiogroup', {
      name: 'Start position on the sheet',
    });
    expect(within(grid).getAllByRole('radio')).toHaveLength(30);
    expect(within(dialog).getByTestId('labels-start')).toHaveTextContent('1');
    expect(within(dialog).queryByText('Sheet 1 of 2')).not.toBeInTheDocument();

    await user.click(within(grid).getByRole('radio', { name: /^Position 7, row 3, column 1/ }));
    expect(within(dialog).getByTestId('labels-start')).toHaveTextContent('7');
    // slots 1-6 are used now, 24 labels fit and 6 spill to a second sheet
    expect(within(grid).getByRole('radio', { name: /^Position 3,.*already used/ })).toBeVisible();
    expect(within(grid).getByRole('radio', { name: /^Position 7,.*gets a label/ })).toBeChecked();
    expect(await within(dialog).findByText('Sheet 1 of 2')).toBeVisible();

    // arrow keys move the choice, like a radio group
    within(grid)
      .getByRole('radio', { name: /^Position 7,/ })
      .focus();
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(within(dialog).getByTestId('labels-start')).toHaveTextContent('11');

    await user.click(within(dialog).getByRole('button', { name: 'Next sheet' }));
    expect(await within(dialog).findByText('Sheet 2 of 2')).toBeVisible();
    expect(within(dialog).queryByRole('radiogroup')).not.toBeInTheDocument();
    await expectNoA11yViolations(dialog);
  });

  it('queues the batch with the chosen start, follows it until it is ready, offers the download and remembers the template', async () => {
    const user = userEvent.setup();
    const assets = await someAssets(3);
    const capture = captureBatches();
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    await user.click(await within(dialog).findByRole('combobox', { name: 'Sheet template' }));
    await user.click(await screen.findByRole('option', { name: /A4 21-up/ }));
    const grid = await within(dialog).findByRole('radiogroup', {
      name: 'Start position on the sheet',
    });
    await user.click(within(grid).getByRole('radio', { name: /^Position 4,/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Generate PDF' }));

    const ready = await within(dialog).findByTestId('labels-ready');
    expect(ready).toHaveTextContent('3 labels on 1 sheet');
    const download = within(ready).getByRole('link', { name: 'Download PDF' });
    expect(download.getAttribute('href')).toMatch(/^\/mock-storage\/labels\/.+\.pdf$/);
    expect(download.getAttribute('download')).toMatch(/^labels-a4-21up-qr-.+\.pdf$/);
    await waitFor(() => expect(capture.sent).toHaveLength(1));
    capture.stop();
    expect(capture.sent[0]!.body).toEqual({
      template_key: 'a4-21up-qr',
      asset_ids: assets.map((a) => a.id),
      start_position: 4,
    });
    // the contract requires a key, so a retry replays the batch instead of making a second one
    expect(capture.sent[0]!.key).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(LABEL_CHOICE_KEY)!)).toMatchObject({
      template_key: 'a4-21up-qr',
    });
    await expectNoA11yViolations(dialog);
  });

  it('shows the batch as queued while the PDF is being made, and the dialog can be closed meanwhile', async () => {
    setMockLabelDelay(60_000);
    const user = userEvent.setup();
    const assets = await someAssets(2);
    const { onClose } = open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    await within(dialog).findByTestId('label-preview');
    await user.click(within(dialog).getByRole('button', { name: 'Generate PDF' }));
    const queued = await within(dialog).findByTestId('labels-queued');
    expect(queued).toHaveTextContent('Making your labels');
    expect(queued).toHaveTextContent('you get a notification when the PDF is ready');
    expect(within(dialog).queryByTestId('labels-ready')).not.toBeInTheDocument();
    await expectNoA11yViolations(dialog);
    await user.click(within(queued).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('says why a batch failed and goes back to the form to try again', async () => {
    setMockLabelFailure('logo-invalid');
    const user = userEvent.setup();
    const assets = await someAssets(1);
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: /^Print label for / });
    await within(dialog).findByTestId('label-preview');
    await user.click(within(dialog).getByRole('button', { name: 'Generate PDF' }));
    const failed = await within(dialog).findByTestId('labels-failed');
    expect(failed).toHaveTextContent('The labels could not be made');
    expect(failed).toHaveTextContent('The logo is not a clean PNG or JPEG.');
    await expectNoA11yViolations(dialog);

    setMockLabelFailure(undefined);
    await user.click(within(failed).getByRole('button', { name: 'Try again' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Generate PDF' }));
    expect(await within(dialog).findByTestId('labels-ready')).toBeVisible();
  });

  it('tells an expired batch from a ready one', async () => {
    const user = userEvent.setup();
    const assets = await someAssets(1);
    server.use(
      http.get('/v1/labels/batches/:id', async ({ params }) => {
        const real = await labelsApi.batches();
        const batch = real.data[0];
        return HttpResponse.json({
          ...batch,
          id: params.id,
          status: 'expired',
          download_url: null,
          download_expires_at: null,
        });
      }),
    );
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: /^Print label for / });
    await within(dialog).findByTestId('label-preview');
    await user.click(within(dialog).getByRole('button', { name: 'Generate PDF' }));
    expect(await within(dialog).findByTestId('labels-expired')).toHaveTextContent(
      'This PDF has expired',
    );
  });

  it('opens a batch that was requested earlier (the "labels ready" notification)', async () => {
    const assets = await someAssets(2);
    const batch = await labelsApi.createBatch(
      { template_key: 'letter-30up-qr', asset_ids: assets.map((a) => a.id) },
      'test-key-0001',
    );
    open({ kind: 'batch', id: batch.id });
    const dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    const ready = await within(dialog).findByTestId('labels-ready');
    expect(ready).toHaveTextContent('2 labels on 1 sheet');
    expect(within(ready).getByRole('link', { name: 'Download PDF' })).toBeVisible();
    // nothing to change again: the form is not part of this view
    expect(within(dialog).queryByRole('button', { name: 'Change and generate again' })).toBeNull();
  });

  it('starts from the template used last time', async () => {
    window.localStorage.setItem(
      LABEL_CHOICE_KEY,
      JSON.stringify({ template_key: 'a4-24up-qr', codes: ['qr'], fields: ['asset_tag'] }),
    );
    const assets = await someAssets(2);
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    expect(
      await within(dialog).findByRole('combobox', { name: 'Sheet template' }),
    ).toHaveTextContent('A4 24-up, 3 x 8');
    expect(within(dialog).getByRole('checkbox', { name: 'QR code' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Code 128 barcode' })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Tag' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Name' })).not.toBeChecked();
  });

  it('sends the codes and fields only when they differ from the template', async () => {
    const user = userEvent.setup();
    const assets = await someAssets(1);
    const capture = captureBatches();
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: /^Print label for / });
    await within(dialog).findByTestId('label-preview');
    await user.click(within(dialog).getByRole('button', { name: 'Generate PDF' }));
    await within(dialog).findByTestId('labels-ready');
    await waitFor(() => expect(capture.sent).toHaveLength(1));
    expect(capture.sent[0]!.body).toEqual({
      template_key: 'letter-30up-qr',
      asset_ids: [assets[0]!.id],
    });

    await user.click(within(dialog).getByRole('button', { name: 'Change and generate again' }));
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Code 128 barcode' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Serial number' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Model' }));
    await user.click(within(dialog).getByRole('button', { name: 'Generate PDF' }));
    await within(dialog).findByTestId('labels-ready');
    await waitFor(() => expect(capture.sent).toHaveLength(2));
    capture.stop();
    // fields go in the API's order: tag, name, serial, location, model, organisation
    expect(capture.sent[1]!.body).toMatchObject({
      codes: ['qr', 'code128'],
      fields: ['asset_tag', 'name', 'serial', 'model'],
    });
  });

  it('prints text only when no code is ticked (an empty codes list)', async () => {
    const user = userEvent.setup();
    const assets = await someAssets(1);
    const capture = captureBatches();
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: /^Print label for / });
    await within(dialog).findByTestId('label-preview');
    await user.click(within(dialog).getByRole('checkbox', { name: 'QR code' }));
    expect(await within(dialog).findByText(/carry text only/)).toBeVisible();
    expect(within(dialog).queryByRole('img', { name: 'QR code' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Generate PDF' }));
    await within(dialog).findByTestId('labels-ready');
    await waitFor(() => expect(capture.sent).toHaveLength(1));
    capture.stop();
    expect(capture.sent[0]!.body).toMatchObject({ codes: [] });
  });

  it('shows the server problem with its request id and lets the user try again', async () => {
    const user = userEvent.setup();
    const assets = await someAssets(1);
    server.use(
      http.post('/v1/labels/batches', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Validation failed',
            status: 422,
            code: 'validation',
            detail: 'This template cannot hold both codes.',
            request_id: 'req-422-label',
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: /^Print label for / });
    await within(dialog).findByTestId('label-preview');
    await user.click(within(dialog).getByRole('button', { name: 'Generate PDF' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('This template cannot hold both codes.');
    expect(alert).toHaveTextContent('req-422-label');
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('sends a list filter as the filter itself, and refuses more than 2000 labels', async () => {
    const user = userEvent.setup();
    const query = toAssetQuery({
      ...defaultViewState(),
      category_id: '0190a6b2-0001-7000-8000-000000000002',
    });
    const capture = captureBatches();
    const { unmount } = open({ kind: 'filter', query, total: 39 });
    let dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    await waitFor(() =>
      expect(within(dialog).getByTestId('labels-source')).toHaveTextContent(
        '39 assets match the current filter',
      ),
    );
    await user.click(await within(dialog).findByRole('button', { name: 'Generate PDF' }));
    await within(dialog).findByTestId('labels-ready');
    await waitFor(() => expect(capture.sent).toHaveLength(1));
    capture.stop();
    // no 39 ids: the API resolves the filter itself, in the list's order
    expect(capture.sent[0]!.body).toEqual({
      template_key: 'letter-30up-qr',
      filter: { archived: 'exclude', category_id: ['0190a6b2-0001-7000-8000-000000000002'] },
    });
    unmount();

    open({ kind: 'filter', query: toAssetQuery(defaultViewState()), total: 2500 });
    dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    expect(await within(dialog).findByText(/at most 2000 labels/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Generate PDF' })).toBeDisabled();
  });

  it('sends the asset ids when the filter holds something a batch filter cannot say (a custom field)', async () => {
    const user = userEvent.setup();
    const capture = captureBatches();
    const query = toAssetQuery({
      ...defaultViewState(),
      cf: { key: 'condition', value: 'fair' },
    });
    open({ kind: 'filter', query, total: null });
    const dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    await waitFor(() =>
      expect(within(dialog).getByTestId('labels-source')).toHaveTextContent(
        /assets? match the current filter/,
      ),
    );
    await user.click(await within(dialog).findByRole('button', { name: 'Generate PDF' }));
    await within(dialog).findByTestId('labels-ready');
    await waitFor(() => expect(capture.sent).toHaveLength(1));
    capture.stop();
    const body = capture.sent[0]!.body;
    expect(body).not.toHaveProperty('filter');
    expect((body.asset_ids as string[]).length).toBeGreaterThan(1);
  });

  it('has no start position to choose on a one-label page', async () => {
    window.localStorage.setItem(
      LABEL_CHOICE_KEY,
      JSON.stringify({ template_key: 'single-50x25-qr' }),
    );
    const assets = await someAssets(2);
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    expect(await within(dialog).findByText(/one label per page/)).toBeVisible();
    expect(within(dialog).queryByRole('radiogroup')).not.toBeInTheDocument();
    const preview = within(dialog).getByTestId('label-preview');
    expect([preview.style.width, preview.style.height]).toEqual(['50mm', '25mm']);
  });
});
