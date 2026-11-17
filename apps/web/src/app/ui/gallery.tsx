'use client';

import { Download, Inbox, Plus, Settings, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/app-shell/theme-toggle';
import { Badge, StatusBadge, type StateType } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button, IconButton } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CommandPalette } from '@/components/ui/command-palette';
import {
  BulkActionBar,
  DataTable,
  type DataTableColumn,
  type SortState,
} from '@/components/ui/data-table';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Select } from '@/components/ui/select';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { SAMPLE_ASSETS, type SampleAsset } from '@/lib/sample-assets';

const STATE_TYPES: StateType[] = [
  'deployable',
  'deployed',
  'pending',
  'undeployable',
  'archived',
  'lost',
  'overdue',
  'loaned',
];

const COLUMNS: DataTableColumn<SampleAsset>[] = [
  { id: 'tag', header: 'Tag', mono: true, sticky: true, sortable: true, cell: (r) => r.tag },
  { id: 'name', header: 'Name', sortable: true, cell: (r) => r.name },
  { id: 'model', header: 'Model', cell: (r) => r.model },
  {
    id: 'status',
    header: 'Status',
    cell: (r) => <StatusBadge type={r.state} label={r.statusLabel} />,
  },
  { id: 'location', header: 'Location', cell: (r) => r.location },
];

export function Gallery() {
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">UI gallery</h1>
          <p className="text-base text-muted">
            Every base component in light and dark. Overlays (dialogs, menus, toasts) follow the
            page theme: use the theme menu to switch.
          </p>
        </div>
        <ThemeToggle />
      </header>
      <div className="grid gap-6 p-6 xl:grid-cols-2">
        <ThemePanel theme="light" />
        <ThemePanel theme="dark" />
      </div>
    </div>
  );
}

function ThemePanel({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <section
      data-theme={theme}
      aria-label={`${theme} theme`}
      className="flex min-w-0 flex-col gap-8 rounded-xl border border-border bg-bg p-6 text-text"
    >
      <h2 className="text-2xl font-semibold capitalize">{theme}</h2>
      <Swatches />
      <Buttons />
      <Forms />
      <Badges />
      <Table />
      <TabsAndMenus />
      <Overlays />
      <Feedback />
    </section>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-lg font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Swatches() {
  const names = [
    'bg',
    'surface',
    'sunken',
    'border',
    'border-strong',
    'primary',
    'success',
    'warning',
    'danger',
    'info',
  ];
  return (
    <Block title="Colour roles">
      <div className="flex flex-wrap gap-2">
        {names.map((name) => (
          <div key={name} className="flex flex-col items-center gap-1 text-xs text-muted">
            <span
              className="size-10 rounded-md border border-border"
              style={{ background: `var(--color-${name})` }}
            />
            {name}
          </div>
        ))}
      </div>
      <p className="font-tag text-base">AT-00124 · SN 5CG1234XYZ · 0O 1lI (mono)</p>
      <p className="text-sm text-muted">Muted helper text, 13px. Inter, tabular: 1,234.56</p>
    </Block>
  );
}

function Buttons() {
  const [loading, setLoading] = useState(false);
  return (
    <Block title="Buttons">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">
          <Trash2 aria-hidden className="size-4" />
          Delete
        </Button>
        <Button variant="link">Link</Button>
        <Button variant="primary" disabled>
          Disabled
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm">Small (28px)</Button>
        <Button size="sm" variant="primary">
          <Plus aria-hidden className="size-4" />
          New
        </Button>
        <Button
          variant="primary"
          loading={loading}
          onClick={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 1500);
          }}
        >
          {loading ? 'Checking out...' : 'Check out'}
        </Button>
        <IconButton icon={Settings} label="Settings" />
        <IconButton icon={Download} label="Download" variant="secondary" />
      </div>
    </Block>
  );
}

