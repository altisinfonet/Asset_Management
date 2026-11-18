import type { SecretBox } from '../ports/index.js';
import { EnvelopeSecretBox } from './secret-box.js';
import { createKeyProvider } from './secrets.js';

/**
 * The real {@link SecretBox} for code that runs OUTSIDE the Nest container (the `migrate` role's
 * demo seed, the CLI). Same key configuration as `PortsModule` (MASTER_KEY / MASTER_KEY_FILE), so
 * what these processes encrypt is readable by the api. `onEphemeral` is called when no master key
 * is configured (a throwaway key is used: values cannot be read by any other process).
 */
export function createStandaloneSecretBox(
  config: Parameters<typeof createKeyProvider>[0],
  onEphemeral?: (message: string) => void,
): SecretBox {
  const { provider, ephemeral } = createKeyProvider(config);
  if (ephemeral) {
    onEphemeral?.(
      'no MASTER_KEY / MASTER_KEY_FILE configured: encrypting with a throwaway key; other processes cannot read these secrets',
    );
  }
  return new EnvelopeSecretBox(provider);
}
