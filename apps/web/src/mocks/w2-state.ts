import type { components } from '@assettracker/api-client';
import type { JsonBodyType } from 'msw';
import { registry } from './registry-state';
import type { Rec } from './registry-fixtures';
import { onMockReset } from './state';

/**
 * State of the M2 wave 2 mock endpoints: accessories and consumables (with the stock ledger and the
 * accessory hand-outs), repairs, notifications and their preferences, saved views, exports and the
 * label templates. Held in memory and mirrored to `localStorage` on every change (like the registry),
 * so a full page load keeps what a user did. The first use seeds a small, deterministic data set.
 */
type S = components['schemas'];

export type MockAccessory = Rec<S['Accessory']>;
export type MockConsumable = Rec<S['Consumable']> & { qty_on_hand: number };
export type MockRepair = Rec<S['Repair']>;
export type MockStockMovement = S['StockMovement'];
/** A hand-out of accessory units (an `Assignment` with `accessory_id`). */
export type MockHandout = Rec<S['Assignment']>;
export type MockNotification = S['Notification'] & { user_id: string };
export type MockSavedView = S['SavedView'];
export type MockExport = S['ExportJob'] & {
  /** The CSV the download link serves, filled in when the job is ready. */
  csv?: string;
  /** Epoch ms at which the job finishes (the mock "worker"). */
  ready_at: number;
  fail?: boolean;
};

export interface W2Data {
  accessories: MockAccessory[];
  handouts: MockHandout[];
  consumables: MockConsumable[];
  movements: MockStockMovement[];
  repairs: MockRepair[];
  notifications: MockNotification[];
  /** `user id` -> `event type` -> delivery. */
  preferences: Record<string, Record<string, S['NotificationPreference']['delivery']>>;
  savedViews: MockSavedView[];
  exports: MockExport[];
  /** `Idempotency-Key` -> what the first request answered (for the stock-changing POSTs). */
  idempotency: Record<string, { signature: string; status: number; body: JsonBodyType }>;
}

const KEY = 'at-mock-w2';
const NOW = Date.UTC(2026, 10, 17, 9, 0, 0);
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const dateOnly = (ms: number) => iso(ms).slice(0, 10);

const KIND_CODE = {
  accessory: '00a1',
  consumable: '00a2',
  movement: '00a3',
  repair: '00a4',
  notification: '00a5',
  view: '00a6',
  export: '00a7',
  template: '00a8',
  handout: '00a9',
} as const;
export type W2Kind = keyof typeof KIND_CODE;

export function w2Id(kind: W2Kind, n: number): string {
  return `0190a6b2-${KIND_CODE[kind]}-7000-8000-${String(n).padStart(12, '0')}`;
}

let created = 0;
/** Ids of created records (kept apart from the seeded ranges; well-formed UUIDs). */
export function newW2Id(kind: W2Kind): string {
  created += 1;
  return w2Id(kind, 800_000_000_000 + (Date.now() % 100_000_000_000) + created);
}

// ---- the seed ----------------------------------------------------------------------------------

const OWNER_ID = '0190a6b2-0000-7000-8000-000000000001';
const MANAGER_ID = '0190a6b2-0000-7000-8000-000000000007';

/** Notifications every user starts with (the mock has one inbox shape for all). */
export function seedNotifications(userId: string): MockNotification[] {
  const base = (n: number, extra: Partial<MockNotification>): MockNotification => ({
    id: w2Id('notification', n + Number(userId.slice(-4)) * 100),
    user_id: userId,
    event_type: 'stock.low',
    title: '',
    body: null,
    entity_type: null,
    entity_id: null,
    read_at: null,
    created_at: iso(NOW - n * 3_600_000),
    ...extra,
  });
  return [
    base(1, {
      event_type: 'stock.low',
      title: 'Toner HP 26A is low on stock',
      body: '2 on hand; the minimum is 3.',
      entity_type: 'consumable',
      entity_id: w2Id('consumable', 2),
    }),
    base(5, {
      event_type: 'loan.overdue',
      title: 'A loan is overdue',
      body: 'AT-00031 was due 3 days ago.',
      entity_type: 'asset',
      entity_id: '0190a6b2-0008-7000-8000-000000000031',
    }),
    base(9, {
      event_type: 'import.completed',
      title: 'Import finished: 120 assets created',
      body: null,
    }),
    base(30, {
      event_type: 'attachment.infected',
      title: 'A file was rejected by the virus scan',
      body: 'receipt.pdf on a repair was blocked.',
      read_at: iso(NOW - 28 * 3_600_000),
    }),
    base(52, {
      event_type: 'label.batch.ready',
      title: 'Your label sheet is ready',
      read_at: iso(NOW - 50 * 3_600_000),
    }),
  ];
}

export const NOTIFICATION_EVENTS: Array<[string, S['NotificationPreference']['delivery']]> = [
  ['stock.low', 'immediate'],
  ['loan.overdue', 'immediate'],
  ['import.completed', 'immediate'],
  ['attachment.infected', 'immediate'],
  ['label.batch.ready', 'daily_digest'],
  ['export.ready', 'daily_digest'],
];

