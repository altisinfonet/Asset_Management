import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accessoriesApi, consumablesApi } from '@/lib/stock/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { StockScreen } from './stock-screen';
import { StockView } from './view/stock-view';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

async function accessoryNamed(name: string) {
  return (await accessoriesApi.list({ q: name })).data[0]!;
}
async function consumableNamed(name: string) {
  return (await consumablesApi.list({ q: name })).data[0]!;
}

describe('StockScreen: accessories', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('lists accessories with their quantities and a stock level in words, no axe violations', async () => {
    const { container } = renderApp(<StockScreen />);
    const charger = await screen.findByRole('row', { name: /USB-C charger 65 W/ });
    expect(screen.getByTestId('stock-range')).toHaveTextContent('Showing 1-4 of 4');
    // total 42, 11 out, 31 available, minimum 10
    expect(
      within(charger)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(expect.arrayContaining(['42', '11', '31', 'In stock', '10']));
    expect(screen.getByRole('row', { name: /HDMI cable 2 m/ })).toHaveTextContent('Low stock');
    expect(screen.getByRole('row', { name: /Docking station/ })).toHaveTextContent('Out of stock');
    expect(screen.getByTestId('stock-low-banner')).toHaveTextContent('2 items are low on stock.');
    await expectNoA11yViolations(container);
  });

  it('filters to low stock and by search, with a way out of an empty result', async () => {
    const user = userEvent.setup();
    renderApp(<StockScreen />);
    await screen.findByRole('row', { name: /HDMI cable 2 m/ });
    await user.click(screen.getByRole('checkbox', { name: 'Low stock only' }));
    await waitFor(() => expect(screen.getByTestId('stock-range')).toHaveTextContent('1-2 of 2'));
    expect(screen.queryByRole('row', { name: /USB-C charger/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Low stock only' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'zzzz');
    expect(await screen.findByRole('heading', { name: 'Nothing matches' })).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    expect(await screen.findByRole('row', { name: /USB-C charger/ })).toBeVisible();
  });

  it('checks out units from the row: validates the quantity, then hands them to a person', async () => {
    const user = userEvent.setup();
    renderApp(<StockScreen />);
    await user.click(await screen.findByRole('button', { name: 'Check out HDMI cable 2 m' }));
    const dialog = await screen.findByRole('dialog', { name: 'Check out HDMI cable 2 m' });
    expect(dialog).toHaveTextContent('3 available');
    await expectNoA11yViolations(dialog);

    const quantity = within(dialog).getByRole('spinbutton', { name: /^Quantity/ });
    await user.clear(quantity);
    await user.type(quantity, '4');
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    expect(await within(dialog).findByText('Choose who gets it.')).toBeVisible();
    expect(within(dialog).getByText('Enter a whole number from 1 to 3.')).toBeVisible();

    await user.click(within(dialog).getByRole('combobox', { name: /Person/ }));
    await user.type(within(dialog).getByRole('combobox', { name: /Person/ }), 'Alice');
    await user.click(await screen.findByRole('option', { name: /Alice Owner/ }));
    await user.clear(quantity);
    await user.type(quantity, '2');
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    expect(await screen.findByText(/2 x HDMI cable 2 m checked out to Alice Owner/)).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await accessoryNamed('HDMI')).qty_available).toBe(1);
    // the row follows
    expect(await screen.findByRole('row', { name: /HDMI cable 2 m/ })).toHaveTextContent(
      'Low stock',
    );
  });

  it('shows the API refusing a check-out that raced ahead of the screen', async () => {
    const user = userEvent.setup();
    renderApp(<StockScreen />);
    await user.click(await screen.findByRole('button', { name: 'Check out HDMI cable 2 m' }));
    const dialog = await screen.findByRole('dialog', { name: 'Check out HDMI cable 2 m' });
    // someone else takes the last units while the dialog is open
    const hdmi = await accessoryNamed('HDMI');
    const { peopleApi } = await import('@/lib/registry/api');
    const person = (await peopleApi.list({ limit: 1 })).data[0]!;
    await accessoriesApi.checkout(
      hdmi.id,
      { person_id: person.id, quantity: 3 },
      'key-race-000001',
    );
    await user.click(within(dialog).getByRole('combobox', { name: /Person/ }));
    await user.type(within(dialog).getByRole('combobox', { name: /Person/ }), 'Alice');
    await user.click(await screen.findByRole('option', { name: /Alice Owner/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/Only 0 of HDMI cable 2 m are available/);
    expect(dialog).toBeVisible();
  });

  it('hides the actions from someone who may only read', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    renderApp(<StockScreen />);
    await screen.findByRole('row', { name: /HDMI cable 2 m/ });
    expect(screen.queryByRole('button', { name: /^Check out/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New accessory' })).not.toBeInTheDocument();
  });

  it('adds an accessory and goes to its page', async () => {
    const user = userEvent.setup();
    renderApp(<StockScreen />);
    await user.click(await screen.findByRole('button', { name: 'New accessory' }));
    const dialog = await screen.findByRole('dialog', { name: 'New accessory' });
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findAllByText('This field is required.')).not.toHaveLength(0);
    await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'Mouse');
    await user.click(within(dialog).getByRole('combobox', { name: /^Category/ }));
    await user.click(await screen.findByRole('option', { name: 'Chargers' }));
    const total = within(dialog).getByRole('spinbutton', { name: /^Total quantity/ });
    await user.clear(total);
    await user.type(total, '12');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('"Mouse" added.')).toBeVisible();
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        expect.stringMatching(/^\/stock\/view\?kind=accessory&id=/),
      ),
    );
    expect((await accessoryNamed('Mouse')).qty_total).toBe(12);
  });
});

