import { Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import type { Tx } from '../tenancy/index.js';

/** What a resolver answers for a code it recognises: the response body and the ETag version. */
export interface ScanResolution {
  data: Record<string, unknown>;
  version: number;
}

/**
 * A module that owns labelled records other than assets (accessories and consumables, M2-ACC) plugs
 * into `GET /v1/scan/resolve` through this extension point: the registry cannot import those
 * modules (dependencies point downward), so they register themselves when the application starts.
 * Resolvers run in the caller's tenant transaction, only after the asset lookups missed, and must
 * return `null` (never throw) for a code that is not theirs or that the caller may not see.
 */
export interface ScanResolver {
  resolve(auth: AuthContext, trx: Tx, codes: readonly string[]): Promise<ScanResolution | null>;
}

@Injectable()
export class ScanResolverRegistry {
  private readonly resolvers: ScanResolver[] = [];

  register(resolver: ScanResolver): void {
    if (!this.resolvers.includes(resolver)) this.resolvers.push(resolver);
  }

  /** The first resolver that recognises one of the codes, or null. */
  async resolve(
    auth: AuthContext,
    trx: Tx,
    codes: readonly string[],
  ): Promise<ScanResolution | null> {
    for (const resolver of this.resolvers) {
      const found = await resolver.resolve(auth, trx, codes);
      if (found) return found;
    }
    return null;
  }
}
