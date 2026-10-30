// Spec 022 (research R3, tasks T003): `npm run e2e` refuses to start while any of the stack's
// ports answers, naming them and how to free them (FR-013). The connect is a fake here, so this
// runs in milliseconds and never touches the machine's real ports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E2E_PORTS, SIGNALS, busyPorts, listening, main, portsMessage } from '../e2e.mjs';

test('the runner checks every port the Compose stack publishes (R3)', () => {
  assert.deepEqual(E2E_PORTS, [5173, 5174, 5175, 3000, 8080, 9000, 5432]);
});

test('busyPorts returns exactly the ports whose connect succeeds, in the order given', async () => {
  const answering = new Set([3000, 5432]);
  const asked = [];
  const connect = async (port) => {
    asked.push(port);
    return answering.has(port);
  };
  assert.deepEqual(await busyPorts([5173, 3000, 8080, 5432], connect), [3000, 5432]);
  assert.deepEqual(asked.sort(), [3000, 5173, 5432, 8080]);
});

test('busyPorts returns an empty list when nothing answers', async () => {
  assert.deepEqual(await busyPorts([5173, 5174], async () => false), []);
});

test('portsMessage names each busy port and says how to free them (FR-013)', () => {
  const text = portsMessage([3000, 8080]);
  assert.match(text, /\b3000\b/);
  assert.match(text, /\b8080\b/);
  assert.match(text, /docker compose down/);
  assert.match(text, /docker compose -p <name> down/);
  assert.match(text, /nothing was started/i);
});

// Review round 1 (M1): a run killed before its clean-up leaves `qpe2e` holding the ports; the next
// run removes that leftover first, so the port check only sees someone else's stack.
test('the leftover qpe2e stack is removed before the ports are checked (M1, FR-013)', async () => {
  const calls = [];
  const errors = [];
  const code = await main([], {
    run: async (command, args) => {
      calls.push([command, ...args].join(' '));
      return 0;
    },
    busy: async () => {
      calls.push('port check');
      return [5432];
    },
    error: (text) => errors.push(text),
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, [
    'docker compose -p qpe2e -f docker-compose.yml -f e2e/stack/docker-compose.e2e.yml down -v --remove-orphans',
    'port check',
  ]);
  assert.match(errors.join('\n'), /5432/);
});

test('a hang-up is handled like Ctrl-C, so the stack is still removed (M1)', () => {
  assert.deepEqual([...SIGNALS].sort(), ['SIGHUP', 'SIGINT', 'SIGTERM']);
});

test('a port counts as in use when either 127.0.0.1 or ::1 answers (minor 6)', async () => {
  const only = (open) => async (port, host) => host === open;
  assert.equal(await listening(5432, only('127.0.0.1')), true);
  assert.equal(await listening(5432, only('::1')), true);
  assert.equal(await listening(5432, only('none')), false);
});
