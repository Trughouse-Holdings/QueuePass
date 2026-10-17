import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { EventImage } from '@queuepass/shared';
import { EventForm } from '../src/pages/EventForm';
import { json, stubApi } from './helpers/api-stub';
import {
  ANIMATED_CHUNK,
  brokenPngFile,
  gifFile,
  jpegFile,
  pngFile,
  savedImage,
  textFile,
  webpFile,
} from './helpers/images';
import { EVENT, VENUE } from './fixtures-005';

/**
 * Spec 014 US1 (FR-014 to FR-018; research R9): the Images control of the Schedule event and Edit
 * event forms, and the order of the requests a save sends.
 */
afterEach(() => vi.unstubAllGlobals());

const ID = EVENT.id;
const PLAIN = { ...VENUE, id: 'v-plain', name: 'Plain Hall' };
const NO_LAYOUT = { locationId: 'v-plain', totalSeats: 0, sections: [] };
const EV = { ...EVENT, locationId: 'v-plain', location: PLAIN, images: [] as EventImage[] };
const TIER = {
  id: 't1',
  eventId: ID,
  name: 'Floor',
  price: '45.00',
  quantity: 100,
  createdAt: EVENT.createdAt,
  updatedAt: EVENT.updatedAt,
};
const HINT = 'Up to 5 images. JPG, PNG, or WebP, up to 5 MB each. The first image is the cover.';
const TYPE_MESSAGE = 'This file is not a JPG, PNG, or WebP picture.';

/** Where the router is, and whether the history entry carries state. */
function Where() {
  const location = useLocation();
  return (
    <p data-testid="where" data-state={location.state === null ? 'none' : 'set'}>
      {location.pathname}
    </p>
  );
}

function EventPage() {
  const navigate = useNavigate();
  return (
    <>
      <p>Event page</p>
      <button type="button" onClick={() => navigate(-1)}>
        Back
      </button>
    </>
  );
}

const renderAt = (entry: string | { pathname: string; state: unknown }) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/events/new" element={<EventForm />} />
        <Route path="/events/:id" element={<EventPage />} />
        <Route path="/events/:id/edit" element={<EventForm />} />
        <Route path="/events" element={<p>Event list</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );

type Planned = 'ok' | Response | 'network-error';

/**
 * A Backend for one event: its stored images grow with each accepted upload. `uploads` plans the
 * answers to the uploads in order; any not planned are accepted.
 */
function backend(opts: { images?: EventImage[]; uploads?: Planned[]; routes?: object } = {}) {
  const images = [...(opts.images ?? [])];
  let n = 0;
  let made = 0;
  const api = stubApi({
    'GET /locations': json([PLAIN]),
    'GET /locations/v-plain/layout': json(NO_LAYOUT),
    'POST /events': json(EV, 201),
    [`GET /events/${ID}`]: () => json({ ...EV, images: [...images] }),
    [`PATCH /events/${ID}`]: () => json({ ...EV, images: [...images] }),
    [`GET /events/${ID}/tiers`]: json([TIER]),
    [`POST /events/${ID}/tiers`]: json(TIER, 201),
    [`POST /events/${ID}/images`]: () => {
      const planned = opts.uploads?.[n++] ?? 'ok';
      if (planned === 'network-error') throw new TypeError('Failed to fetch');
      if (planned !== 'ok') return planned;
      const image = savedImage(`img-${++made}`, images.length + 1);
      images.push(image as EventImage);
      return json(image, 201);
    },
    ...opts.routes,
  });
  const uploads = () => api.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/images'));
  const uploadedNames = () =>
    uploads().map((c) => ((c.body as { formData: FormData }).formData.get('file') as File).name);
  const imageCalls = () => api.calls.filter((c) => c.path.includes('/images'));
  return { api, images, uploads, uploadedNames, imageCalls };
}

const refusal = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status);

async function fillNewEvent() {
  fireEvent.change(await screen.findByLabelText('Event name'), {
    target: { value: 'Season Opener' },
  });
  await screen.findByRole('option', { name: /Plain Hall/ });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'v-plain' } });
  fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2030-05-01T18:00' } });
  fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2030-05-01T21:00' } });
  fireEvent.change(await screen.findByLabelText('Ticket type 1 name'), {
    target: { value: 'Floor' },
  });
  fireEvent.change(screen.getByLabelText('Ticket type 1 price'), { target: { value: '45.00' } });
  fireEvent.change(screen.getByLabelText('Ticket type 1 quantity'), { target: { value: '100' } });
}

