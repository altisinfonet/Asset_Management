import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentAuth, RequirePermission, type AuthContext } from '../auth/index.js';
import { IdempotencyRequired, ZodValidationPipe } from '../platform/index.js';
import { LoansService } from './loans.service.js';
import {
  loanExtendSchema,
  loanListSchema,
  loanReturnSchema,
  overdueListSchema,
  uuidParam,
  type LoanExtendBody,
  type LoanListQuery,
  type LoanReturnBody,
  type OverdueListQuery,
} from './schemas.js';

const idParam = () => new ZodValidationPipe(uuidParam, 'params');

/** `/v1/loans` and `/v1/loaners/dashboard` (tag Loaners): lists, quick return, extension, dashboard. */
@Controller()
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Get('loans')
  @RequirePermission('loaner:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(loanListSchema, 'query')) query: LoanListQuery,
  ) {
    return this.loans.list(auth, query);
  }

  // `loans/overdue` and `loans/return` are declared before `loans/:id`
  @Get('loans/overdue')
  @RequirePermission('loaner:read')
  overdue(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(overdueListSchema, 'query')) query: OverdueListQuery,
  ) {
    return this.loans.overdue(auth, query);
  }

  @Post('loans/return')
  @RequirePermission('loaner:checkout')
  @IdempotencyRequired()
  @HttpCode(200)
  returnLoans(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(loanReturnSchema)) body: LoanReturnBody,
  ) {
    return this.loans.returnLoans(auth, body);
  }

  @Get('loans/:id')
  @RequirePermission('loaner:read')
  get(@CurrentAuth() auth: AuthContext, @Param('id', idParam()) id: string) {
    return this.loans.get(auth, id);
  }

  @Post('loans/:id/extend')
  @RequirePermission('loaner:checkout')
  @HttpCode(200)
  extend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idParam()) id: string,
    @Body(new ZodValidationPipe(loanExtendSchema)) body: LoanExtendBody,
  ) {
    return this.loans.extend(auth, id, body);
  }

  @Get('loaners/dashboard')
  @RequirePermission('loaner:read')
  dashboard(@CurrentAuth() auth: AuthContext) {
    return this.loans.dashboard(auth);
  }
}
