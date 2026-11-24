import type { components } from '@assettracker/api-client';
import type {
  MockAssignment,
  MockAsset,
  MockAttachment,
  MockPerson,
  MockStatus,
  MockUserRecord,
} from './registry-fixtures';
import { uid } from './registry-fixtures';

/**
 * Seed of the M2 wave 1 mock data: people (with and without a login), custody (open and closed
 * assignments of the seeded assets), the matching history events with actors, and a few
 * attachments in every scan state. Deterministic (no randomness), so tests can name records.
 */
type S = components['schemas'];

const NOW = Date.UTC(2026, 10, 17, 9, 0, 0);
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const dateOnly = (ms: number) => iso(ms).slice(0, 10);

const FIRST = [
  'Jamie',
  'Chidi',
  'Maria',
  'Tomas',
  'Aisha',
  'Liam',
  'Sofia',
  'Noah',
  'Mei',
  'Omar',
  'Elena',
  'Ravi',
  'Grace',
  'Hugo',
  'Ines',
  'Kofi',
  'Lena',
  'Mateo',
  'Nadia',
  'Oscar',
];
const LAST = [
  'Okafor',
  'Reyes',
  'Lindqvist',
  'Haddad',
  'Tanaka',
  'Novak',
  'Mbeki',
  'Silva',
  'Kowalski',
  'Dubois',
  'Petrov',
  'Alvarez',
  'Chen',
  'Rossi',
  'Nguyen',
  'Brown',
  'Singh',
  'Murphy',
  'Sato',
  'Weber',
];
/** The demo departments (the same six as the API seed, apps/api/src/seed): id n is `uid('department', n)`. */
export const DEPARTMENT_SEED: Array<{ name: string; code: string; description: string }> = [
  { name: 'IT', code: 'IT', description: 'Devices, network and support.' },
  { name: 'Science', code: 'SCI', description: 'Laboratories and science teaching.' },
  { name: 'Mathematics', code: 'MATH', description: 'Mathematics teaching.' },
  { name: 'Administration', code: 'ADM', description: 'Office, finance and sales.' },
  { name: 'Library', code: 'LIB', description: 'Reading room and loan desk.' },
  { name: 'Facilities', code: 'FAC', description: 'Buildings, storage and equipment.' },
];
const departmentId = (name: string): string | null => {
  const index = DEPARTMENT_SEED.findIndex((d) => d.name === name);
  return index < 0 ? null : uid('department', index + 1);
};

/** People who also have a login: user id, name, e-mail. The first rows of the People list. */
const LOGIN_PEOPLE: Array<[string, string, string]> = [
  ['0190a6b2-0000-7000-8000-000000000001', 'Alice Owner', 'alice@example.org'],
  ['0190a6b2-0000-7000-8000-000000000007', 'Sam Lee', 'sam.lee@example.org'],
  ['0190a6b2-0000-7000-8000-000000000008', 'Priya Patel', 'priya.patel@example.org'],
  ['0190a6b2-0000-7000-8000-000000000003', 'Vera Viewer', 'vera@example.org'],
];

export interface CustodySeed {
  people: MockPerson[];
  assignments: MockAssignment[];
  attachments: MockAttachment[];
  history: S['HistoryEvent'][];
}