const choose = (...files: File[]) =>
  fireEvent.change(screen.getByLabelText('Add images'), { target: { files } });

/** The Images control's list items, in order. */
const items = () =>
  within(screen.getByRole('group', { name: 'Images' })).queryAllByRole('listitem');

const editLoaded = async (count: number) => {
  await screen.findByRole('heading', { name: 'Edit event' });
  await vi.waitFor(() => expect(screen.getByLabelText('Event name')).toHaveValue('Season Opener'));
  await vi.waitFor(() => expect(items()).toHaveLength(count));
};

describe('the Images control', () => {
  it.each([
    ['Schedule event', '/events/new'],
    ['Edit event', `/events/${ID}/edit`],
  ])('is in the %s form with the file input and the hint', async (_heading, path) => {
    backend();
    renderAt(path);
    const group = await screen.findByRole('group', { name: 'Images' });
    const input = within(group).getByLabelText('Add images');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    expect(input).toHaveAttribute('multiple');
    expect(group).toHaveTextContent(HINT);
    expect(group).not.toHaveTextContent(/metadata|location/i);
  });

  it('previews a PNG, a JPEG, and a WebP in order, the first marked Cover', async () => {
    backend();
    renderAt('/events/new');
    await screen.findByRole('group', { name: 'Images' });
    choose(pngFile('a.png'), jpegFile('b.jpg'), webpFile('c.webp'));

    await vi.waitFor(() => expect(items()).toHaveLength(3));
    items().forEach((item, i) => {
      const img = within(item).getByRole('img', { name: `Image ${i + 1}` });
      expect(img.getAttribute('src')).toMatch(/^blob:/);
    });
    expect(within(items()[0]!).getByText('Cover')).toBeInTheDocument();
    expect(within(items()[1]!).queryByText('Cover')).toBeNull();
  });

  it('refuses files before sending, naming each with its reason', async () => {
    const server = backend();
    renderAt('/events/new');
    await screen.findByRole('group', { name: 'Images' });
    choose(
      gifFile('anim.gif'),
      textFile('fake.jpg'),
      pngFile('big.png', { size: 5_242_881 }),
      pngFile('huge.png', { width: 20_000, height: 20_000 }),
      pngFile('moving.png', { before: [ANIMATED_CHUNK] }),
    );

    const note = await screen.findByText(/anim\.gif/);
    const group = screen.getByRole('group', { name: 'Images' });
    await vi.waitFor(() => expect(group).toHaveTextContent('moving.png'));
    expect(note.closest('[data-testid="images-note"]')).not.toBeNull();
    expect(group).toHaveTextContent('anim.gif: only JPG, PNG, or WebP pictures');
    expect(group).toHaveTextContent('fake.jpg: only JPG, PNG, or WebP pictures');
    expect(group).toHaveTextContent('big.png: over 5 MB');
    expect(group).toHaveTextContent('huge.png: over 16,384 pixels a side or 40 megapixels');
    expect(group).toHaveTextContent('moving.png: animated pictures are not accepted');
    expect(items()).toHaveLength(0);
    expect(server.imageCalls()).toEqual([]);
  });

  it('accepts a PNG of exactly 5,242,880 bytes, and a sixth file is left out', async () => {
    const server = backend();
    renderAt('/events/new');
    await screen.findByRole('group', { name: 'Images' });
    choose(
      pngFile('exact.png', { size: 5_242_880 }),
      pngFile('b.png'),
      pngFile('c.png'),
      pngFile('d.png'),
      pngFile('e.png'),
      pngFile('sixth.png'),
    );

    await vi.waitFor(() => expect(items()).toHaveLength(5));
    const group = screen.getByRole('group', { name: 'Images' });
    await vi.waitFor(() =>
      expect(group).toHaveTextContent('sixth.png: an event can have at most 5 images'),
    );
    expect(within(group).queryByLabelText('Add images')).toBeNull();
    expect(group).toHaveTextContent('5 of 5 images. Remove one to add another.');
    expect(server.imageCalls()).toEqual([]);
  });

  it('lets a picture whose later chunk runs past the end through, and shows the 415 on save', async () => {
    const server = backend({
      images: [savedImage('s1', 1) as EventImage],
      uploads: [refusal(415, 'IMAGE_TYPE_NOT_ALLOWED', TYPE_MESSAGE)],
    });
    renderAt(`/events/${ID}/edit`);
    await editLoaded(1);
    choose(brokenPngFile('broken.png'));
    await vi.waitFor(() => expect(items()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(`broken.png: ${TYPE_MESSAGE}`);
    expect(server.uploadedNames()).toEqual(['broken.png']);
    expect(items()).toHaveLength(2);
  });
});

describe('saving', () => {
  it('creates the event, its ticket type, then uploads each picture in order as multipart', async () => {
    const server = backend();
    renderAt('/events/new');
    await fillNewEvent();
    choose(pngFile('a.png'), jpegFile('b.jpg'), webpFile('c.webp'));
    await vi.waitFor(() => expect(items()).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    const writes = server.api.calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /events',
      `POST /events/${ID}/tiers`,
      `POST /events/${ID}/images`,
      `POST /events/${ID}/images`,
      `POST /events/${ID}/images`,
    ]);
    expect(server.uploadedNames()).toEqual(['a.png', 'b.jpg', 'c.webp']);
    for (const call of server.uploads()) {
      expect(call.contentType).toMatch(/^multipart\/form-data; boundary=/);
      expect([...(call.body as { formData: FormData }).formData.keys()]).toEqual(['file']);
    }
  });

  it('adds one picture to an event with two: one upload, no reorder', async () => {
    const server = backend({
      images: [savedImage('s1', 1), savedImage('s2', 2)] as EventImage[],
    });
    renderAt(`/events/${ID}/edit`);
    await editLoaded(2);
    choose(pngFile('third.png'));
    await vi.waitFor(() => expect(items()).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(server.uploadedNames()).toEqual(['third.png']);
    expect(server.api.calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(server.api.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('stops at a 415 on the second of three, keeps everything, and finishes on the next save', async () => {
    const server = backend({
      uploads: ['ok', refusal(415, 'IMAGE_TYPE_NOT_ALLOWED', TYPE_MESSAGE)],
    });
    renderAt(`/events/${ID}/edit`);
    await editLoaded(0);
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Renamed Opener' } });
    choose(pngFile('a.png'), pngFile('b.png'), pngFile('c.png'));
    await vi.waitFor(() => expect(items()).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(`b.png: ${TYPE_MESSAGE}`);
    expect(server.uploadedNames()).toEqual(['a.png', 'b.png']);
    expect(server.images).toHaveLength(1);
    expect(screen.getByLabelText('Event name')).toHaveValue('Renamed Opener');
    expect(items()).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(server.uploadedNames()).toEqual(['a.png', 'b.png', 'b.png', 'c.png']);
    expect(server.images).toHaveLength(3);
  });

  it.each([
    [413, 'IMAGE_TOO_LARGE', 'An image can be at most 5 MB.'],
    [
      409,
      'IMAGE_LIMIT_REACHED',
      'Season Opener already has 5 images, the most an event can have. Remove one to add another.',
    ],
  ])('shows a %i %s with the file name', async (status, code, message) => {
    backend({ uploads: [refusal(status, code, message)] });
    renderAt(`/events/${ID}/edit`);
    await editLoaded(0);
    choose(pngFile('one.png'));
    await vi.waitFor(() => expect(items()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`one.png: ${message}`);
    expect(items()).toHaveLength(1);
  });

  it('sends no image request on Cancel', async () => {
    const server = backend();
    renderAt('/events/new');
    await fillNewEvent();
    choose(pngFile('a.png'));
    await vi.waitFor(() => expect(items()).toHaveLength(1));
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }));
    expect(await screen.findByText('Event list')).toBeInTheDocument();
    expect(server.imageCalls()).toEqual([]);
    expect(server.api.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});

describe('creating an event when a picture is refused (FR-017, FR-018)', () => {
  const createWithThree = async (server: ReturnType<typeof backend>) => {
    renderAt('/events/new');
    await fillNewEvent();
    choose(pngFile('a.png'), pngFile('b.png'), pngFile('c.png'));
    await vi.waitFor(() => expect(items()).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));
    await vi.waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(`/events/${ID}/edit`),
    );
    await editLoaded(3);
    return server;
  };

  it('becomes the edit form of the new event, keeps the pending pictures, and never creates twice', async () => {
    const server = await createWithThree(
      backend({ uploads: ['ok', refusal(415, 'IMAGE_TYPE_NOT_ALLOWED', TYPE_MESSAGE)] }),
    );
    expect(screen.getByRole('heading', { name: 'Edit event' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      `Event created. These pictures were not added: b.png (${TYPE_MESSAGE}), c.png. Save again to add them.`,
    );
    expect(server.images).toHaveLength(1);
    // The history entry no longer carries the pending pictures.
    await vi.waitFor(() =>
      expect(screen.getByTestId('where')).toHaveAttribute('data-state', 'none'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(
      server.api.calls.filter((c) => c.method === 'POST' && c.path === '/events'),
    ).toHaveLength(1);
    expect(server.api.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(server.uploadedNames()).toEqual(['a.png', 'b.png', 'b.png', 'c.png']);

    // Back to the edit form: nothing pending, so saving again uploads nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await editLoaded(3);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(server.uploadedNames()).toHaveLength(4);
    expect(
      server.api.calls.filter((c) => c.method === 'POST' && c.path === '/events'),
    ).toHaveLength(1);
  });

  it('does the same after a network failure on an upload', async () => {
    const server = await createWithThree(backend({ uploads: ['ok', 'network-error'] }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Event created. These pictures were not added: b.png (could not be sent), c.png. Save again to add them.',
    );
    expect(server.images).toHaveLength(1);
  });

  it('works when the edit form is mounted afresh with the router state', async () => {
    const server = backend({ images: [savedImage('s1', 1) as EventImage] });
    const notice =
      'Event created. These pictures were not added: b.png (could not be sent), c.png. Save again to add them.';
    renderAt({
      pathname: `/events/${ID}/edit`,
      state: { pendingImages: [pngFile('b.png'), pngFile('c.png')], notice },
    });
    await editLoaded(3);
    expect(screen.getByRole('status')).toHaveTextContent(notice);
    await vi.waitFor(() =>
      expect(screen.getByTestId('where')).toHaveAttribute('data-state', 'none'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(server.api.calls.filter((c) => c.method === 'POST' && c.path === '/events')).toEqual([]);
    expect(server.api.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(server.uploadedNames()).toEqual(['b.png', 'c.png']);
  });
});

describe('spec 008 unchanged: a refused seating or ticket type step', () => {
  it('stays on Schedule event with every value and picture when a ticket type is refused', async () => {
    const server = backend({
      routes: {
        [`POST /events/${ID}/tiers`]: refusal(409, 'TIER_NAME_TAKEN', 'Name taken.'),
      },
    });
    renderAt('/events/new');
    await fillNewEvent();
    choose(pngFile('a.png'), pngFile('b.png'));
    await vi.waitFor(() => expect(items()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Seating setup not finished');
    expect(
      within(alert).getByRole('link', { name: 'Finish on the event page' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/events/new');
    expect(server.imageCalls()).toEqual([]);
    expect(screen.getByLabelText('Event name')).toHaveValue('Season Opener');
    expect(items()).toHaveLength(2);
  });

  it('does the same when the seating is refused', async () => {
    const layout = {
      locationId: VENUE.id,
      totalSeats: 10,
      sections: [{ id: 's-front', name: 'front', rows: 1, seatsPerRow: 10 }],
    };
    const server = backend({
      routes: {
        'GET /locations': json([{ ...VENUE, seatingCapacity: 10 }, PLAIN]),
        [`GET /locations/${VENUE.id}/layout`]: json(layout),
        'POST /events': json({ ...EV, locationId: VENUE.id, location: VENUE }, 201),
        [`PUT /events/${ID}/seating`]: refusal(409, 'LAYOUT_IN_USE', 'Seating refused.'),
      },
    });
    renderAt('/events/new');
    fireEvent.change(await screen.findByLabelText('Event name'), {
      target: { value: 'Season Opener' },
    });
    await screen.findByRole('option', { name: /Yum Center/ });
    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: VENUE.id } });
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2030-05-01T18:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2030-05-01T21:00' } });
    await screen.findByRole('group', { name: 'Tickets and seating' });
    fireEvent.change(screen.getByLabelText('Ticket type 1 name'), { target: { value: 'Floor' } });
    fireEvent.change(screen.getByLabelText('Ticket type 1 price'), { target: { value: '45.00' } });
    choose(pngFile('a.png'));
    await vi.waitFor(() => expect(items()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Seating setup not finished');
    expect(screen.getByTestId('where')).toHaveTextContent('/events/new');
    expect(server.imageCalls()).toEqual([]);
    expect(items()).toHaveLength(1);
  });
});
