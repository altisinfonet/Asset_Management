-- 0080_accessories_consumables [M2-ACC-01..03; ED-11, ADR 0008]: quantity-tracked accessories (checked
-- out and returned through app.assignment, partial returns per ED-11), consumables with an
-- append-only stock ledger, the minimum-stock bookkeeping, and the two things migration 0041 left to
-- the integrator for accessories: the assignment -> accessory foreign key and the stock trigger.
-- Source of truth for the shapes: docs/engineering/schema.sql (B8, B9, B14). The M2 wave-2 accessories
-- agent owns 0080-0089. The loaner foreign key (app.assignment.loaner_pool_id) is NOT added here.

-- -----------------------------------------------------------------------------
-- Accessories: a stock of N interchangeable units (chargers, cables, headsets). Units are handed out
-- as assignments with a quantity; "available" = qty_total - units still outstanding on open
-- assignments, derived on read (never stored), so it cannot drift.
-- -----------------------------------------------------------------------------

create table app.accessory (
  id                  uuid primary key,
  tenant_id           uuid not null references app.tenant (id),
  company_id          uuid not null,
  category_id         uuid not null,
  category_kind       text not null default 'accessory' check (category_kind = 'accessory'),
  manufacturer_id     uuid,
  vendor_id           uuid,
  location_id         uuid,
  name                text not null check (length(btrim(name)) between 1 and 200),
  model_number        text,
  qty_total           integer not null default 0 check (qty_total >= 0),
  min_qty             integer not null default 0 check (min_qty >= 0),
  purchase_date       date,
  purchase_cost_minor bigint check (purchase_cost_minor is null or purchase_cost_minor >= 0),
  currency            text check (currency is null or currency ~ '^[A-Z]{3}$'),
  notes               text,
  -- Opaque QR payload (same shape as app.asset.label_code): scan resolve answers accessories too.
  label_code          text not null default replace(gen_random_uuid()::text, '-', ''),
  -- Low-stock bookkeeping (M2-ACC-03): true while the item is at or below its minimum and the
  -- `accessory.low_stock` event for that crossing has been emitted; cleared when it is restocked
  -- above the minimum (re-arm). Maintained by the application in the same transaction as the change.
  low_stock_alerted   boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  archived_at         timestamptz,
  version             integer not null default 1,
  -- stored lower-case key for the list search (ADR 0005: no index-backed ILIKE under RLS)
  search_text         text generated always as (lower(name || chr(31) || coalesce(model_number, ''))) stored,
  unique (tenant_id, id),
  unique (tenant_id, label_code),
  foreign key (tenant_id, company_id)  references app.company (tenant_id, id),
  foreign key (tenant_id, category_id, category_kind) references app.category (tenant_id, id, kind),
  foreign key (tenant_id, manufacturer_id) references app.manufacturer (tenant_id, id),
  foreign key (tenant_id, vendor_id)   references app.vendor (tenant_id, id),
  foreign key (tenant_id, location_id) references app.location (tenant_id, id),
  check (purchase_cost_minor is null or currency is not null)
);
create index accessory_category_idx on app.accessory (tenant_id, category_id);
create index accessory_location_idx on app.accessory (tenant_id, location_id) where location_id is not null;
create index accessory_name_idx on app.accessory (tenant_id, name, id);
select app.apply_tenant_conventions('app.accessory');
create trigger trg_company_accessory before insert on app.accessory
  for each row execute function app.fill_default_company();

-- -----------------------------------------------------------------------------
-- Consumables: stock that is used up. qty_on_hand is a running balance maintained ONLY by the ledger
-- trigger below (a direct change is refused), so it always equals the sum of the movements.
-- -----------------------------------------------------------------------------