describe('StockScreen: consumables', () => {
  beforeEach(() => {
    resetRouter();
    window.history.pushState({}, '', '/stock?kind=consumable');
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('lists consumables with units and levels', async () => {
    const { container } = renderApp(<StockScreen />);
    const toner = await screen.findByRole('row', { name: /Toner HP 26A/ });
    expect(toner).toHaveTextContent('2 each');
    expect(toner).toHaveTextContent('Low stock');
    expect(screen.getByRole('row', { name: /AA batteries/ })).toHaveTextContent('Out of stock');
    expect(screen.getByRole('row', { name: /Printer paper A4/ })).toHaveTextContent('24 ream');
    expect(screen.getByRole('button', { name: 'Use AA batteries' })).toBeDisabled();
    await expectNoA11yViolations(container);
  });

  it('receives stock from the row and the numbers follow', async () => {
    const user = userEvent.setup();
    renderApp(<StockScreen />);
    await user.click(await screen.findByRole('button', { name: 'Receive Toner HP 26A' }));
    const dialog = await screen.findByRole('dialog', { name: 'Receive stock for Toner HP 26A' });
    await user.click(within(dialog).getByRole('button', { name: 'Receive' }));
    expect(await within(dialog).findByText('Enter a whole number greater than 0.')).toBeVisible();
    await user.type(within(dialog).getByRole('spinbutton', { name: /^Units received/ }), '5');
    await user.type(within(dialog).getByRole('textbox', { name: /^Note/ }), 'Delivery note 88');
    await user.click(within(dialog).getByRole('button', { name: 'Receive' }));
    expect(await screen.findByText('5 received. 7 on hand.')).toBeVisible();
    expect(await screen.findByRole('row', { name: /Toner HP 26A/ })).toHaveTextContent('7 each');
    expect(screen.getByRole('row', { name: /Toner HP 26A/ })).toHaveTextContent('In stock');
  });

  it('will not use more than is on hand', async () => {
    const user = userEvent.setup();
    renderApp(<StockScreen />);
    await user.click(await screen.findByRole('button', { name: 'Use Toner HP 26A' }));
    const dialog = await screen.findByRole('dialog', { name: 'Use Toner HP 26A' });
    expect(dialog).toHaveTextContent('2 on hand.');
    await user.type(within(dialog).getByRole('spinbutton', { name: /^Units used/ }), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Use' }));
    expect(await within(dialog).findByText('Only 2 are on hand.')).toBeVisible();
    await user.clear(within(dialog).getByRole('spinbutton', { name: /^Units used/ }));
    await user.type(within(dialog).getByRole('spinbutton', { name: /^Units used/ }), '2');
    await user.click(within(dialog).getByRole('button', { name: 'Use' }));
    expect(await screen.findByText('2 used. 0 on hand.')).toBeVisible();
  });
});

describe('StockView: accessory', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  async function openAccessory(name: string, tab?: string) {
    const item = await accessoryNamed(name);
    window.history.pushState(
      {},
      '',
      `/stock/view?kind=accessory&id=${item.id}${tab ? `&tab=${tab}` : ''}`,
    );
    return item;
  }

  it('shows the summary, the level bar and who holds the units', async () => {
    await openAccessory('USB-C');
    const { container } = renderApp(<StockView />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'USB-C charger 65 W' }),
    ).toBeVisible();
    expect(screen.getByTestId('figure-available')).toHaveTextContent('31');
    const meter = screen.getByRole('meter', {
      name: /Stock level of USB-C charger 65 W: 31 of 42/,
    });
    expect(meter).toHaveAttribute('aria-valuenow', '31');
    const holders = await screen.findByRole('table', { name: 'People and places holding this' });
    // two open hand-outs: 8 out, and 4 out of which 1 is back
    expect(within(holders).getAllByRole('row')).toHaveLength(3);
    expect(within(holders).getAllByRole('button', { name: /^Return units from/ })).toHaveLength(2);
    await expectNoA11yViolations(container);
  });

  it('takes part of a hand-out back and leaves the rest out', async () => {
    const user = userEvent.setup();
    const charger = await openAccessory('USB-C');
    renderApp(<StockView />);
    const holders = await screen.findByRole('table', { name: 'People and places holding this' });
    const [first] = within(holders).getAllByRole('button', { name: /^Return units from/ });
    await user.click(first!);
    const dialog = await screen.findByRole('dialog', { name: /^Return units of USB-C charger/ });
    const quantity = within(dialog).getByRole('spinbutton', { name: /^Units coming back/ });
    await user.clear(quantity);
    await user.type(quantity, '99');
    await user.click(within(dialog).getByRole('button', { name: 'Return' }));
    expect(await within(dialog).findByText(/Enter a whole number from 1 to/)).toBeVisible();
    await user.clear(quantity);
    await user.type(quantity, '2');
    await expectNoA11yViolations(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Return' }));
    expect(await screen.findByText('2 returned. 1 still out.')).toBeVisible();
    await waitFor(async () =>
      expect((await accessoriesApi.get(charger.id)).value.qty_available).toBe(33),
    );
    await waitFor(() => expect(screen.getByTestId('figure-available')).toHaveTextContent('33'));
  });

  it('changes the minimum stock', async () => {
    const user = userEvent.setup();
    const hdmi = await openAccessory('HDMI');
    renderApp(<StockView />);
    await user.click(await screen.findByRole('button', { name: 'Change minimum' }));
    const dialog = await screen.findByRole('dialog', { name: 'Minimum stock for HDMI cable 2 m' });
    const field = within(dialog).getByRole('spinbutton', { name: /^Minimum stock/ });
    expect(field).toHaveValue(5);
    await user.clear(field);
    await user.type(field, '2');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Minimum stock is now 2.')).toBeVisible();
    await waitFor(() => expect(screen.getByTestId('figure-minimum')).toHaveTextContent('2'));
    expect((await accessoriesApi.get(hdmi.id)).value.min_qty).toBe(2);
    // 3 available is above a minimum of 2: no longer "low"
    expect(screen.getByText('In stock')).toBeVisible();
  });

  it('archives an accessory that nobody holds and refuses one that is in use', async () => {
    const user = userEvent.setup();
    await openAccessory('HDMI');
    renderApp(<StockView />);
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive "HDMI cable 2 m"?' });
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/in use/);
  });

  it('says so when the item does not exist', async () => {
    window.history.pushState(
      {},
      '',
      '/stock/view?kind=accessory&id=0190a6b2-00a1-7000-8000-999999999999',
    );
    renderApp(<StockView />);
    expect(await screen.findByTestId('stock-not-found')).toBeVisible();
  });
});

