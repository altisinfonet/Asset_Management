// Copies the generated CSS next to the compiled JS so `@assettracker/ui-tokens/tokens.css` resolves.
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(path.join(root, 'dist'), { recursive: true });
for (const name of ['tokens.css', 'tailwind-theme.css']) {
  copyFileSync(path.join(root, 'src/generated', name), path.join(root, 'dist', name));
}