export function seedCustody(input: {
  assets: MockAsset[];
  statusLabels: MockStatus[];
  users: MockUserRecord[];
  locationIds: string[];
  assetHistoryStart: number;
}): CustodySeed {
  const stamp = { created_at: iso(NOW - 300 * DAY), updated_at: iso(NOW - 20 * DAY) };
  const companyId = '0190a6b2-0000-7000-8000-0000000000c0';

  // ---- people ---------------------------------------------------------------------------------
  const people: MockPerson[] = [];
  let n = 0;
  const add = (
    extra: Partial<S['Person']> & { display_name: string; _system?: boolean },
  ): MockPerson => {
    n += 1;
    const person: MockPerson = {
      id: uid('person', n),
      ...stamp,
      archived_at: null,
      kind: 'employee',
      first_name: null,
      last_name: null,
      email: null,
      phone: null,
      employee_ref: null,
      department: null,
      department_id: null,
      job_title: null,
      location_id: null,
      company_id: companyId,
      status: 'active',
      notes: null,
      user_id: null,
      _v: 1,
      ...extra,
    };
    people.push(person);
    return person;
  };

  for (const [userId, name, email] of LOGIN_PEOPLE) {
    const [first, ...rest] = name.split(' ');
    add({
      display_name: name,
      first_name: first ?? null,
      last_name: rest.join(' ') || null,
      email,
      employee_ref: `E-${1000 + n}`,
      department_id: departmentId(n === 0 ? 'Administration' : n === 3 ? 'Library' : 'IT'),
      job_title: n === 2 ? 'Technician' : null,
      user_id: userId,
      _system: true,
    } as Partial<S['Person']> & { display_name: string });
  }
  add({
    display_name: 'Jamie Okafor',
    first_name: 'Jamie',
    last_name: 'Okafor',
    kind: 'student',
    employee_ref: 'S-2001',
    department_id: departmentId('Science'),
    location_id: input.locationIds[0] ?? null,
  });
  add({
    display_name: 'Maria Reyes',
    first_name: 'Maria',
    last_name: 'Reyes',
    email: 'maria.reyes@school.example',
    employee_ref: 'E-1010',
    department_id: departmentId('Mathematics'),
    job_title: 'Class teacher',
  });
  for (let i = 0; i < 28; i += 1) {
    const student = i < 20;
    const first = FIRST[(i + 2) % FIRST.length]!;
    const last = LAST[(i * 7 + 3) % LAST.length]!;
    add({
      display_name: `${first} ${last}`,
      first_name: first,
      last_name: last,
      kind: student ? 'student' : i < 25 ? 'employee' : i < 27 ? 'contractor' : 'external',
      email: student ? null : `${first}.${last}@school.example`.toLowerCase(),
      employee_ref: i === 27 ? null : `${student ? 'S' : 'E'}-${(student ? 2100 : 1100) + i}`,
      department_id: uid('department', (i % DEPARTMENT_SEED.length) + 1),
      location_id: input.locationIds[i % input.locationIds.length] ?? null,
    });
  }
  add({
    display_name: 'Olivia Leaver',
    first_name: 'Olivia',
    last_name: 'Leaver',
    email: 'olivia.leaver@school.example',
    employee_ref: 'E-0999',
    status: 'inactive',
    department_id: departmentId('Mathematics'),
  });

  // ---- custody -----------------------------------------------------------------------------------
  const deployed = input.statusLabels.find((s) => s.state_type === 'deployed');
  const holders = people.filter((p) => p.status === 'active' && !p.user_id);
  const actor = LOGIN_PEOPLE[1]!; // Sam Lee checks assets out and in
  const assignments: MockAssignment[] = [];
  const history: S['HistoryEvent'][] = [];
  let a = 0;
  let h = input.assetHistoryStart;

  const event = (
    asset: MockAsset,
    at: string,
    type: S['HistoryEvent']['event_type'],
    summary: string,
    assignmentId: string,
    payload: Record<string, unknown>,
  ) => {
    h += 1;
    history.push({
      id: uid('history', h),
      asset_id: asset.id,
      at,
      event_type: type,
      actor_type: 'user',
      actor_id: actor[0],
      assignment_id: assignmentId,
      transfer_id: null,
      summary,
      payload,
    });
  };
  const statusName = (stateType: MockStatus['state_type']) =>
    input.statusLabels.find((s) => s.state_type === stateType)?.name ?? '';
  /** Payload keys every custody event carries (`HistoryEvent.payload` of the contract). */
  const custodyPayload = (assignment: MockAssignment, holder: MockPerson) => ({
    assignment_id: assignment.id,
    target_type: 'person',
    target_id: holder.id,
    target_name: holder.display_name,
  });

  let k = 0;
  for (const asset of input.assets) {
    if (asset.archived_at || !deployed || asset.status_id !== deployed.id) continue;
    const holder = holders[k % holders.length]!;
    a += 1;
    const out = NOW - (3 + (k % 40)) * DAY;
    const due =
      k % 5 === 0 ? '2026-11-02' : k % 5 === 1 ? null : dateOnly(NOW + (5 + (k % 20)) * DAY);
    const assignment: MockAssignment = {
      id: uid('assignment', a),
      asset_id: asset.id,
      accessory_id: null,
      person_id: holder.id,
      location_id: null,
      target_asset_id: null,
      quantity: 1,
      quantity_returned: 0,
      loaner_pool_id: null,
      checked_out_at: iso(out),
      checked_out_by: actor[0],
      expected_return: due,
      checked_in_at: null,
      checked_in_by: null,
      checkin_location_id: null,
      acceptance_state: 'not_required',
      note: null,
      checkin_note: null,
      checkin_condition: null,
      attachment_ids: [],
      checkin_attachment_ids: [],
      _v: 1,
    };
    assignments.push(assignment);
    asset.current_assignment = {
      assignment_id: assignment.id,
      target_type: 'person',
      target_id: holder.id,
      target_name: holder.display_name,
      checked_out_at: assignment.checked_out_at,
      expected_return: due,
      loaner_pool_id: null,
    };
    event(
      asset,
      assignment.checked_out_at,
      'checked_out',
      `Checked out to ${holder.display_name}`,
      assignment.id,
      {
        ...custodyPayload(assignment, holder),
        expected_return: due,
        status: { from: statusName('deployable'), to: statusName('deployed') },
      },
    );
    k += 1;
  }

  // Past custody of the first ready assets: out and back, with a note on the way in.
  const ready = input.statusLabels.find((s) => s.state_type === 'deployable');
  let closed = 0;
  const photos: MockAttachment[] = [];
  for (const asset of input.assets) {
    if (closed >= 12) break;
    if (asset.archived_at || !ready || asset.status_id !== ready.id || asset.current_assignment) {
      continue;
    }
    const holder = holders[(closed * 3 + 1) % holders.length]!;
    a += 1;
    const out = NOW - (70 + closed * 3) * DAY;
    const back = out + 25 * DAY;
    const condition = (['fair', 'good', null] as const)[closed % 3] ?? null;
    const note = closed % 3 === 0 ? 'Cracked bezel' : null;
    const assignment: MockAssignment = {
      id: uid('assignment', a),
      asset_id: asset.id,
      accessory_id: null,
      person_id: holder.id,
      location_id: null,
      target_asset_id: null,
      quantity: 1,
      quantity_returned: 1,
      loaner_pool_id: null,
      checked_out_at: iso(out),
      checked_out_by: actor[0],
      expected_return: dateOnly(out + 30 * DAY),
      checked_in_at: iso(back),
      checked_in_by: actor[0],
      checkin_location_id: asset.location_id,
      acceptance_state: 'not_required',
      note: null,
      checkin_note: note,
      checkin_condition: condition,
      attachment_ids: [],
      checkin_attachment_ids: [],
      _v: 1,
    };
    // The first return came with a photo of the damage (listed under the assignment).
    if (closed === 0) {
      const photoId = uid('attachment', 100);
      assignment.checkin_attachment_ids = [photoId];
      photos.push({
        id: photoId,
        entity_type: 'assignment',
        entity_id: assignment.id,
        kind: 'photo',
        filename: 'bezel-damage.jpg',
        content_type: 'image/jpeg',
        size_bytes: 148_200,
        sha256: null,
        scan_status: 'clean',
        scan_detail: null,
        width: 1200,
        height: 900,
        uploaded_at: assignment.checked_in_at,
        created_at: assignment.checked_in_at!,
        archived_at: null,
        stored_bytes: 148_200,
        scan_due_at: null,
        scan_result: 'clean',
        _v: 1,
      } as MockAttachment);
    }
    assignments.push(assignment);
    event(
      asset,
      assignment.checked_out_at,
      'checked_out',
      `Checked out to ${holder.display_name}`,
      assignment.id,
      {
        ...custodyPayload(assignment, holder),
        expected_return: assignment.expected_return,
        status: { from: statusName('deployable'), to: statusName('deployed') },
      },
    );
    event(
      asset,
      assignment.checked_in_at!,
      'checked_in',
      `Checked in from ${holder.display_name}`,
      assignment.id,
      {
        ...custodyPayload(assignment, holder),
        status: { from: statusName('deployed'), to: statusName('deployable') },
        ...(condition ? { condition } : {}),
        ...(note ? { note } : {}),
        ...(assignment.checkin_attachment_ids!.length > 0
          ? { attachment_ids: assignment.checkin_attachment_ids }
          : {}),
      },
    );
    closed += 1;
  }

  // ---- attachments on AT-00124 ------------------------------------------------------------------------
  const target = input.assets.find((x) => x.asset_tag === 'AT-00124');
  const attachments: MockAttachment[] = [...photos];
  if (target) {
    const att = (
      n: number,
      filename: string,
      content_type: string,
      kind: S['Attachment']['kind'],
      scan_status: S['Attachment']['scan_status'],
      size_bytes: number,
    ) => {
      const attachment: MockAttachment = {
        id: uid('attachment', n),
        entity_type: 'asset',
        entity_id: target.id,
        kind,
        filename,
        content_type,
        size_bytes,
        sha256: null,
        scan_status,
        scan_detail: scan_status === 'infected' ? 'Eicar-Test-Signature' : null,
        width: content_type.startsWith('image/') ? 640 : null,
        height: content_type.startsWith('image/') ? 480 : null,
        uploaded_at: iso(NOW - n * DAY),
        created_at: iso(NOW - n * DAY),
        archived_at: null,
        stored_bytes: size_bytes,
        scan_due_at: null,
        scan_result: scan_status === 'infected' ? 'infected' : 'clean',
        _v: 1,
      } as MockAttachment;
      attachments.push(attachment);
    };
    att(1, 'purchase-order.pdf', 'application/pdf', 'document', 'clean', 184_320);
    att(2, 'front.png', 'image/png', 'photo', 'clean', 91_204);
    att(3, 'warranty-card.pdf', 'application/pdf', 'document', 'pending', 52_100);
    att(4, 'invoice-copy.pdf', 'application/pdf', 'document', 'infected', 12_880);
  }

  return { people, assignments, attachments, history };
}