function buildSeed(): W2Data {
  const stamp = { created_at: iso(NOW - 120 * DAY), updated_at: iso(NOW - 10 * DAY) };
  const chargers = '0190a6b2-0001-7000-8000-000000000009';
  const supplies = '0190a6b2-0001-7000-8000-000000000010';
  const storage = '0190a6b2-0007-7000-8000-000000000007';
  const room101 = '0190a6b2-0007-7000-8000-000000000003';

  const accessory = (
    n: number,
    name: string,
    total: number,
    min: number,
    extra: Partial<MockAccessory> = {},
  ): MockAccessory => ({
    id: w2Id('accessory', n),
    ...stamp,
    archived_at: null,
    category_id: chargers,
    name,
    manufacturer_id: null,
    vendor_id: null,
    location_id: storage,
    model_number: null,
    qty_total: total,
    min_qty: min,
    purchase_date: dateOnly(NOW - 200 * DAY),
    purchase_cost: null,
    notes: null,
    qty_checked_out: 0,
    qty_available: total,
    _v: 1,
    ...extra,
  });
  const accessories: MockAccessory[] = [
    accessory(1, 'USB-C charger 65 W', 42, 10, { model_number: 'PA-65' }),
    accessory(2, 'HDMI cable 2 m', 20, 5),
    accessory(3, 'Laptop sleeve 14 in', 15, 0, { location_id: room101 }),
    accessory(4, 'Docking station', 6, 2),
  ];

  const handout = (
    n: number,
    accessoryNumber: number,
    quantity: number,
    returned: number,
    target: { person_id?: string; location_id?: string },
    extra: Partial<MockHandout> = {},
  ): MockHandout => ({
    id: w2Id('handout', n),
    asset_id: null,
    accessory_id: w2Id('accessory', accessoryNumber),
    person_id: null,
    location_id: null,
    target_asset_id: null,
    quantity,
    quantity_returned: returned,
    loaner_pool_id: null,
    checked_out_at: iso(NOW - (20 - n) * DAY),
    checked_out_by: OWNER_ID,
    expected_return: null,
    checked_in_at: returned >= quantity ? iso(NOW - 2 * DAY) : null,
    checked_in_by: returned >= quantity ? OWNER_ID : null,
    checkin_location_id: null,
    acceptance_state: 'not_required',
    note: null,
    checkin_note: null,
    checkin_condition: null,
    attachment_ids: [],
    checkin_attachment_ids: [],
    overdue: false,
    ...target,
    ...extra,
    _v: 1,
  });
  // person ids of the registry seed are generated by seedCustody; the first people are used by name at read time
  const people = registry().people;
  const person = (index: number) => people[index % Math.max(people.length, 1)]?.id ?? null;
  const handouts: MockHandout[] = [
    handout(1, 1, 8, 0, { person_id: person(0) ?? undefined }),
    handout(2, 1, 4, 1, { person_id: person(1) ?? undefined }),
    handout(3, 2, 12, 0, { location_id: room101 }),
    handout(4, 2, 5, 0, { person_id: person(2) ?? undefined }, { expected_return: dateOnly(NOW - 5 * DAY), overdue: true }),
    handout(5, 4, 6, 0, { person_id: person(3) ?? undefined }),
    handout(6, 3, 2, 2, { person_id: person(0) ?? undefined }),
  ];

  const consumable = (
    n: number,
    name: string,
    unit: string,
    min: number,
    onHand: number,
  ): MockConsumable => ({
    id: w2Id('consumable', n),
    ...stamp,
    archived_at: null,
    category_id: supplies,
    name,
    manufacturer_id: null,
    vendor_id: null,
    location_id: storage,
    model_number: null,
    unit,
    min_qty: min,
    unit_cost: null,
    notes: null,
    qty_on_hand: onHand,
    _v: 1,
  });
  const consumables: MockConsumable[] = [
    consumable(1, 'Printer paper A4', 'ream', 10, 24),
    consumable(2, 'Toner HP 26A', 'each', 3, 2),
    consumable(3, 'AA batteries', 'pack', 20, 0),
    consumable(4, 'Whiteboard markers', 'each', 0, 60),
  ];
  const movements: MockStockMovement[] = [];
  let movementN = 0;
  const move = (
    consumableNumber: number,
    delta: number,
    reason: S['StockMovement']['reason'],
    balance: number,
    daysAgo: number,
    note: string | null = null,
  ) => {
    movementN += 1;
    movements.push({
      id: w2Id('movement', movementN),
      consumable_id: w2Id('consumable', consumableNumber),
      qty_delta: delta,
      reason,
      person_id: null,
      note,
      balance_after: balance,
      by_user_id: OWNER_ID,
      at: iso(NOW - daysAgo * DAY),
    });
  };
  move(1, 40, 'receive', 40, 90, 'First delivery');
  move(1, -10, 'issue', 30, 40);
  move(1, -6, 'issue', 24, 12);
  move(2, 6, 'receive', 6, 80);
  move(2, -2, 'issue', 4, 30);
  move(2, -2, 'issue', 2, 1, 'Front office printer');
  move(3, 24, 'receive', 24, 100);
  move(3, -24, 'issue', 0, 7, 'Used for the science fair');
  move(4, 60, 'receive', 60, 60);

  return {
    accessories,
    handouts,
    consumables,
    movements,
    repairs: [],
    notifications: [],
    preferences: {},
    savedViews: [
      {
        id: w2Id('view', 1),
        entity: 'asset',
        name: 'Laptops',
        shared: true,
        owner_user_id: MANAGER_ID,
        owner_name: 'Sam Lee',
        definition: {
          filters: {
            q: '',
            status_id: '',
            category_id: '0190a6b2-0001-7000-8000-000000000002',
            location_id: '',
            include_sublocations: true,
            assigned: '',
            person_id: '',
            person_name: '',
            archived: 'exclude',
            cf: null,
          },
          columns: ['tag', 'name', 'status', 'location'],
          sort: null,
        },
        created_at: iso(NOW - 30 * DAY),
        updated_at: iso(NOW - 30 * DAY),
      },
    ],
    exports: [],
    idempotency: {},
  };
}

