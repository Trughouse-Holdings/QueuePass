import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Event, EventImage } from '@queuepass/shared';
import { usd, when } from '../src/format';
import { availability, blob, event, json, renderCustomer, stubApi, venue } from './helpers';

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

/**
 * Spec 014 US4 (FR-020, FR-027, FR-032; SC-006): each card on the Events list shows its event's
 * images at its top, turning on its own; a card without images is unchanged; card text never waits
 * for an image.
 */
describe('Events list card images', () => {
  const LATE: EventImage[] = IMAGES.map((i) => ({ ...i, id: `late-${i.position}` }));
  const early = event({ images: IMAGES });
  const late = event({ id: 'e2', name: 'Late Show', images: LATE });
  const imageRoutes = (
    list: EventImage[],
    eventId: string,
    reply: () => Response | Promise<Response>,
  ) => Object.fromEntries(list.map((i) => [`GET /events/${eventId}/images/${i.id}`, reply]));
  const png = () => blob(PNG, 'image/png');

  const list = async (
    events: Event[],
    routes: Record<string, () => Response | Promise<Response>> = {},
  ) => {
    const { calls } = stubApi({
      'GET /events': json(events),
      'GET /locations': json([venue()]),
      ...routes,
    });
    const view = renderCustomer({ at: '/events' });
    const cards = await screen.findAllByRole('article');
    return { ...view, cards, calls };
  };

  it('shows the gallery at the top of the card, above the title', async () => {
    const { cards } = await list([early], imageRoutes(IMAGES, 'e1', png));
    const gallery = within(cards[0]!).getByRole('group', { name: 'Images of Early Show' });
    expect(gallery).toHaveClass('gallery--card');
    expect(cards[0]!.firstElementChild).toBe(gallery);
    const title = within(cards[0]!).getByRole('heading', { name: 'Early Show' });
    expect(gallery.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cards[0]!.querySelector('a.gallery__open')).toHaveAttribute('href', '/events/e1');
    await waitFor(() =>
      expect(cards[0]!.querySelector('img')).toHaveAttribute('alt', 'Early Show, image 1 of 3'),
    );
  });

  it('turns each card on its own', async () => {
    const { cards } = await list([early, late], {
      ...imageRoutes(IMAGES, 'e1', png),
      ...imageRoutes(LATE, 'e2', png),
    });
    await userEvent.click(
      within(cards[0]!).getByRole('button', { name: 'Next image of Early Show' }),
    );
    expect(within(cards[0]!).getByText('2 of 3')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('1 of 3')).toBeInTheDocument();
  });

  it('leaves a card without images as it was: no images key and images: [] give the same markup', async () => {
    const { images: _none, ...withoutKey } = event();
    const first = await list([withoutKey as Event]);
    const before = first.cards[0]!.outerHTML;
    first.unmount();
    vi.unstubAllGlobals();

    const second = await list([event({ images: [] })]);
    expect(second.cards[0]!.outerHTML).toBe(before);
    expect(second.container.querySelector('.gallery')).toBeNull();
  });

  it("shows every card's name, times, venue, and price while its images are still loading", async () => {
    const pending = () => new Promise<Response>(() => {});
    const { cards, calls } = await list([early], imageRoutes(IMAGES, 'e1', pending));
    await waitFor(() =>
      expect(calls.some((c) => c.path.startsWith('/events/e1/images/'))).toBe(true),
    );
    const card = cards[0]!;
    expect(within(card).getByRole('heading', { name: 'Early Show' })).toBeInTheDocument();
    expect(within(card).getByText(when(early.startsAt))).toBeInTheDocument();
    expect(within(card).getByText(when(early.endsAt))).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Alpha Arena' })).toBeInTheDocument();
    expect(within(card).getByText(usd(early.basePrice))).toBeInTheDocument();
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.gallery__placeholder')).not.toBeNull();
  });
});