describe('StockView: consumable', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  async function openConsumable(name: string) {
    const item = await consumableNamed(name);
    window.history.pushState({}, '', `/stock/view?kind=consumable&id=${item.id}`);
    return item;
  }

  it('shows the stock history newest first and filters it by reason', async () => {
    const user = userEvent.setup();
    await openConsumable('Toner');
    const { container } = renderApp(<StockView />);
    expect(await screen.findByTestId('figure-on-hand')).toHaveTextContent('2 each');
    const ledger = await screen.findByRole('table', { name: 'Stock movements' });
    const rows = within(ledger).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[2]!.textContent)).toEqual([
      '-2',
      '-2',
      '+6',
    ]);
    expect(rows[0]).toHaveTextContent('Front office printer');
    await expectNoA11yViolations(container);

    await user.click(screen.getByRole('combobox', { name: 'Reason' }));
    await user.click(await screen.findByRole('option', { name: 'Received' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: 'Stock movements' })).getAllByRole('row'),
      ).toHaveLength(2),
    );
  });

  it('counts the shelf: shows the difference and records it as a count', async () => {
    const user = userEvent.setup();
    const paper = await openConsumable('paper');
    renderApp(<StockView />);
    await user.click(await screen.findByRole('button', { name: 'Save count' }));
    const dialog = await screen.findByRole('dialog', { name: 'Count Printer paper A4' });
    const field = within(dialog).getByRole('spinbutton', { name: /^Counted on hand/ });
    await user.type(field, '24');
    await user.click(within(dialog).getByRole('button', { name: 'Save count' }));
    expect(
      await within(dialog).findByText(/Nothing to record|matches what is on hand/),
    ).toBeVisible();
    await user.clear(field);
    await user.type(field, '20');
    expect(await within(dialog).findByTestId('count-delta')).toHaveTextContent('Change: -4');
    // the API wants the reason of a count: nothing is sent without one
    await user.click(within(dialog).getByRole('button', { name: 'Save count' }));
    expect(await within(dialog).findByText('Say why the stock differs.')).toBeVisible();
    expect((await consumablesApi.get(paper.id)).value.qty_on_hand).toBe(24);
    await user.type(within(dialog).getByRole('textbox', { name: /^Note/ }), 'Stock count');
    await user.click(within(dialog).getByRole('button', { name: 'Save count' }));
    expect(await screen.findByText('Count saved. 20 on hand.')).toBeVisible();
    const ledger = await screen.findByRole('table', { name: 'Stock movements' });
    await waitFor(() => expect(within(ledger).getAllByRole('row')[1]).toHaveTextContent('Counted'));
    expect((await consumablesApi.get(paper.id)).value.qty_on_hand).toBe(20);
  });
});
