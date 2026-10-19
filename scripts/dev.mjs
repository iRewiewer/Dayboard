import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const children = [
  spawn(process.execPath, ['--watch', 'server/index.mjs'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { cwd: root, stdio: 'inherit' }),
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
for (const child of children) {
  child.on('error', (error) => { console.error(error); stop(1); });
  child.on('exit', (code) => stop(code ?? 0));
}
