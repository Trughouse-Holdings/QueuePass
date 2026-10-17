import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { act, screen } from '@testing-library/react';
import { useEventImage } from '../../src/web/event-images';
import { ImageGallery } from '../../src/web/image-gallery';
import { objectUrls } from './browser-stubs';
import {
  advance,
  EVENT_ID,
  imageResponse,
  images,
  renderSignedIn,
  settle,
  stubImages,
  user,
} from './image-helpers';

/**
 * Spec 014 research R4: images are fetched with the user's token, once per image while any
 * component uses it, and shown from an object URL revoked when the last one lets go.
 */
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Probe({ id, enabled = true }: { id: string; enabled?: boolean }) {
  const state = useEventImage(EVENT_ID, id, enabled);
  return (
    <p data-testid={`probe-${id}`} data-url={state.url ?? ''} data-failed={String(state.failed)} />
  );
}

/** Two probes of one image, each removable. */
function Pair({ id }: { id: string }) {
  const [shown, setShown] = useState({ a: true, b: true });
  return (
    <>
      {shown.a && <Probe id={id} />}
      {shown.b && <Probe id={id} />}
      <button onClick={() => setShown((s) => ({ ...s, a: false }))}>drop a</button>
      <button onClick={() => setShown((s) => ({ ...s, b: false }))}>drop b</button>
      <button onClick={() => setShown({ a: true, b: false })}>again</button>
    </>
  );
}

const probes = (id: string) => screen.queryAllByTestId(`probe-${id}`);

describe('useEventImage', () => {
  it('fetches an image once for two users, with the user token, and gives both one URL', async () => {
    const api = stubImages();
    renderSignedIn(<Pair id="img-1" />);
    await settle();

    expect(api.calls).toEqual([
      { path: `/events/${EVENT_ID}/images/img-1`, authorization: `Bearer ${user.access_token}` },
    ]);
    const [a, b] = probes('img-1');
    expect(a!.dataset.url).toMatch(/^blob:/);
    expect(b!.dataset.url).toBe(a!.dataset.url);
  });

  it('revokes the URL only after both users let go, and fetches again for a later use', async () => {
    const api = stubImages();
    renderSignedIn(<Pair id="img-1" />);
    await settle();
    const url = probes('img-1')[0]!.dataset.url;

    act(() => screen.getByText('drop a').click());
    expect(objectUrls.revoked).toEqual([]);
    act(() => screen.getByText('drop b').click());
    expect(objectUrls.revoked).toEqual([url]);

    act(() => screen.getByText('again').click());
    await settle();
    expect(api.calls).toHaveLength(2);
    expect(probes('img-1')[0]!.dataset.url).toMatch(/^blob:/);
    expect(probes('img-1')[0]!.dataset.url).not.toBe(url);
  });

  it('gives the failed state for a 404 and for a network failure, without throwing', async () => {
    stubImages({ 'img-1': imageResponse(404), 'img-2': 'network-error' });
    renderSignedIn(
      <>
        <Probe id="img-1" />
        <Probe id="img-2" />
      </>,
    );
    await settle();
    for (const id of ['img-1', 'img-2']) {
      expect(probes(id)[0]!.dataset.failed).toBe('true');
      expect(probes(id)[0]!.dataset.url).toBe('');
    }
  });

  it('fetches nothing when not enabled', async () => {
    const api = stubImages();
    renderSignedIn(<Probe id="img-1" enabled={false} />);
    await settle();
    expect(api.calls).toEqual([]);
    expect(probes('img-1')[0]!.dataset.url).toBe('');
  });
});

describe('the event page gallery holds its images while mounted (R4)', () => {
  it('makes 3 requests over two loops of 3 images, and revokes them only on unmount', async () => {
    vi.useFakeTimers();
    const api = stubImages();
    const view = renderSignedIn(
      <ImageGallery
        eventId={EVENT_ID}
        eventName="Season Opener"
        images={images(3)}
        variant="page"
      />,
    );
    await advance(0);
    for (let i = 0; i < 6; i++) await advance(5000);

    expect(api.calls.map((c) => c.path)).toEqual([
      `/events/${EVENT_ID}/images/img-1`,
      `/events/${EVENT_ID}/images/img-2`,
      `/events/${EVENT_ID}/images/img-3`,
    ]);
    expect(objectUrls.revoked).toEqual([]);
    view.unmount();
    expect([...objectUrls.revoked].sort()).toEqual([...objectUrls.created].sort());
    expect(objectUrls.created).toHaveLength(3);
  });
});
