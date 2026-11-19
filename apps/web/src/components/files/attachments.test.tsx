import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { setMockScanDelay } from '@/mocks/m2-handlers';
import { uid } from '@/mocks/registry-fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { renderApp, seedSession } from '@/test/render';
import { AttachmentsPanel } from './attachments-panel';
import { formatBytes, matchesAccept } from './file-parts';
import { UploadSlot } from './upload-slot';

const asset = uid('asset', 124);
const file = (name: string, type: string, size = 64) =>
  new File([new Uint8Array(size)], name, { type });

describe('formatBytes and matchesAccept', () => {
  it('formats sizes in decimal units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(2_400_000)).toBe('2.4 MB');
    expect(formatBytes(125_000_000)).toBe('125 MB');
  });

  it('matches by wildcard type, exact type or extension', () => {
    expect(matchesAccept(file('a.png', 'image/png'), 'image/*')).toBe(true);
    expect(matchesAccept(file('a.pdf', 'application/pdf'), 'image/*')).toBe(false);
    expect(matchesAccept(file('A.PDF', 'application/octet-stream'), '.pdf')).toBe(true);
    expect(matchesAccept(file('a.pdf', 'application/pdf'), 'application/pdf, image/png')).toBe(
      true,
    );
  });
});

describe('AttachmentsPanel', () => {
  beforeEach(() => {
    seedSession(MOCK_ACCOUNTS.owner);
    setMockScanDelay(0);
  });

  it('lists the files with their scan state and only a clean one can be downloaded', async () => {
    const { container } = renderApp(
      <AttachmentsPanel entityType="asset" entityId={asset} canWrite />,
    );
    const list = await screen.findByRole('list', { name: 'Attached files' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    const byName = (name: string) => rows.find((r) => r.textContent?.includes(name))!;
    expect(byName('purchase-order.pdf')).toHaveTextContent('Ready');
    expect(byName('warranty-card.pdf')).toHaveTextContent('Scanning');
    expect(byName('invoice-copy.pdf')).toHaveTextContent('Rejected');
    expect(
      within(byName('purchase-order.pdf')).getByRole('button', { name: /Download/ }),
    ).toBeVisible();
    expect(
      within(byName('warranty-card.pdf')).queryByRole('button', { name: /Download/ }),
    ).toBeNull();
    expect(
      within(byName('invoice-copy.pdf')).queryByRole('button', { name: /Download/ }),
    ).toBeNull();
    await expectNoA11yViolations(container);
  });

  it('uploads through the presigned URL and ends with a ready file in the list', async () => {
    const user = userEvent.setup();
    renderApp(<AttachmentsPanel entityType="asset" entityId={asset} canWrite />);
    await screen.findByRole('list', { name: 'Attached files' });
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    await user.upload(input, file('quote.pdf', 'application/pdf', 2048));
    await waitFor(
      () =>
        expect(screen.getByRole('list', { name: 'Attached files' })).toHaveTextContent('quote.pdf'),
      { timeout: 5000 },
    );
    const row = within(screen.getByRole('list', { name: 'Attached files' }))
      .getAllByRole('listitem')
      .find((r) => r.textContent?.includes('quote.pdf'))!;
    await waitFor(() => expect(row).toHaveTextContent('Ready'), { timeout: 5000 });
  });

  it('shows the server message when a type is refused, and the file can be dismissed', async () => {
    const user = userEvent.setup();
    renderApp(<AttachmentsPanel entityType="asset" entityId={asset} canWrite />);
    await screen.findByRole('list', { name: 'Attached files' });
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type=file]')!,
      file('setup.exe', 'application/x-msdownload'),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Files of type "application/x-msdownload" are not accepted');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a read-only user sees the files but no drop zone and no delete', async () => {
    renderApp(<AttachmentsPanel entityType="asset" entityId={asset} canWrite={false} />);
    await screen.findByRole('list', { name: 'Attached files' });
    expect(screen.queryByRole('button', { name: 'Choose files' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
  });

  it('deleting asks first, then removes the file', async () => {
    const user = userEvent.setup();
    renderApp(<AttachmentsPanel entityType="asset" entityId={asset} canWrite />);
    await user.click(await screen.findByRole('button', { name: 'Delete purchase-order.pdf' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete purchase-order.pdf?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('purchase-order.pdf deleted.')).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByText('purchase-order.pdf', { selector: 'p' })).not.toBeInTheDocument(),
    );
  });

  it('an empty record says so', async () => {
    renderApp(<AttachmentsPanel entityType="asset" entityId={uid('asset', 5)} canWrite />);
    expect(await screen.findByText('No files attached yet.')).toBeVisible();
  });
});

describe('UploadSlot', () => {
  beforeEach(() => {
    seedSession(MOCK_ACCOUNTS.owner);
    setMockScanDelay(0);
  });

  function Harness() {
    const [ids, setIds] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    return (
      <div>
        <UploadSlot
          entityType="asset"
          entityId={asset}
          value={ids}
          onChange={setIds}
          onBusyChange={setBusy}
        />
        <output data-testid="ids">{ids.join(',')}</output>
        <output data-testid="busy">{String(busy)}</output>
      </div>
    );
  }

  it('turns a photo into an attachment id once it is clean, and is idle afterwards', async () => {
    const user = userEvent.setup();
    renderApp(<Harness />);
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type=file]')!,
      file('bezel.png', 'image/png', 300),
    );
    await waitFor(() => expect(screen.getByTestId('ids').textContent).not.toBe(''), {
      timeout: 8000,
    });
    await waitFor(() => expect(screen.getByTestId('busy')).toHaveTextContent('false'));
    expect(screen.getByRole('list', { name: 'Attached photos' })).toHaveTextContent('bezel.png');
  });

  it('only accepts pictures', async () => {
    const user = userEvent.setup({ applyAccept: true });
    renderApp(<Harness />);
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type=file]')!,
      file('notes.pdf', 'application/pdf'),
    );
    expect(screen.getByTestId('busy')).toHaveTextContent('false');
    expect(screen.queryByRole('list', { name: 'Uploads' })).not.toBeInTheDocument();
  });

  it('removing a photo takes its id back out of the form', async () => {
    const user = userEvent.setup();
    renderApp(<Harness />);
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type=file]')!,
      file('bezel.png', 'image/png', 300),
    );
    await waitFor(() => expect(screen.getByTestId('ids').textContent).not.toBe(''), {
      timeout: 8000,
    });
    await user.click(screen.getByRole('button', { name: 'Remove bezel.png' }));
    await waitFor(() => expect(screen.getByTestId('ids').textContent).toBe(''));
  });
});
