import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mapsUrl } from '../../src/location';
import { AddressLink } from '../../src/web/address-link';

/** Spec 013 FR-014, FR-015; research R10. */
describe('AddressLink', () => {
  const address = '430 W VINE ST, LEXINGTON, KY 40507';

  it('links the address to Google Maps in a new tab, without access to this page', () => {
    render(<AddressLink address={address} />);
    const link = screen.getByRole('link', {
      name: `${address} (opens Google Maps in a new tab)`,
    });
    expect(link).toHaveTextContent(address);
    expect(link).toHaveAttribute('href', mapsUrl(address));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('links a one-line address from before the feature too', () => {
    render(<AddressLink address="1 Demo Plaza, Louisville, KY" />);
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      mapsUrl('1 Demo Plaza, Louisville, KY'),
    );
  });
});
