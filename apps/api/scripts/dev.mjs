// Dev runner: tsc in watch mode plus `node --watch` on the compiled output (cross-platform).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tscBin = require.resolve('typescript/bin/tsc');

const tsc = spawn(
  process.execPath,
  [tscBin, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'],
  { stdio: 'inherit' },
);

let server;
const waitForBuild = setInterval(() => {
  if (!existsSync('dist/main.js')) return;
  clearInterval(waitForBuild);
  server = spawn(
    process.execPath,
    ['--watch-path=dist', '--watch-preserve-output', 'dist/main.js', process.argv[2] ?? 'api'],
    { stdio: 'inherit' },
  );
}, 500);

const stop = () => {
  clearInterval(waitForBuild);
  tsc.kill();
  server?.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
tsc.on('exit', (code) => {
  server?.kill();
  process.exit(code ?? 0);
});
