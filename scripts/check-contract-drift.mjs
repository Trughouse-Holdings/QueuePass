// Fails when packages/shared/src/api-schema.ts no longer matches contracts/openapi.yaml, so the
// front ends' types cannot drift from the contract (research R8).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const committed = 'packages/shared/src/api-schema.ts';
const dir = mkdtempSync(join(tmpdir(), 'qp-contract-'));
const fresh = join(dir, 'api-schema.ts');

try {
  execFileSync('npx', ['openapi-typescript', 'contracts/openapi.yaml', '-o', fresh], {
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: process.platform === 'win32',
  });
  if (readFileSync(fresh, 'utf8') !== readFileSync(committed, 'utf8')) {
    console.error(`${committed} is out of date: run npm run generate:api`);
    process.exit(1);
  }
  console.log('[contract-drift] api-schema.ts matches contracts/openapi.yaml');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
