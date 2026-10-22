import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { EventImage } from '@queuepass/shared';
import { AuthProvider } from '@queuepass/shared/web';
import { EventDetail } from '../src/pages/EventDetail';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';
import { blob, json, stubApi } from './helpers/api-stub';
import { EVENT } from './fixtures-005';

/** Spec 014 FR-019: the Admin event page shows the event's images as customers see them. */
afterEach(() => vi.unstubAllGlobals());

const PATH = `/events/${EVENT.id}`;
const IMAGES: EventImage[] = [1, 2].map((n) => ({
  id: `img-${n}`,
  position: n,
  contentType: 'image/png',
  byteSize: 10,
}));

const renderPage = () =>
  render(
    <AuthProvider
      userManager={fakeUserManager(makeUser({ username: 'admin1', roles: ['queuepass-admin'] }))}
    >
      <MemoryRouter initialEntries={[PATH]}>
        <Routes>
          <Route path="/events/:id" element={<EventDetail />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );

describe('Admin event page images', () => {
  it('shows the gallery above the page head for an event with images', async () => {
    stubApi({
      [`GET ${PATH}`]: json({ ...EVENT, images: IMAGES }),
      ...Object.fromEntries(
        IMAGES.map((i) => [`GET ${PATH}/images/${i.id}`, blob([137, 80, 78, 71], 'image/png')]),
      ),
    });
    const { container } = renderPage();
    await screen.findByRole('heading', { name: /Season Opener/ });
    const band = container.querySelector('.page-band');
    expect(band).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Images of Season Opener' })).toBeInTheDocument();
    const head = container.querySelector('.page-head')!;
    expect(band!.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      await screen.findByRole('img', { name: 'Season Opener, image 1 of 2' }),
    ).toBeInTheDocument();
  });

  it('shows nothing for an event without images', async () => {
    stubApi({ [`GET ${PATH}`]: json({ ...EVENT, images: [] }) });
    const { container } = renderPage();
    await screen.findByRole('heading', { name: /Season Opener/ });
    expect(container.querySelector('.gallery, .page-band')).toBeNull();
  });
});
