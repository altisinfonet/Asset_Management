import type { HttpHandler } from 'msw';
import { miscHandlers } from './w2-misc-handlers';
import { repairHandlers } from './w2-repair-handlers';
import { stockHandlers } from './w2-stock-handlers';

/**
 * Mock handlers of M2 wave 2: accessories and consumables, the repair log, label templates and
 * sheets, notifications, saved views and CSV exports. State lives in `w2-state.ts`.
 */
export const w2Handlers: HttpHandler[] = [...stockHandlers, ...repairHandlers, ...miscHandlers];
