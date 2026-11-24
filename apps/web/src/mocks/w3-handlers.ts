import type { HttpHandler } from 'msw';
import { importHandlers } from './w3-import-handlers';
import { loanerHandlers } from './w3-loaner-handlers';

/**
 * Mock handlers of M2 wave 3: loaner pools, the quick loan, overdue loans, activity and the loan
 * defaults, and the import jobs with their analysis, dry run and commit. State lives in `w3-state.ts`.
 */
export const w3Handlers: HttpHandler[] = [...loanerHandlers, ...importHandlers];
