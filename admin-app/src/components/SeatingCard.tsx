import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Event, SeatMap } from '@queuepass/shared';
import { applySeatChange, useSeatStream } from '@queuepass/shared/web';
import { accessToken, api } from '../api/client';
import { getSeatMap } from '../api/seating';
import { SeatGrid } from './SeatGrid';

type Load = { kind: 'loading' } | { kind: 'ok'; map: SeatMap } | { kind: 'unavailable' };

/**
 * Spec 007 US4 (FR-012): the event page's Seating card and its seat map. Spec 015 FR-010 (research
 * R14): the seat map and its counts update live, from the same stream customers read. Spec 038
 * (FR-015, research R15): an event's layout, prices and seats off sale are set in the event form,
 * so this card only says what the event is and where to change it; US6 (T049) replaces the seat
 * map with the shared venue map.
 */
export function SeatingCard({ event }: { event: Event }): React.ReactElement {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [viewing, setViewing] = useState<string | null>(null);

  // Spec 015: live changes and catch-up snapshots go into the map shown.
  const live = useSeatStream(event.id, {
    api,
    getToken: accessToken,
    onChange: (change) =>
      setLoad((l) => (l.kind === 'ok' ? { ...l, map: applySeatChange(l.map, change) } : l)),
    onSnapshot: (map) => setLoad((l) => (l.kind === 'ok' ? { ...l, map } : l)),
  });

  const liveMap = useRef<SeatMap | null>(null);
  liveMap.current = live.map;

  const seated = event.layoutId != null || event.reservedSeating;
  useEffect(() => {
    if (!seated) return;
    let cancelled = false;
    getSeatMap(event.id)
      .then((loaded) => {
        // Changes may have arrived while this loaded: the stream's map already has them.
        if (!cancelled) setLoad({ kind: 'ok', map: liveMap.current ?? loaded });
      })
      .catch(() => !cancelled && setLoad({ kind: 'unavailable' }));
    return () => {
      cancelled = true;
    };
  }, [event.id, seated]);

  const seatMap = (): React.ReactNode => {
    if (load.kind === 'loading') return <p className="loading">Loading the seat map…</p>;
    if (load.kind === 'unavailable') {
      return <p className="note">The seat map is unavailable right now.</p>;
    }
    const { map } = load;
    const shown = map.sections.find((s) => s.sectionId === viewing) ?? map.sections[0];
    if (!shown) return null;
    return (
      <>
        <h3>Seat map</h3>
        <label>
          Seat map section{' '}
          <select value={shown.sectionId} onChange={(e) => setViewing(e.target.value)}>
            {map.sections.map((s) => (
              <option key={s.sectionId} value={s.sectionId}>
                {`Section ${s.name}`}
              </option>
            ))}
          </select>
        </label>
        {/* Spec 015 FR-013: sold, reserved, and open, kept current by the stream. */}
        <p>{`${shown.sold} sold, ${shown.reserved.length} reserved, ${
          shown.rows * shown.seatsPerRow - shown.sold - shown.reserved.length
        } open`}</p>
        <SeatGrid section={shown} />
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
            <Link to={`/events/${event.id}/edit`}>Edit event</Link>.
          </p>
          {seatMap()}
        </>
      ) : (
        <p className="note">General admission.</p>
      )}
    </section>
  );
}