create table app.consumable (
  id                  uuid primary key,
  tenant_id           uuid not null references app.tenant (id),
  company_id          uuid not null,
  category_id         uuid not null,
  category_kind       text not null default 'consumable' check (category_kind = 'consumable'),
  manufacturer_id     uuid,
  vendor_id           uuid,
  location_id         uuid,
  name                text not null check (length(btrim(name)) between 1 and 200),
  model_number        text,
  unit                text not null default 'each' check (length(btrim(unit)) between 1 and 50),
  qty_on_hand         integer not null default 0 check (qty_on_hand >= 0),   -- maintained by stock_movement trigger
  min_qty             integer not null default 0 check (min_qty >= 0),
  unit_cost_minor     bigint check (unit_cost_minor is null or unit_cost_minor >= 0),
  currency            text check (currency is null or currency ~ '^[A-Z]{3}$'),
  notes               text,
  label_code          text not null default replace(gen_random_uuid()::text, '-', ''),
  low_stock_alerted   boolean not null default false,                         -- see app.accessory
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  archived_at         timestamptz,
  version             integer not null default 1,
  search_text         text generated always as (lower(name || chr(31) || coalesce(model_number, ''))) stored,
  unique (tenant_id, id),
  unique (tenant_id, label_code),
  foreign key (tenant_id, company_id)  references app.company (tenant_id, id),
  foreign key (tenant_id, category_id, category_kind) references app.category (tenant_id, id, kind),
  foreign key (tenant_id, manufacturer_id) references app.manufacturer (tenant_id, id),
  foreign key (tenant_id, vendor_id)   references app.vendor (tenant_id, id),
  foreign key (tenant_id, location_id) references app.location (tenant_id, id),
  check (unit_cost_minor is null or currency is not null)
);
create index consumable_category_idx on app.consumable (tenant_id, category_id);
create index consumable_location_idx on app.consumable (tenant_id, location_id) where location_id is not null;
create index consumable_name_idx on app.consumable (tenant_id, name, id);
select app.apply_tenant_conventions('app.consumable');
create trigger trg_company_consumable before insert on app.consumable
  for each row execute function app.fill_default_company();

-- -----------------------------------------------------------------------------
-- The stock ledger. Append-only (SELECT/INSERT only for app_user). The BEFORE INSERT trigger applies
-- the delta to consumable.qty_on_hand (row lock: concurrent movements of one consumable are
-- serialised; the non-negative CHECK on qty_on_hand rejects an overdraw with 23514) and records the
-- balance after the movement.
-- -----------------------------------------------------------------------------

create table app.stock_movement (
  id            uuid primary key,
  tenant_id     uuid not null references app.tenant (id),
  consumable_id uuid not null,
  qty_delta     integer not null check (qty_delta <> 0),
  reason        text not null check (reason in ('receive','issue','return','adjust','correction')),
  person_id     uuid,                                       -- who it was issued to / returned by
  note          text,
  balance_after integer,
  by_user_id    uuid,
  at            timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, consumable_id) references app.consumable (tenant_id, id),
  foreign key (tenant_id, person_id)     references app.person (tenant_id, id),
  -- the sign says which way the stock moved; an adjustment or correction can go either way ...
  constraint stock_movement_sign check (
    (reason in ('receive','return') and qty_delta > 0)
    or (reason = 'issue' and qty_delta < 0)
    or reason in ('adjust','correction')),
  -- ... but must say why (the reason of the adjustment)
  constraint stock_movement_adjust_note check (
    reason not in ('adjust','correction') or length(btrim(coalesce(note, ''))) > 0)
);
create index stock_movement_consumable_idx on app.stock_movement (tenant_id, consumable_id, at desc, id desc);
create index stock_movement_person_idx on app.stock_movement (tenant_id, person_id, at desc, id desc)
  where person_id is not null;
select app.apply_tenant_conventions('app.stock_movement', 'select, insert');

create function app.stock_movement_apply() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  update app.consumable c
     set qty_on_hand = c.qty_on_hand + new.qty_delta     -- CHECK (qty_on_hand >= 0) rejects overdraw
   where c.tenant_id = new.tenant_id and c.id = new.consumable_id
  returning c.qty_on_hand into new.balance_after;
  if not found then
    raise exception 'consumable % not found', new.consumable_id using errcode = 'foreign_key_violation';
  end if;
  -- The timestamp is taken AFTER the row lock was won, so the order of `at` is the order in which the
  -- balances were computed (now() would be the start of the transaction, which can precede a
  -- concurrent movement that committed first).
  new.at := clock_timestamp();
  return new;
end
$$;
create trigger stock_movement_apply before insert on app.stock_movement
  for each row execute function app.stock_movement_apply();

