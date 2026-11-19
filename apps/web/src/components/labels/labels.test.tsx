import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assetsApi } from '@/lib/registry/api';
import { toAssetQuery, defaultViewState } from '@/lib/registry/asset-view';
import { LABEL_CHOICE_KEY } from '@/lib/labels/helpers';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
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

describe('LabelDialog', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedSession(MOCK_ACCOUNTS.owner);
    URL.createObjectURL = vi.fn(() => 'blob:mock-labels');
    URL.revokeObjectURL = vi.fn();
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
    ).toHaveTextContent('Avery 5160');
    const preview = await within(dialog).findByTestId('label-preview');
    expect(preview.style.width).toBe('66.7mm');
    expect(preview.style.height).toBe('25.4mm');
    expect(within(preview).getByRole('img', { name: 'QR code' })).toBeVisible();
    expect(within(preview).getByRole('img', { name: 'Code 128 barcode' })).toBeVisible();
    expect(within(preview).getByText(assets[0]!.asset_tag)).toBeVisible();
    await waitFor(() => expect(within(dialog).getByTestId('sheet-grid')).toBeVisible());
    await expectNoA11yViolations(dialog);
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

  it('generates the PDF with the chosen start, offers it for download and remembers the template', async () => {
    const user = userEvent.setup();
    const assets = await someAssets(3);
    let sent: Record<string, unknown> | undefined;
    server.use(
      http.post('/v1/labels/render', async ({ request }) => {
        sent = (await request.clone().json()) as Record<string, unknown>;
        return new HttpResponse('%PDF-1.4 mock', {
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': 'attachment; filename="labels-a4-21up.pdf"',
          },
        });
      }),
    );
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    await user.click(await within(dialog).findByRole('combobox', { name: 'Sheet template' }));
    await user.click(await screen.findByRole('option', { name: /A4 sheet, 3 x 7/ }));
    const grid = await within(dialog).findByRole('radiogroup', {
      name: 'Start position on the sheet',
    });
    await user.click(within(grid).getByRole('radio', { name: /^Position 4,/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Generate PDF' }));

    const ready = await within(dialog).findByTestId('labels-ready');
    expect(ready).toHaveTextContent('3 labels on 1 sheet');
    const download = within(ready).getByRole('link', { name: 'Download PDF' });
    expect(download).toHaveAttribute('href', 'blob:mock-labels');
    expect(download).toHaveAttribute('download', 'labels-a4-21up.pdf');
    expect(sent).toEqual({
      template_key: 'a4-21up',
      asset_ids: assets.map((a) => a.id),
      start_position: 4,
    });
    expect(JSON.parse(window.localStorage.getItem(LABEL_CHOICE_KEY)!)).toMatchObject({
      template_key: 'a4-21up',
    });
    await expectNoA11yViolations(dialog);
  });

  it('starts from the template used last time', async () => {
    window.localStorage.setItem(
      LABEL_CHOICE_KEY,
      JSON.stringify({ template_key: 'a4-10up', code_type: 'qr', fields: ['tag'] }),
    );
    const assets = await someAssets(2);
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    expect(
      await within(dialog).findByRole('combobox', { name: 'Sheet template' }),
    ).toHaveTextContent('A4 sheet, 2 x 5');
    expect(within(dialog).getByRole('checkbox', { name: 'QR code' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Code 128 barcode' })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Tag' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Name' })).not.toBeChecked();
  });

  it('sends the codes and fields only when they differ from the template', async () => {
    const user = userEvent.setup();
    const assets = await someAssets(1);
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.post('/v1/labels/render', async ({ request }) => {
        bodies.push((await request.clone().json()) as Record<string, unknown>);
        return new HttpResponse('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } });
      }),
    );
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: /^Print label for / });
    await within(dialog).findByTestId('label-preview');
    await user.click(within(dialog).getByRole('button', { name: 'Generate PDF' }));
    await within(dialog).findByTestId('labels-ready');
    expect(bodies[0]).toEqual({ template_key: 'avery-5160', asset_ids: [assets[0]!.id] });

    await user.click(within(dialog).getByRole('button', { name: 'Change and generate again' }));
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Code 128 barcode' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Serial number' }));
    await user.click(within(dialog).getByRole('button', { name: 'Generate PDF' }));
    await within(dialog).findByTestId('labels-ready');
    expect(bodies[1]).toMatchObject({ code_type: 'qr', fields: ['tag', 'name', 'serial'] });
  });

  it('asks for at least one code before it sends anything', async () => {
    const user = userEvent.setup();
    const assets = await someAssets(1);
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: /^Print label for / });
    await within(dialog).findByTestId('label-preview');
    await user.click(within(dialog).getByRole('checkbox', { name: 'QR code' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Code 128 barcode' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose at least one code.');
    expect(within(dialog).getByRole('button', { name: 'Generate PDF' })).toBeDisabled();
  });

  it('shows the server problem with its request id and lets the user try again', async () => {
    const user = userEvent.setup();
    const assets = await someAssets(1);
    server.use(
      http.post('/v1/labels/render', () =>
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

  it('prints the assets of a filter, and refuses more than 500 labels', async () => {
    const query = toAssetQuery({
      ...defaultViewState(),
      category_id: '0190a6b2-0001-7000-8000-000000000002',
    });
    const { unmount } = open({ kind: 'filter', query, total: 39 });
    let dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    await waitFor(() =>
      expect(within(dialog).getByTestId('labels-source')).toHaveTextContent(
        '39 assets match the current filter',
      ),
    );
    expect(await within(dialog).findByRole('button', { name: 'Generate PDF' })).toBeEnabled();
    unmount();

    open({ kind: 'filter', query: toAssetQuery(defaultViewState()), total: 612 });
    dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    expect(await within(dialog).findByText(/at most 500 labels/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Generate PDF' })).toBeDisabled();
  });

  it('has no start position to choose on a one-label page', async () => {
    window.localStorage.setItem(LABEL_CHOICE_KEY, JSON.stringify({ template_key: 'single-50x25' }));
    const assets = await someAssets(2);
    open({ kind: 'assets', assets });
    const dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    expect(await within(dialog).findByText(/one label per page/)).toBeVisible();
    expect(within(dialog).queryByRole('radiogroup')).not.toBeInTheDocument();
    const preview = within(dialog).getByTestId('label-preview');
    expect([preview.style.width, preview.style.height]).toEqual(['50mm', '25mm']);
  });
});