/**
 * Seeded repairs refer to registry assets (`Out for fix` ones are open repairs, a few ready laptops
 * have finished ones), so they are made from the registry the first time the repair data is read.
 */
function seedRepairs(data: W2Data): void {
  const assets = registry().assets.filter((a) => !a.archived_at);
  const statuses = registry().statusLabels;
  const outForFix = statuses.find((s) => s.name === 'Out for fix');
  const ready = statuses.find((s) => s.name === 'Ready');
  const inRepair = assets
    .filter((a) => a.status_id === outForFix?.id)
    .sort((a, b) => a.asset_tag.localeCompare(b.asset_tag))
    .slice(0, 3);
  const finished = assets
    .filter((a) => a.asset_tag.startsWith('LAP-') && a.status_id === ready?.id && !a.current_assignment)
    .sort((a, b) => a.asset_tag.localeCompare(b.asset_tag))
    .slice(0, 2);
  const vendors = registry().vendors;
  let n = 0;
  const base = (asset: { id: string }, extra: Partial<MockRepair>): MockRepair => {
    n += 1;
    return {
      id: w2Id('repair', n),
      created_at: iso(NOW - (30 - n * 3) * DAY),
      updated_at: iso(NOW - (30 - n * 3) * DAY),
      archived_at: null,
      asset_id: asset.id,
      kind: 'repair',
      title: '',
      description: null,
      reported_at: iso(NOW - (30 - n * 3) * DAY),
      started_at: null,
      vendor_id: vendors[n % vendors.length]?.id ?? null,
      performed_by_person_id: null,
      ticket_ref: null,
      cost: null,
      restore_status_id: ready?.id ?? null,
      status: 'open',
      completed_at: null,
      resolution_notes: null,
      _v: 1,
      ...extra,
    };
  };
  const titles = ['Cracked screen, replace', 'Battery swap', 'Keyboard not responding'];
  inRepair.forEach((asset, index) => {
    data.repairs.push(
      base(asset, {
        title: titles[index] ?? 'Repair',
        status: index === 1 ? 'in_progress' : 'open',
        started_at: index === 1 ? iso(NOW - 2 * DAY) : null,
        cost: { amount_minor: [6400, 2200, 0][index] ?? 0, currency: 'USD' },
      }),
    );
  });
  finished.forEach((asset, index) => {
    data.repairs.push(
      base(asset, {
        title: index === 0 ? 'Replace screen' : 'Hinge repair',
        status: 'completed',
        started_at: iso(NOW - 50 * DAY),
        completed_at: iso(NOW - (40 - index * 5) * DAY),
        resolution_notes: 'Fixed and tested.',
        cost: { amount_minor: index === 0 ? 6400 : 4500, currency: 'USD' },
      }),
    );
  });
}

// ---- storage -----------------------------------------------------------------------------------

let memory: W2Data | undefined;

export function w2(): W2Data {
  if (memory) return memory;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      memory = JSON.parse(raw) as W2Data;
      return memory;
    }
  } catch {
    // storage unavailable or corrupt: fall back to the seed
  }
  memory = buildSeed();
  seedRepairs(memory);
  persist();
  return memory;
}

function persist() {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(memory));
  } catch {
    // storage unavailable or full: memory only
  }
}

/** Apply `change` to the data and persist the result. */
export function mutateW2<T>(change: (data: W2Data) => T): T {
  const result = change(w2());
  persist();
  return result;
}

export function resetW2(): void {
  memory = undefined;
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // ignore
  }
}

onMockReset(resetW2);
