import type { FieldError } from '../platform/index.js';
import { invalidRef } from '../registry/index.js';
import type { Tx } from '../tenancy/index.js';

export interface StockRefs {
  category_id?: string | undefined;
  manufacturer_id?: string | null | undefined;
  vendor_id?: string | null | undefined;
  location_id?: string | null | undefined;
  company_id?: string | undefined;
}

/**
 * Validates the references of an accessory / consumable body against the caller's tenant (RLS makes
 * another tenant's id simply not exist). Only the references that are given (and changed) are
 * looked up; problems are collected as 422 field errors with the JSON pointer of the field.
 */
export async function checkStockRefs(
  trx: Tx,
  kind: 'accessory' | 'consumable',
  refs: StockRefs,
  errors: FieldError[],
): Promise<void> {
  if (refs.category_id) {
    const category = await trx.category.findUnique({ where: { id: refs.category_id } });
    if (!category || category.archived_at) {
      errors.push(invalidRef('/category_id', 'No such category.'));
    } else if (category.kind !== kind) {
      errors.push({
        pointer: '/category_id',
        message: `must be a category of kind "${kind}"`,
        code: 'wrong-kind',
      });
    }
  }
  if (refs.manufacturer_id) {
    const row = await trx.manufacturer.findUnique({ where: { id: refs.manufacturer_id } });
    if (!row || row.archived_at)
      errors.push(invalidRef('/manufacturer_id', 'No such manufacturer.'));
  }
  if (refs.vendor_id) {
    const row = await trx.vendor.findUnique({ where: { id: refs.vendor_id } });
    if (!row || row.archived_at) errors.push(invalidRef('/vendor_id', 'No such vendor.'));
  }
  if (refs.location_id) {
    const row = await trx.location.findUnique({ where: { id: refs.location_id } });
    if (!row || row.archived_at) errors.push(invalidRef('/location_id', 'No such location.'));
  }
  if (refs.company_id) {
    const row = await trx.company.findUnique({ where: { id: refs.company_id } });
    if (!row) errors.push(invalidRef('/company_id', 'No such company.'));
  }
}

/** The explicit company, else the tenant's default one. */
export async function resolveCompany(
  trx: Tx,
  companyId: string | undefined,
): Promise<string | null> {
  if (companyId) return companyId;
  const company = await trx.company.findFirst({ where: { is_default: true } });
  return company?.id ?? null;
}
