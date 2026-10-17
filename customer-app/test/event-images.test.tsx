import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { EventImage } from '@queuepass/shared';
import { availability, blob, event, json, renderCustomer, stubApi } from './helpers';

/** Spec 014 US2 (FR-021, FR-027; SC-007): the event page shows the event's images at the top. */
afterEach(() => vi.unstubAllGlobals());

const IMAGES: EventImage[] = [1, 2, 3].map((n) => ({
  id: `img-${n}`,
  position: n,
  contentType: 'image/png',
  byteSize: 10,
}));
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

const routes = (e: object) => ({
  'GET /events/e1': json(e),
  'GET /events/e1/tiers': json([]),
  'GET /events/e1/availability': json(availability({ ticketsLeft: 7 })),
  ...Object.fromEntries(
    IMAGES.map((i) => [`GET /events/e1/images/${i.id}`, blob(PNG, 'image/png')]),
  ),
});

const page = async (e: object) => {
  stubApi(routes(e));
  const view = renderCustomer({ at: '/events/e1' });
  await screen.findByRole('heading', { name: 'Early Show' });
  await screen.findByRole('heading', { name: 'Get tickets' });
  return view;
};

describe('event page images', () => {
  it('shows the gallery above the event name', async () => {
    const { container } = await page(event({ images: IMAGES }));
    const band = container.querySelector('.page-band');
    expect(band).not.toBeNull();
    expect(band!.querySelector('.gallery')).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Images of Early Show' })).toBeInTheDocument();
    const h1 = screen.getByRole('heading', { level: 1, name: 'Early Show' });
    expect(band!.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      await screen.findByRole('img', { name: 'Early Show, image 1 of 3' }),
    ).toBeInTheDocument();
  });

  it('looks as before without images: no images key and images: [] give the same markup', async () => {
    const { images: _none, ...withoutKey } = event();
    const first = await page(withoutKey);
    const before = first.container.querySelector('section')!.outerHTML;
    first.unmount();
    vi.unstubAllGlobals();

    const second = await page(event({ images: [] }));
    expect(second.container.querySelector('section')!.outerHTML).toBe(before);
    expect(second.container.querySelector('.gallery, .page-band')).toBeNull();
  });

  it('shows the images of a cancelled event', async () => {
    await page(event({ images: IMAGES, status: 'CANCELLED', cancelledAt: '2026-10-01T00:00:00Z' }));
    expect(screen.getByRole('group', { name: 'Images of Early Show' })).toBeInTheDocument();
    expect(screen.getByText('This event has been cancelled.')).toBeInTheDocument();
  });
});
