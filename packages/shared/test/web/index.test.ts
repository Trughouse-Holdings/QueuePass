import { describe, expect, it } from 'vitest';
import * as web from '../../src/web/index.js';
import { LayoutPreview } from '../../src/web/venue-map/layout-preview.js';
import { SectionsList } from '../../src/web/venue-map/sections-list.js';
import { VenueMap } from '../../src/web/venue-map/venue-map.js';

/**
 * Spec 038 (T057): `@queuepass/shared/web`, the entry the apps import, gives the venue map and
 * its parts as the modules define them (spec 001 research R9's one shared package).
 */
describe('@queuepass/shared/web', () => {
  it('exports the venue map, the Sections list and the layout preview', () => {
    expect(web.VenueMap).toBe(VenueMap);
    expect(web.SectionsList).toBe(SectionsList);
    expect(web.LayoutPreview).toBe(LayoutPreview);
  });

  it('exports every part a page uses as a function or a value', () => {
    for (const name of [
      'AuthProvider',
      'useAuth',
      'useSeatStream',
      'openSeatStream',
      'Legend',
      'PriceFilter',
      'usePriceFilter',
      'SectionView',
      'mapSeatOf',
      'seatLook',
      'seatTip',
      'mapReducer',
      'priceRangeOf',
      'usePanZoom',
      'outlinePath',
      'sectionViewBox',
    ] as const) {
      expect(typeof web[name], name).toBe('function');
    }
    expect(web.EMPTY_MAP_STATE).toBeDefined();
    expect(web.MAX_ZOOM).toBeGreaterThan(1);
    expect(web.RECONNECT_DELAYS_MS.length).toBeGreaterThan(0);
  });
});
