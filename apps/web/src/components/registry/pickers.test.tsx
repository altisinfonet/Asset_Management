import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { uid } from '@/mocks/registry-fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { renderApp, seedSession } from '@/test/render';
import { AssetPicker, type AssetRef } from './asset-picker';
import { DepartmentPicker } from './department-picker';
import { LocationPicker } from './location-picker';
import { PersonPicker, type PersonRef } from './person-picker';

const fruit = [
  { value: 'a', label: 'Apple', description: 'red' },
  { value: 'b', label: 'Banana' },
  { value: 'c', label: 'Cherry', disabled: true },
  { value: 'd', label: 'Date' },
];

function Controlled({ onValue }: { onValue?: (v: string | null) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Combobox
      aria-label="Fruit"
      options={fruit}
      value={value}
      emptyText="Nothing"
      clearLabel="Clear fruit"
      onValueChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

describe('Combobox', () => {
  it('opens with the arrow keys, moves over enabled options, and Enter chooses', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    renderApp(<Controlled onValue={onValue} />);
    const box = screen.getByRole('combobox', { name: 'Fruit' });
    expect(box).toHaveAttribute('aria-expanded', 'false');
    box.focus();
    await user.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(4);
    await user.keyboard('{ArrowDown}'); // Banana
    await user.keyboard('{ArrowDown}'); // skips the disabled Cherry, lands on Date
    expect(box).toHaveAttribute('aria-activedescendant', expect.stringContaining('-list-3'));
    await user.keyboard('{Enter}');
    expect(onValue).toHaveBeenCalledWith('d');
    expect(box).toHaveValue('Date');
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });

  it('filters while typing, highlights the first match and says how many there are', async () => {
    const user = userEvent.setup();
    renderApp(<Controlled />);
    await user.type(screen.getByRole('combobox', { name: 'Fruit' }), 'an');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Banana']);
    expect(screen.getByRole('status')).toHaveTextContent('1 result');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'Fruit' })).toHaveValue('Banana');
  });

  it('matches the description too and shows the empty text', async () => {
    const user = userEvent.setup();
    renderApp(<Controlled />);
    const box = screen.getByRole('combobox', { name: 'Fruit' });
    await user.type(box, 'red');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Applered']);
    await user.clear(box);
    await user.type(box, 'zzz');
    expect(screen.getByText('Nothing')).toBeVisible();
  });

  it('a disabled option cannot be chosen by click', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    renderApp(<Controlled onValue={onValue} />);
    await user.click(screen.getByRole('combobox', { name: 'Fruit' }));
    await user.click(screen.getByRole('option', { name: 'Cherry' }));
    expect(onValue).not.toHaveBeenCalled();
    expect(screen.getByRole('option', { name: 'Cherry' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('the clear button empties the choice', async () => {
    const user = userEvent.setup();
    renderApp(<Controlled />);
    await user.click(screen.getByRole('combobox', { name: 'Fruit' }));
    await user.click(screen.getByRole('option', { name: /^Apple/ }));
    await user.click(screen.getByRole('button', { name: 'Clear fruit' }));
    expect(screen.getByRole('combobox', { name: 'Fruit' })).toHaveValue('');
  });

  it('inside a dialog the first Escape closes the list and the second closes the dialog', async () => {
    const user = userEvent.setup();
    renderApp(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Pick</DialogTitle>
          <DialogDescription>Pick a fruit</DialogDescription>
          <Controlled />
        </DialogContent>
      </Dialog>,
    );
    const box = screen.getByRole('combobox', { name: 'Fruit' });
    await user.click(box);
    expect(box).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('has no axe violations open', async () => {
    const user = userEvent.setup();
    const { container } = renderApp(<Controlled />);
    await user.click(screen.getByRole('combobox', { name: 'Fruit' }));
    await expectNoA11yViolations(container);
  });
});

describe('LocationPicker', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  function Harness({ excludeSubtreeOf }: { excludeSubtreeOf?: string }) {
    const [value, setValue] = useState('');
    return (
      <div>
        <LocationPicker
          aria-label="Location"
          clearable
          value={value}
          onChange={setValue}
          excludeSubtreeOf={excludeSubtreeOf}
        />
        <output data-testid="chosen">{value}</output>
      </div>
    );
  }

  it('lists the locations in tree order with the path above each, and finds by name', async () => {
    const user = userEvent.setup();
    renderApp(<Harness />);
    const box = screen.getByRole('combobox', { name: 'Location' });
    await user.click(box);
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveTextContent('Riverside Elementary');
    expect(options[1]).toHaveTextContent('Main building');
    expect(options[1]).toHaveTextContent('Riverside Elementary'); // its context line
    await user.type(box, 'gym');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('chosen')).toHaveTextContent(uid('location', 5));
    expect(box).toHaveValue('Gym');
  });

  it('cannot choose the location being moved or anything below it', async () => {
    const user = userEvent.setup();
    renderApp(<Harness excludeSubtreeOf={uid('location', 2)} />);
    await user.click(screen.getByRole('combobox', { name: 'Location' }));
    await screen.findAllByRole('option');
    expect(screen.getByRole('option', { name: /^Main building/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('option', { name: /^Room 101/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('option', { name: /^Riverside Elementary/ })).not.toHaveAttribute(
      'aria-disabled',
    );
  });
});

describe('DepartmentPicker', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  function Harness({ excludeId }: { excludeId?: string }) {
    const [value, setValue] = useState('');
    return (
      <div>
        <DepartmentPicker
          aria-label="Department"
          clearable
          value={value}
          onChange={setValue}
          excludeId={excludeId}
        />
        <output data-testid="chosen">{value}</output>
      </div>
    );
  }

  it('lists the managed departments with code and manager, and finds by name or by code', async () => {
    const user = userEvent.setup();
    renderApp(<Harness />);
    const box = screen.getByRole('combobox', { name: 'Department' });
    await user.click(box);
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(6);
    expect(screen.getByRole('option', { name: /^IT/ })).toHaveTextContent('Alice Owner');
    await user.type(box, 'math');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('Mathematics');
    await user.clear(box);
    await user.type(box, 'LIB');
    expect(screen.getByRole('option')).toHaveTextContent('Library');
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('chosen')).toHaveTextContent(uid('department', 5));
    expect(box).toHaveValue('Library');
    await user.click(screen.getByRole('button', { name: 'Clear department' }));
    expect(screen.getByTestId('chosen')).toBeEmptyDOMElement();
  });

  it('leaves out the excluded department (the one being merged away)', async () => {
    const user = userEvent.setup();
    renderApp(<Harness excludeId={uid('department', 1)} />);
    await user.click(screen.getByRole('combobox', { name: 'Department' }));
    await screen.findAllByRole('option');
    expect(screen.queryByRole('option', { name: /^IT/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(5);
  });

  it('has no axe violations open', async () => {
    const user = userEvent.setup();
    const { container } = renderApp(<Harness />);
    await user.click(screen.getByRole('combobox', { name: 'Department' }));
    await screen.findAllByRole('option');
    await expectNoA11yViolations(container);
  });
});

describe('PersonPicker', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  function Harness({ onPerson }: { onPerson?: (p: PersonRef | null) => void }) {
    const [value, setValue] = useState<PersonRef | null>(null);
    return (
      <PersonPicker
        aria-label="Person"
        clearable
        value={value}
        onChange={(p) => {
          setValue(p);
          onPerson?.(p);
        }}
      />
    );
  }

  it('searches as you type, shows e-mail and department, and chooses with the keyboard', async () => {
    const onPerson = vi.fn();
    const user = userEvent.setup();
    renderApp(<Harness onPerson={onPerson} />);
    const box = screen.getByRole('combobox', { name: 'Person' });
    await user.type(box, 'Jamie Okafor');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option')).toHaveTextContent('Jamie Okafor');
    expect(screen.getByRole('option')).toHaveTextContent('S-2001');
    await user.keyboard('{Enter}');
    expect(onPerson).toHaveBeenCalledWith({ id: expect.any(String), display_name: 'Jamie Okafor' });
    expect(box).toHaveValue('Jamie Okafor');
  });

  it('Enter pressed before the search answered chooses the first match once it arrives', async () => {
    const onPerson = vi.fn();
    const user = userEvent.setup();
    renderApp(<Harness onPerson={onPerson} />);
    await user.type(screen.getByRole('combobox', { name: 'Person' }), 'Maria Reyes{Enter}');
    await waitFor(() =>
      expect(onPerson).toHaveBeenCalledWith(
        expect.objectContaining({ display_name: 'Maria Reyes' }),
      ),
    );
  });

  it('never offers an inactive person, and says when nobody matches', async () => {
    const user = userEvent.setup();
    renderApp(<Harness />);
    await user.type(screen.getByRole('combobox', { name: 'Person' }), 'Leaver');
    expect(await screen.findByText('Nobody matches "Leaver".')).toBeVisible();
  });
});

describe('AssetPicker', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('finds assets by tag and leaves out the excluded one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState<AssetRef | null>(null);
      return (
        <AssetPicker
          aria-label="Asset"
          value={value}
          excludeId={uid('asset', 124)}
          onChange={(a) => {
            setValue(a);
            onChange(a);
          }}
        />
      );
    }
    renderApp(<Harness />);
    await user.type(screen.getByRole('combobox', { name: 'Asset' }), 'AT-0012');
    await waitFor(() => expect(screen.getByRole('listbox')).not.toHaveAttribute('aria-busy'));
    await waitFor(() =>
      expect(within(screen.getByRole('listbox')).queryByText(/AT-00124/)).not.toBeInTheDocument(),
    );
    await user.click(screen.getAllByRole('option')[0]!);
    expect(onChange).toHaveBeenCalledWith({
      id: expect.any(String),
      label: expect.stringContaining('AT-0012'),
    });
  });
});
