import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Event } from '@queuepass/shared';
import { VenueMap, useSeatStream, type SeatView } from '@queuepass/shared/web';
import { accessToken, api } from '../api/client';

/** The admin's map only shows the seats: none is chosen from it. */
const READ_ONLY = (): SeatView => ({ disabled: true });

/**
 * Spec 038 US6 (FR-027, FR-028; research R15, T049): the event page's Seating card. A seated
 * event's seats on the shared venue map colored by state (open, held, sold, off sale), each
 * section with its counts, the event's totals, a section zoomed into by a click, all kept live by
 * the seat stream (spec 015 FR-010, `useSeatStream`). The map never says who holds or bought a
 * seat; the attendee list does (FR-028). The layout, prices and seats off sale are changed in the
 * event form (FR-015), so the card only points there.
 */
export function EventSeatMap({ event }: { event: Event }): React.ReactElement {
  const seated = event.layoutId != null || event.reservedSeating;
  const [open, setOpen] = useState<string | null>(null);
  const live = useSeatStream(seated ? event.id : null, {
    api,
    getToken: accessToken,
    openSectionId: open,
  });

  const seatMap = (): React.ReactNode => {
    const { map } = live;
    if (!map) {
      return live.status === 'loading' || live.status === 'connecting' ? (
        <p className="loading">Loading the seat map…</p>
      ) : (
        <p className="note">The seat map is unavailable right now.</p>
      );
    }
    const total = (k: 'open' | 'reserved' | 'sold' | 'offSale'): number =>
      map.sections.reduce((n, s) => n + s.counts.reduce((m, c) => m + Math.max(0, c[k]), 0), 0);
    return (
      <>
        {/* Spec 015 FR-013: the event's seats by state, kept current by the stream. */}
        <p>{`${total('sold')} sold, ${total('reserved')} held, ${total('open')} open, ${total(
          'offSale',
        )} off sale`}</p>
        {live.status === 'reconnecting' && (
          <p className="note">Reconnecting: the map may be behind for a moment.</p>
        )}
        <VenueMap
          map={map}
          colorBy="state"
          // A section gone from a new layout (the stream ended on the change) is closed.
          openSectionId={map.sections.some((s) => s.sectionId === open) ? open : null}
          section={live.section}
          onOpenSection={setOpen}
          seatView={READ_ONLY}
        />
      </>
    );
  };

  return (
    <section className="card" aria-labelledby="seating-heading">
      <h2 id="seating-heading">Seating</h2>
      {seated ? (
        <>
          <p className="note">
            Reserved seating: its layout, prices by level and seats off sale are changed in{' '}
            <Link to={`/events/${event.id}/edit`}>Edit event</Link>. Who bought a seat is on the{' '}
            <Link to={`/events/${event.id}/attendees`}>attendee list</Link>.
          </p>
          {seatMap()}
        </>
      ) : (
        <p className="note">General admission.</p>
      )}
    </section>
  );
}