function Forms() {
  const [sel, setSel] = useState('ready');
  const [checked, setChecked] = useState<boolean | 'indeterminate'>('indeterminate');
  return (
    <Block title="Form controls">
      <div className="grid max-w-md gap-4">
        <Field label="Name" required hint="Shown in lists and on labels.">
          {(c) => <Input placeholder="Chromebook 3100" {...c} />}
        </Field>
        <Field label="Serial number" error="This serial number is already in use.">
          {(c) => <Input defaultValue="5CG1234XYZ" className="font-tag" {...c} />}
        </Field>
        <Field label="Read only">{(c) => <Input readOnly defaultValue="AT-00124" {...c} />}</Field>
        <Field label="Disabled">{(c) => <Input disabled defaultValue="Locked" {...c} />}</Field>
        <Field label="Status">
          {(c) => (
            <Select
              {...c}
              value={sel}
              onValueChange={setSel}
              placeholder="Choose a status"
              options={[
                { value: 'ready', label: 'Ready' },
                { value: 'assigned', label: 'Assigned' },
                { value: 'repair', label: 'In repair' },
                { value: 'lost', label: 'Lost', disabled: true },
              ]}
            />
          )}
        </Field>
        <Field label="Notes">{(c) => <Textarea {...c} />}</Field>
        <div className="flex flex-wrap gap-4">
          <Checkbox label="Unchecked" />
          <Checkbox label="Checked" defaultChecked />
          <Checkbox label="Mixed" checked={checked} onCheckedChange={setChecked} />
          <Checkbox label="Disabled" disabled />
        </div>
      </div>
    </Block>
  );
}

