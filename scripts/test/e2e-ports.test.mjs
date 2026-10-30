// Spec 022 (research R3, tasks T003): `npm run e2e` refuses to start while any of the stack's
// ports answers, naming them and how to free them (FR-013). The connect is a fake here, so this
// runs in milliseconds and never touches the machine's real ports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E2E_PORTS, busyPorts, portsMessage } from '../e2e.mjs';

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
