import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';
import { CameraRefusedError, NoCameraError } from '../src/camera';

/**
 * Spec 017 US5 (FR-009; research R9): scanning with the camera and the decoder stubbed, so no
 * test needs a real camera.
 */

const stopTracks = vi.fn();
const openCamera = vi.fn();
vi.mock('../src/camera', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/camera')>();
  return {
    CameraRefusedError: real.CameraRefusedError,
    NoCameraError: real.NoCameraError,
    openCamera: (...args: unknown[]) => openCamera(...args),
  };
});

/** Values decodeFrame hands back, one per call; null past the end (no code in the frame). */
let decoded: (string | null)[] = [];
vi.mock('../src/decode', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/decode')>();
  return { ...real, decodeFrame: vi.fn(() => decoded.shift() ?? null) };
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const hour = 3_600_000;
const iso = (inHours: number): string => new Date(Date.now() + inHours * hour).toISOString();
const EVENT_ID = '7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40';
const CODE = '7KQ2M9XWAB4C';

function stubApi(extra: Record<string, Response> = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const req = input instanceof Request ? input : new Request(input);
      const url = new URL(req.url);
      const body = req.method === 'GET' ? null : JSON.parse((await req.clone().text()) || 'null');
      calls.push({ method: req.method, path: url.pathname, body });
      const routes: Record<string, Response> = {
        'GET /events': json([
          {
            id: EVENT_ID,
            name: 'Demo Tonight',
            startsAt: iso(1),
            endsAt: iso(4),
            status: 'SCHEDULED',
            cancelledAt: null,
          },
        ]),
        [`POST /events/${EVENT_ID}/entry/lookup`]: json({
          ticketId: 't-1',
          code: CODE,
          orderId: 'o-1',
          state: 'ADMITTABLE',
          event: { id: EVENT_ID, name: 'Demo Tonight', startsAt: iso(1), endsAt: iso(4) },
          tierName: null,
          seat: null,
          holderName: 'Jordan Lee',
          usedAt: null,
          entryOpensAt: iso(-1),
          unusedOnOrder: 1,
        }),
        ...extra,
      };
      const reply = routes[`${req.method} ${url.pathname}`];
      if (!reply) return json({ error: { code: 'NOT_FOUND', message: 'unstubbed' } }, 404);
      return reply.clone();
    }),
  );
  return { calls };
}

async function openScanner(user: ReturnType<typeof userEvent.setup>) {
  render(
    <App userManager={fakeUserManager(makeUser({ username: 'agent1', roles: ['gate-agent'] }))} />,
  );
  await user.click(await screen.findByRole('button', { name: /Demo Tonight/ }));
  await screen.findByLabelText('Ticket code');
  await user.click(screen.getByRole('button', { name: 'Scan' }));
}

beforeEach(() => {
  decoded = [];
  stopTracks.mockClear();
  openCamera.mockReset();
  openCamera.mockResolvedValue({ stream: {} as MediaStream, stop: stopTracks });
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('Scanning (US5-3 to US5-6)', () => {
  it('asks for the camera, and a decoded ticket code runs the lookup with no further tap, stopping the camera', async () => {
    const { calls } = stubApi();
    decoded = [CODE.toLowerCase()];
    const user = userEvent.setup();
    await openScanner(user);

    expect(openCamera).toHaveBeenCalled();
    expect(
      await screen.findByText('Check a government-issued photo ID that shows: Jordan Lee'),
    ).toBeInTheDocument();
    const lookup = calls.find((c) => c.path.endsWith('/entry/lookup'));
    expect(lookup?.body).toEqual({ code: CODE });
    expect(stopTracks).toHaveBeenCalled();
  });

  it('says "Not a QueuePass ticket" once per distinct value and keeps scanning', async () => {
    stubApi();
    decoded = ['https://example.com/x', 'https://example.com/x', 'https://example.com/x'];
    const user = userEvent.setup();
    await openScanner(user);

    expect(await screen.findByText('Not a QueuePass ticket')).toBeInTheDocument();
    expect(screen.getAllByText('Not a QueuePass ticket')).toHaveLength(1);
    // The camera keeps running: no code was read yet.
    expect(stopTracks).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stop scanning' })).toBeInTheDocument();
  });

  it('camera access refused: a plain message, and the typed code still works', async () => {
    const { calls } = stubApi();
    openCamera.mockRejectedValue(new CameraRefusedError());
    const user = userEvent.setup();
    await openScanner(user);

    expect(
      await screen.findByText('Camera access was refused. Type the code instead.'),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Ticket code'), CODE);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(
      await screen.findByText('Check a government-issued photo ID that shows: Jordan Lee'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/entry/lookup'))).toBe(true);
  });

  it('no camera on the device: a plain message, and typing still works', async () => {
    stubApi();
    openCamera.mockRejectedValue(new NoCameraError());
    const user = userEvent.setup();
    await openScanner(user);

    expect(
      await screen.findByText('This device has no camera. Type the code instead.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Ticket code')).toBeInTheDocument();
  });

  it('Stop scanning stops every track, and so does unmounting', async () => {
    stubApi();
    const user = userEvent.setup();
    render(
      <App userManager={fakeUserManager(makeUser({ username: 'agent1', roles: ['gate-agent'] }))} />,
    );
    await user.click(await screen.findByRole('button', { name: /Demo Tonight/ }));
    await screen.findByLabelText('Ticket code');
    await user.click(screen.getByRole('button', { name: 'Scan' }));
    await screen.findByRole('button', { name: 'Stop scanning' });

    await user.click(screen.getByRole('button', { name: 'Stop scanning' }));
    expect(stopTracks).toHaveBeenCalledTimes(1);

    // Scanning again, then unmounting the whole app, stops the tracks too.
    stopTracks.mockClear();
    await user.click(screen.getByRole('button', { name: 'Scan' }));
    await screen.findByRole('button', { name: 'Stop scanning' });
    cleanup();
    expect(stopTracks).toHaveBeenCalled();
  });
});
