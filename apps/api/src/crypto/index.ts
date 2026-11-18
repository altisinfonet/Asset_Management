// Public facade of the crypto module (M1-PLAT-08). Domain code injects the SECRET_BOX port.
export {
  KmsKeyProvider,
  LocalKeyProvider,
  UnknownKeyIdError,
  type KeyProvider,
  type WrappedKey,
} from './key-provider.js';
export { SECRETBOX_FORMAT_VERSION, EnvelopeSecretBox, SecretBoxError } from './secret-box.js';
export {
  createKeyProvider,
  decodeMasterKey,
  generateMasterKey,
  readSecret,
  type KeyProviderBootstrap,
} from './secrets.js';
