import { Injectable, Logger } from '@nestjs/common';
import { currentRequestId } from '../context/request-context.js';
import { IdentityLookupService, type SecurityEventInput } from '../identity/index.js';
import type { ClientInfo } from './auth-context.js';

/**
 * Control-plane security log (`identity.security_event`): failed logins, throttling, invalid keys.
 * Writes are best effort: a failure to log must never turn a 401 into a 500 or reveal state.
 * Subjects are lower-cased emails or key prefixes, never secrets.
 */
@Injectable()
export class SecurityLogService {
  private readonly logger = new Logger(SecurityLogService.name);

  constructor(private readonly identity: IdentityLookupService) {}

  async record(
    event: Omit<SecurityEventInput, 'ip' | 'userAgent'> & { client?: ClientInfo | null },
  ): Promise<void> {
    const { client, ...rest } = event;
    try {
      await this.identity.recordSecurityEvent({
        ...rest,
        ...((rest.requestId ?? currentRequestId())
          ? { requestId: rest.requestId ?? currentRequestId()! }
          : {}),
        ...(client?.ip ? { ip: client.ip } : {}),
        ...(client?.userAgent ? { userAgent: client.userAgent } : {}),
      });
    } catch (err) {
      this.logger.warn(`could not write security event ${event.eventType}: ${String(err)}`);
    }
  }
}
