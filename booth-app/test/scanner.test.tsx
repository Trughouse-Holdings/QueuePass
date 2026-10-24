import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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

const ADMIT = `POST /events/${EVENT_ID}/entry/admit`;
const LOOKUP = `POST /events/${EVENT_ID}/entry/lookup`;

/** A reply that waits until the test releases it, to look at the screen mid-request. */
function held() {
  let release: (r: Response) => void = () => undefined;
  const reply = () => new Promise<Response>((resolve) => (release = resolve));
  return { reply, release: (r: Response) => release(r) };
}

function stubApi(extra: Record<string, Response | (() => Promise<Response>)> = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const req = input instanceof Request ? input : new Request(input);
      const url = new URL(req.url);
      const body = req.method === 'GET' ? null : JSON.parse((await req.clone().text()) || 'null');
      calls.push({ method: req.method, path: url.pathname, body });
      const routes: Record<string, Response | (() => Promise<Response>)> = {
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
      return (typeof reply === 'function' ? await reply() : reply).clone();
    }),
  );
  return { calls };
}

/** The camera panel; EntryResult has a role="status" too, so queries stay inside this. */
const scanRegion = () => screen.findByRole('region', { name: 'Scan a ticket' });

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

    const scanner = await scanRegion();
    expect(await within(scanner).findByRole('status')).toHaveTextContent('Not a QueuePass ticket');
    expect(screen.getAllByText('Not a QueuePass ticket')).toHaveLength(1);
    // The camera keeps running: no code was read yet.
    expect(stopTracks).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stop scanning' })).toBeInTheDocument();
  });

  it('has its status region from the start, so "Not a QueuePass ticket" is announced when it appears', async () => {
    stubApi();
    const user = userEvent.setup();
    await openScanner(user);

    const scanner = await scanRegion();
    expect(within(scanner).getByRole('status')).toHaveTextContent('');
  });

  it('camera access refused: a plain message, and the typed code still works', async () => {
    const { calls } = stubApi();
    openCamera.mockRejectedValue(new CameraRefusedError());
    const user = userEvent.setup();
    await openScanner(user);

    // An alert, so a screen reader announces it.
    expect(await within(await scanRegion()).findByRole('alert')).toHaveTextContent(
      'Camera access was refused. Type the code instead.',
    );

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

    expect(await within(await scanRegion()).findByRole('alert')).toHaveTextContent(
      'This device has no camera. Type the code instead.',
    );
    expect(screen.getByLabelText('Ticket code')).toBeInTheDocument();
  });

  it('a camera that exists but can\'t be opened (busy in another app) says so, not "no camera"', async () => {
    stubApi();
    openCamera.mockRejectedValue(
      new DOMException('Could not start video source', 'NotReadableError'),
    );
    const user = userEvent.setup();
    await openScanner(user);

    expect(await within(await scanRegion()).findByRole('alert')).toHaveTextContent(
      "The camera can't be opened. Type the code instead.",
    );
  });

  it('a typed Look up closes an open camera before the request goes out (FR-024)', async () => {
    const lookup = held();
    stubApi({ [LOOKUP]: lookup.reply });
    const user = userEvent.setup();
    await openScanner(user);
    await scanRegion();

    await user.type(screen.getByLabelText('Ticket code'), CODE);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    // Still waiting for the answer: the camera is already closed, so it can't read a second
    // ticket whose answer would race this one.
    expect(screen.queryByRole('region', { name: 'Scan a ticket' })).not.toBeInTheDocument();
    expect(stopTracks).toHaveBeenCalled();

    lookup.release(
      json({
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
    );
    expect(
      await screen.findByText('Check a government-issued photo ID that shows: Jordan Lee'),
    ).toBeInTheDocument();
  });

  it('Admit closes a camera reopened while the ticket shows (FR-024)', async () => {
    const admit = held();
    stubApi({ [ADMIT]: admit.reply });
    const user = userEvent.setup();
    render(
      <App
        userManager={fakeUserManager(makeUser({ username: 'agent1', roles: ['gate-agent'] }))}
      />,
    );
    await user.click(await screen.findByRole('button', { name: /Demo Tonight/ }));
    await user.type(await screen.findByLabelText('Ticket code'), CODE);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    const admitButton = await screen.findByRole('button', { name: 'Admit' });

    await user.click(screen.getByRole('button', { name: 'Scan' }));
    await scanRegion();
    await user.click(admitButton);
    expect(screen.queryByRole('region', { name: 'Scan a ticket' })).not.toBeInTheDocument();
    expect(stopTracks).toHaveBeenCalled();

    admit.release(
      json({ admitted: [{ ticketId: 't-1', code: CODE, usedAt: iso(0) }], alreadyUsed: [] }),
    );
    expect(await screen.findByText(/✓ Admitted/)).toBeInTheDocument();
  });

  it('Stop scanning stops every track, and so does unmounting', async () => {
    stubApi();
    const user = userEvent.setup();
    render(
      <App
        userManager={fakeUserManager(makeUser({ username: 'agent1', roles: ['gate-agent'] }))}
      />,
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
