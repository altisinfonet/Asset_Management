import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inbox } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '@/test/axe';
import { Badge, StatusBadge, STATE_TYPE_STYLE, type StateType } from './badge';
import { Banner } from './banner';
import { Button, IconButton } from './button';
import { Checkbox } from './checkbox';
import { CommandPalette, useCommandPaletteHotkey } from './command-palette';
import { BulkActionBar, DataTable, type DataTableColumn } from './data-table';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { EmptyState } from './empty-state';
import { Field } from './field';
import { Input } from './input';
import { Select } from './select';
import { Skeleton } from './skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { ToastProvider, useToast } from './toast';
import { Settings } from 'lucide-react';

describe('Button', () => {
  it('has an accessible name, ignores clicks while loading and keeps its label', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Check out</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Check out' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button loading onClick={onClick}>
        Check out
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Check out' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('icon buttons carry an aria-label', async () => {
    render(<IconButton icon={Settings} label="Settings" />);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});

describe('Field, Input, Select, Checkbox', () => {
  it('links label, hint and error to the control and marks it invalid', async () => {
    render(
      <Field label="Serial" required hint="From the sticker" error="Already in use">
        {(c) => <Input {...c} />}
      </Field>,
    );
    const input = screen.getByLabelText(/Serial/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toBeRequired();
    const described = input.getAttribute('aria-describedby') ?? '';
    expect(described.split(' ')).toHaveLength(2);
    expect(screen.getByText('Already in use').closest('p')?.id).toBe(described.split(' ')[0]);
    expect(screen.getByText('(required)')).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('select and checkbox render accessibly', async () => {
    const { container } = render(
      <div>
        <Select aria-label="Status" options={[{ value: 'a', label: 'A' }]} placeholder="Choose" />
        <Checkbox label="Remember me" />
        <Checkbox aria-label="Select row" />
        <Checkbox label="Mixed" checked="indeterminate" />
      </div>,
    );
    await expectNoA11yViolations(container);
    await userEvent.click(screen.getByLabelText('Remember me'));
    expect(screen.getByRole('checkbox', { name: 'Remember me' })).toBeChecked();
  });
});

describe('Select size and variant', () => {
  const OPTIONS = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];

  it('defaults to the 36px outline control', () => {
    render(<Select aria-label="Plain" options={OPTIONS} defaultValue="a" />);
    const trigger = screen.getByRole('combobox', { name: 'Plain' });
    expect(trigger.className).toContain('min-h-(--size-control)');
    expect(trigger.className).toContain('border-border-strong');
    expect(trigger.className).toContain('w-full');
  });

  it('sm + ghost is the dense borderless table control with a visible chevron', async () => {
    const { container } = render(
      <Select aria-label="Role" options={OPTIONS} defaultValue="a" size="sm" variant="ghost" />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Role' });
    expect(trigger.className).toContain('min-h-(--size-control-dense)');
    expect(trigger.className).toContain('in-data-[density=compact]:min-h-6');
    expect(trigger.className).toContain('border-transparent');
    expect(trigger.className).toContain('hover:border-border-strong');
    expect(trigger.className).not.toContain('w-full');
    expect(trigger.querySelector('svg')).toBeInTheDocument(); // chevron stays
    await expectNoA11yViolations(container);
  });

  it('a ghost select still opens from the keyboard and changes value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select
        aria-label="Role"
        options={OPTIONS}
        defaultValue="a"
        size="sm"
        variant="ghost"
        onValueChange={onValueChange}
      />,
    );
    screen.getByRole('combobox', { name: 'Role' }).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'Beta' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('a disabled ghost select has no hover affordance and does not open', async () => {
    const user = userEvent.setup();
    render(
      <Select aria-label="Role" options={OPTIONS} defaultValue="a" size="sm" variant="ghost" disabled />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Role' });
    expect(trigger).toBeDisabled();
    expect(trigger.className).toContain('disabled:hover:bg-transparent');
    await user.click(trigger);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
});

describe('Dialog', () => {
  function Example() {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Check out</DialogTitle>
            <DialogDescription>Pick an assignee.</DialogDescription>
          </DialogHeader>
          <Input aria-label="Assignee" />
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  it('moves focus in, traps Tab, closes on Esc and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Check out' });
    expect(dialog).toHaveAccessibleDescription('Pick an assignee.');
    expect(dialog.contains(document.activeElement)).toBe(true);

    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await expectNoA11yViolations(dialog);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('Drawer', () => {
  it('opens a labelled 480px drawer, closes on Esc and returns focus', async () => {
    const user = userEvent.setup();
    render(
      <Drawer>
        <DrawerTrigger asChild>
          <Button>Quick view</Button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>AT-00124</DrawerTitle>
            <DrawerDescription>Chromebook</DrawerDescription>
          </DrawerHeader>
        </DrawerContent>
      </Drawer>,
    );
    const trigger = screen.getByRole('button', { name: 'Quick view' });
    await user.click(trigger);
    const drawer = await screen.findByRole('dialog', { name: 'AT-00124' });
    expect(drawer.className).toContain('w-(--size-drawer)');
    await expectNoA11yViolations(drawer);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('Toast', () => {
  function Trigger() {
    const { toast, error } = useToast();
    return (
      <>
        <button onClick={() => toast({ title: 'Saved', variant: 'success' })}>ok</button>
        <button onClick={() => error('error.server', 'req-42')}>fail</button>
      </>
    );
  }

  it('announces toasts, shows the request id on errors and limits the stack to three', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByText('fail'));
    expect(await screen.findByText('Request ID req-42')).toBeInTheDocument();
    expect(screen.getByText(/went wrong on our side/)).toBeInTheDocument();

    for (let i = 0; i < 4; i++) await user.click(screen.getByText('ok'));
    expect(screen.getAllByText('Saved')).toHaveLength(3);
    expect(screen.queryByText('Request ID req-42')).not.toBeInTheDocument();
  });
});

describe('Badge and StatusBadge', () => {
  it('uses a fixed tone and icon per state type and always renders text', () => {
    const tones: Record<StateType, string> = {
      deployable: 'success',
      deployed: 'primary',
      pending: 'info',
      undeployable: 'warning',
      archived: 'neutral',
      lost: 'danger',
      overdue: 'danger',
      loaned: 'info',
    };
    for (const [type, tone] of Object.entries(tones)) {
      expect(STATE_TYPE_STYLE[type as StateType].tone).toBe(tone);
    }
    const { container } = render(
      <div>
        {Object.keys(tones).map((type) => (
          <StatusBadge key={type} type={type as StateType} />
        ))}
        <StatusBadge type="undeployable" label="Out for fix" />
        <StatusBadge type="lost" dot />
        <Badge>Neutral</Badge>
      </div>,
    );
    expect(screen.getByText('Out for fix')).toHaveClass('bg-warning-subtle');
    expect(screen.getByText('Ready')).toHaveClass('bg-success-subtle', 'text-success-text');
    expect(screen.getByText('Lost', { selector: '.sr-only' })).toBeInTheDocument();
    // every badge has an icon next to the text (colour is never the only signal)
    expect(screen.getByText('Ready').querySelector('svg')).not.toBeNull();
    return expectNoA11yViolations(container);
  });
});

interface Row {
  id: string;
  tag: string;
  name: string;
}
const ROWS: Row[] = [
  { id: '1', tag: 'AT-1', name: 'One' },
  { id: '2', tag: 'AT-2', name: 'Two' },
  { id: '3', tag: 'AT-3', name: 'Three' },
];
const COLUMNS: DataTableColumn<Row>[] = [
  { id: 'tag', header: 'Tag', cell: (r) => r.tag, sortable: true, sticky: true, mono: true },
  { id: 'name', header: 'Name', cell: (r) => r.name },
];

describe('DataTable', () => {
  it('renders sticky header, 36px comfortable and 28px compact rows', () => {
    const { rerender, container } = render(
      <DataTable label="Assets" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} />,
    );
    expect(container.querySelector('thead th')?.className).toContain('sticky');
    expect(container.querySelector('tbody tr')?.className).toContain('h-9');
    rerender(
      <DataTable
        label="Assets"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(r) => r.id}
        density="compact"
      />,
    );
    expect(container.querySelector('tbody tr')?.className).toContain('h-7');
  });

  it('sorts with aria-sort, selects with Space, opens with Enter and navigates with arrows', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    function Example() {
      const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
      const [sort, setSort] = useState<{ columnId: string; direction: 'asc' | 'desc' } | null>(
        null,
      );
      return (
        <>
          <DataTable
            label="Assets"
            columns={COLUMNS}
            rows={ROWS}
            getRowId={(r) => r.id}
            getRowLabel={(r) => r.tag}
            selectable
            selectedIds={selected}
            onSelectedIdsChange={setSelected}
            onRowOpen={onOpen}
            sort={sort}
            onSortChange={setSort}
          />
          <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())} />
        </>
      );
    }
    render(<Example />);

    const tagHeader = screen.getByRole('columnheader', { name: /Tag/ });
    expect(tagHeader).toHaveAttribute('aria-sort', 'none');
    await user.click(within(tagHeader).getByRole('button'));
    expect(tagHeader).toHaveAttribute('aria-sort', 'ascending');
    await user.click(within(tagHeader).getByRole('button'));
    expect(tagHeader).toHaveAttribute('aria-sort', 'descending');

    const rows = screen.getAllByRole('row').slice(1);
    rows[0]?.focus();
    await user.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    await user.keyboard(' ');
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('1 row selected')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith(ROWS[1]);

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    expect(screen.getByText('3 rows selected')).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('shows skeleton rows with aria-busy while loading and the empty state when empty', async () => {
    const { rerender } = render(
      <DataTable label="Assets" columns={COLUMNS} rows={[]} getRowId={(r) => r.id} loading />,
    );
    expect(screen.getByRole('region', { name: 'Assets' })).toHaveAttribute('aria-busy', 'true');
    rerender(
      <DataTable
        label="Assets"
        columns={COLUMNS}
        rows={[]}
        getRowId={(r) => r.id}
        empty={<EmptyState title="No assets yet" icon={Inbox} />}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No assets yet' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});

describe('Tabs and DropdownMenu', () => {
  it('Tabs switch with arrow keys', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Overview</TabsTrigger>
          <TabsTrigger value="b" count={14}>
            History
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a">First</TabsContent>
        <TabsContent value="b">Second</TabsContent>
      </Tabs>,
    );
    await expectNoA11yViolations(container);
    screen.getByRole('tab', { name: 'Overview' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /History/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Second')).toBeVisible();
  });

  it('DropdownMenu opens from the keyboard and runs an item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Edit</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    screen.getByRole('button', { name: 'Actions' }).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('CommandPalette', () => {
  function Example({ onSelect }: { onSelect: () => void }) {
    const [open, setOpen] = useState(false);
    useCommandPaletteHotkey(() => setOpen((o) => !o));
    return (
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        groups={[
          {
            id: 'go',
            heading: 'Go to',
            items: [
              { id: 'assets', label: 'Assets', onSelect },
              { id: 'settings', label: 'Settings', onSelect: () => {} },
            ],
          },
        ]}
      />
    );
  }

  it('opens with Ctrl+K, filters, runs the highlighted command with Enter and closes with Esc', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Example onSelect={onSelect} />);
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    await user.type(within(dialog).getByRole('combobox'), 'ass');
    expect(within(dialog).queryByText('Settings')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('EmptyState, Skeleton, Banner', () => {
  it('render without accessibility violations', async () => {
    const { container } = render(
      <div>
        <EmptyState
          icon={Inbox}
          title="No assets yet"
          description="Add one."
          actions={<Button>New asset</Button>}
        />
        <Skeleton className="h-4 w-10" />
        <Banner tone="danger" title="Could not load">
          Try again.
        </Banner>
        <Banner tone="info">Dry run</Banner>
      </div>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load');
    expect(
      container.querySelector(
        '[aria-hidden="true"].animate-\\[at-pulse_1\\.6s_ease-in-out_infinite\\]',
      ),
    ).not.toBeNull();
    await expectNoA11yViolations(container);
  });
});
