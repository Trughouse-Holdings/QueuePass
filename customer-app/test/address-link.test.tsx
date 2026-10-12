import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { mapsUrl } from '@queuepass/shared';
import { json, renderCustomer, stubApi, venue } from './helpers';

/** Spec 013 US3 (FR-014, FR-015): every venue address in the Customer app opens Google Maps. */
afterEach(() => vi.unstubAllGlobals());

const label = (address: string) => `${address} (opens Google Maps in a new tab)`;

describe('Venue addresses as map links', () => {
  it('links each address on the venue list', async () => {
    const legacy = venue({
      id: 'v2',
      name: 'Beta Hall',
      address: '1 Demo Plaza, Louisville, KY',
      street: null,
      city: null,
      state: null,
      zip: null,
      addressVerified: false,
    });
    stubApi({ 'GET /locations': json([venue(), legacy]) });
    renderCustomer({ at: '/venues' });

    for (const v of [venue(), legacy]) {
      const link = await screen.findByRole('link', { name: label(v.address) });
      expect(link).toHaveAttribute('href', mapsUrl(v.address));
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('links the address on a venue page', async () => {
    stubApi({ 'GET /locations/v1': json(venue()), 'GET /events': json([]) });
    renderCustomer({ at: '/venues/v1' });

    const link = await screen.findByRole('link', { name: label(venue().address) });
    expect(link).toHaveAttribute('href', mapsUrl(venue().address));
    expect(link).toHaveAttribute('target', '_blank');
  });
});
