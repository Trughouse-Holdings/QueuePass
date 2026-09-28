// Constitution I / spec 001 FR-033: no front end may contain database access code or a
// database driver. Fails naming the file and the match (research R12).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APPS = ['admin-app', 'customer-app', 'booth-app'];
const FORBIDDEN_DEPS = [
  '@prisma/client',
  'prisma',
  'pg',
  'postgres',
  'mysql2',
  'typeorm',
  'sequelize',
  'knex',
];
const FORBIDDEN_TEXT = ['DATABASE_URL', 'postgres://', 'postgresql://', '@prisma/client'];
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const failures = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else {
      const text = readFileSync(path, 'utf8');
      for (const needle of FORBIDDEN_TEXT) {
        if (text.includes(needle)) failures.push(`${path}: contains "${needle}"`);
      }
    }
  }
}

for (const app of APPS) {
  if (!existsSync(app)) continue;
  const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  for (const field of DEP_FIELDS) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (FORBIDDEN_DEPS.includes(dep))
        failures.push(`${app}/package.json: ${field} lists "${dep}"`);
    }
  }
  if (existsSync(join(app, 'src'))) walk(join(app, 'src'));
}

if (failures.length > 0) {
  console.error('[boundary] front ends must reach data only through the Backend API:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`[boundary] ${APPS.filter((a) => existsSync(a)).join(', ')}: no database access`);