function Badges() {
  return (
    <Block title="Badges and status (fixed colour per state type)">
      <div className="flex flex-wrap gap-2">
        {STATE_TYPES.map((type) => (
          <StatusBadge key={type} type={type} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {STATE_TYPES.map((type) => (
          <StatusBadge key={type} type={type} dot />
        ))}
        <Badge>Neutral</Badge>
        <Badge tone="primary">Primary</Badge>
        <Badge tone="info">Info</Badge>
      </div>
    </Block>
  );
}

function Table() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set([SAMPLE_ASSETS[1]?.id ?? '']),
  );
  const [sort, setSort] = useState<SortState | null>({ columnId: 'tag', direction: 'asc' });
  return (
    <Block title="Data table (36px rows, sticky header, selection, sort)">
      <DataTable
        label="Assets (gallery)"
        columns={COLUMNS}
        rows={SAMPLE_ASSETS}
        getRowId={(r) => r.id}
        getRowLabel={(r) => r.tag}
        selectable
        selectedIds={selected}
        onSelectedIdsChange={setSelected}
        sort={sort}
        onSortChange={setSort}
        onRowClick={() => {}}
        maxHeight="260px"
      />
      <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button size="sm">Check out</Button>
        <Button size="sm">Change status</Button>
      </BulkActionBar>
      <p className="text-sm text-muted">Compact (28px rows), loading and empty:</p>
      <DataTable
        label="Compact assets (gallery)"
        columns={COLUMNS}
        rows={SAMPLE_ASSETS.slice(0, 3)}
        getRowId={(r) => r.id}
        density="compact"
      />
      <DataTable
        label="Loading assets (gallery)"
        columns={COLUMNS}
        rows={[]}
        getRowId={(r) => r.id}
        loading
        skeletonRows={3}
      />
      <DataTable
        label="Empty assets (gallery)"
        columns={COLUMNS}
        rows={[]}
        getRowId={(r) => r.id}
        empty={
          <EmptyState
            icon={Inbox}
            title="No assets match these filters"
            description="Clear the filters or search all fields."
            actions={<Button>Clear filters</Button>}
          />
        }
      />
    </Block>
  );
}

function TabsAndMenus() {
  return (
    <Block title="Tabs and menus">
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history" count={14}>
            History
          </TabsTrigger>
          <TabsTrigger value="repairs" count={1}>
            Repairs
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <p className="text-base text-muted">Overview content. Arrow keys switch tabs.</p>
        </TabsContent>
        <TabsContent value="history">
          <p className="text-base text-muted">14 history events.</p>
        </TabsContent>
        <TabsContent value="repairs">
          <p className="text-base text-muted">One open repair.</p>
        </TabsContent>
      </Tabs>
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>Actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Asset</DropdownMenuLabel>
            <DropdownMenuItem>
              Edit <DropdownMenuShortcut>E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              Clone <DropdownMenuShortcut>C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Dispose (managers only)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip content="Tooltip text">
          <Button variant="ghost">Hover or focus me</Button>
        </Tooltip>
        <span className="flex items-center gap-1 text-sm text-muted">
          Palette: <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>
        </span>
      </div>
    </Block>
  );
}

function Overlays() {
  const [palette, setPalette] = useState(false);
  return (
    <Block title="Dialog, drawer, command palette">
      <div className="flex flex-wrap gap-2">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Check out AT-00124</DialogTitle>
              <DialogDescription>
                Focus is trapped here, Esc closes, and focus returns to the trigger.
              </DialogDescription>
            </DialogHeader>
            <Field label="Assignee" required>
              {(c) => <Input {...c} />}
            </Field>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button variant="primary">Check out</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Drawer>
          <DrawerTrigger asChild>
            <Button>Open drawer (480px)</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle className="font-tag">AT-00124</DrawerTitle>
              <DrawerDescription>Chromebook 3100</DrawerDescription>
            </DrawerHeader>
            <DrawerBody>
              <SkeletonText lines={4} />
            </DrawerBody>
            <DrawerFooter>
              <Button variant="primary">Open full page</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
        <Button onClick={() => setPalette(true)}>Open command palette</Button>
      </div>
      <CommandPalette
        open={palette}
        onOpenChange={setPalette}
        groups={[
          {
            id: 'go',
            heading: 'Go to',
            items: [
              { id: 'a', label: 'Assets', shortcut: 'G A', onSelect: () => {} },
              { id: 's', label: 'Settings', onSelect: () => {} },
            ],
          },
          {
            id: 'act',
            heading: 'Actions',
            items: [{ id: 'n', label: 'New asset', shortcut: 'C', onSelect: () => {} }],
          },
        ]}
      />
    </Block>
  );
}

function Feedback() {
  const { toast, error } = useToast();
  return (
    <Block title="Toast, banner, empty state, skeleton">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => toast({ variant: 'success', title: 'Asset saved' })}>
          Success toast
        </Button>
        <Button
          onClick={() =>
            toast({
              title: 'Asset archived',
              description: 'AT-00124 moved to archived.',
              action: { label: 'Undo', onClick: () => {} },
            })
          }
        >
          Toast with undo
        </Button>
        <Button onClick={() => error('error.stale', '0190a6b2-7c3e-7a10-9d2f')}>Error toast</Button>
      </div>
      <div className="flex flex-col gap-2">
        <Banner tone="info" title="Preview, nothing saved yet">
          Dry-run results for the CSV import.
        </Banner>
        <Banner tone="success">Import finished.</Banner>
        <Banner
          tone="warning"
          title="License band 85% used"
          action={<Button size="sm">Review</Button>}
        >
          Upgrade before you reach the limit.
        </Banner>
        <Banner
          tone="danger"
          title="Could not load assets"
          action={<Button size="sm">Try again</Button>}
        >
          The server could not be reached.
        </Banner>
      </div>
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState
          icon={Inbox}
          title="No assets yet"
          description="Add your first asset or import a CSV file to get started."
          actions={
            <>
              <Button variant="primary">New asset</Button>
              <Button>Import CSV</Button>
            </>
          }
        />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <SkeletonText lines={2} className="flex-1" />
      </div>
    </Block>
  );
}
