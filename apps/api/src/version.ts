import { readFileSync } from 'node:fs';
import type { VersionResponse } from '@assettracker/schemas';
import type { AppConfig } from './config/env.js';

/** apps/api/package.json resolves identically from src/ and dist/ (both one level below it). */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
};

export function getVersionInfo(config: AppConfig): VersionResponse {
  return {
    name: pkg.name,
    version: config.APP_VERSION ?? pkg.version,
    commit: config.GIT_SHA,
    role: config.APP_ROLE,
  };
}