-- qty_on_hand is the ledger's balance: a new consumable starts at 0 (an opening quantity is a
-- `receive` movement) and the balance changes only from inside the ledger trigger (trigger depth 2:
-- the movement insert is depth 1, its UPDATE of the consumable runs this trigger at depth 2).
create function app.consumable_guard_qty() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'INSERT' then
    if new.qty_on_hand <> 0 then
      raise exception 'a consumable starts with qty_on_hand = 0; record the opening stock as a receive movement'
        using errcode = 'check_violation';
    end if;
  elsif new.qty_on_hand is distinct from old.qty_on_hand and pg_trigger_depth() < 2 then
    raise exception 'qty_on_hand changes only through stock movements' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger consumable_a_guard_qty_ins before insert on app.consumable
  for each row execute function app.consumable_guard_qty();
create trigger consumable_a_guard_qty_upd before update of qty_on_hand on app.consumable
  for each row execute function app.consumable_guard_qty();

-- -----------------------------------------------------------------------------
-- Accessory custody (the two things migration 0041 left open)
-- -----------------------------------------------------------------------------

alter table app.assignment
  add constraint assignment_accessory_fk
  foreign key (tenant_id, accessory_id) references app.accessory (tenant_id, id);

-- Refuse a check-out that would exceed qty_total. Serialises on the accessory row, so concurrent
-- check-outs can never hand out more than exist; counts only the units still outstanding
-- (quantity - quantity_returned, ED-11).
create function app.assignment_check_accessory_stock() returns trigger
language plpgsql set search_path = pg_catalog as $$
declare
  v_total integer;
  v_out   integer;
begin
  select a.qty_total into v_total
    from app.accessory a
   where a.tenant_id = new.tenant_id and a.id = new.accessory_id
     for update;                                           -- serialises concurrent check-outs
  select coalesce(sum(s.quantity - s.quantity_returned), 0) into v_out
    from app.assignment s
   where s.tenant_id = new.tenant_id and s.accessory_id = new.accessory_id and s.checked_in_at is null;
  if v_out + new.quantity > v_total then
    raise exception 'insufficient accessory stock: % available, % requested', v_total - v_out, new.quantity
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger assignment_accessory_stock before insert on app.assignment
  for each row when (new.accessory_id is not null and new.checked_in_at is null)
  execute function app.assignment_check_accessory_stock();

-- The total can never drop below the units that are out (the row is locked by this UPDATE, so a
-- concurrent check-out waits and then sees the new total).
create function app.accessory_guard_total() returns trigger
language plpgsql set search_path = pg_catalog as $$
declare
  v_out integer;
begin
  select coalesce(sum(s.quantity - s.quantity_returned), 0) into v_out
    from app.assignment s
   where s.tenant_id = new.tenant_id and s.accessory_id = new.id and s.checked_in_at is null;
  if new.qty_total < v_out then
    raise exception 'insufficient accessory stock: % units are checked out, the total cannot be %', v_out, new.qty_total
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger accessory_guard_total before update of qty_total on app.accessory
  for each row when (new.qty_total < old.qty_total)
  execute function app.accessory_guard_total();

-- -----------------------------------------------------------------------------
-- Views (security_invoker: the caller's RLS applies)
-- -----------------------------------------------------------------------------

create view app.v_accessory_availability with (security_invoker = true) as
select a.tenant_id,
       a.id as accessory_id,
       a.qty_total,
       coalesce(sum(s.quantity - s.quantity_returned), 0)::integer as qty_checked_out,
       (a.qty_total - coalesce(sum(s.quantity - s.quantity_returned), 0))::integer as qty_available,
       a.min_qty
  from app.accessory a
  left join app.assignment s
         on s.tenant_id = a.tenant_id and s.accessory_id = a.id and s.checked_in_at is null
 where a.archived_at is null
 group by a.tenant_id, a.id, a.qty_total, a.min_qty;

create view app.v_low_stock with (security_invoker = true) as
select c.tenant_id, 'consumable'::text as item_type, c.id as item_id, c.name, c.qty_on_hand as qty_available, c.min_qty
  from app.consumable c
 where c.archived_at is null and c.min_qty > 0 and c.qty_on_hand <= c.min_qty
union all
select v.tenant_id, 'accessory'::text, v.accessory_id, a.name, v.qty_available, v.min_qty
  from app.v_accessory_availability v
  join app.accessory a on a.tenant_id = v.tenant_id and a.id = v.accessory_id
 where v.min_qty > 0 and v.qty_available <= v.min_qty;

grant select on app.v_accessory_availability, app.v_low_stock to app_user;
