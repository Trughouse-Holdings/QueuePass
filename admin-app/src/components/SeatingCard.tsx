import { useEffect, useRef, useState } from 'react';
import type { Event, SeatMap, TicketTier } from '@queuepass/shared';
import { applySeatChange, useSeatStream } from '@queuepass/shared/web';
import { ApiError, accessToken, api } from '../api/client';
import { getAvailability, getSeatMap, updateSeating } from '../api/seating';
import { listTiers } from '../api/tiers';
import { ErrorBanner } from './ErrorBanner';
import { SeatGrid } from './SeatGrid';

type Load =
  | { kind: 'loading' }
  | { kind: 'ok'; map: SeatMap; tiers: TicketTier[]; hasSales: boolean }
  | { kind: 'unavailable' };

const asApiError = (err: unknown): ApiError =>
  err instanceof ApiError
    ? err
    : new ApiError(0, {
        error: { code: 'VALIDATION_FAILED', message: "Can't reach the QueuePass service." },
      });

/**
 * Spec 007 US4 (FR-002, FR-004, FR-012): reserved seating on or off, each section's tier, and
 * the seat map. The Backend refuses switching after sales and retiering sold sections; this card
 * only explains the refusals in advance. Spec 015 FR-010 (research R14): the seat map and its
 * counts update live, from the same stream customers read.
 */
export function SeatingCard({
  event,
  onSaved,
}: {
  event: Event;
  /** Tells the event page that capacity and tier amounts may have changed (revision R11). */
  onSaved?: () => void;
}): React.ReactElement {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [reserved, setReserved] = useState(false);
  const [tierOf, setTierOf] = useState<Record<string, string>>({});
  const [viewing, setViewing] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // Spec 015: live changes and catch-up snapshots go into the map shown; the form's own state
  // (the switch and each section's tier) is left as the admin set it.
  const live = useSeatStream(event.id, {
    api,
    getToken: accessToken,
    onChange: (change) =>
      setLoad((l) => (l.kind === 'ok' ? { ...l, map: applySeatChange(l.map, change) } : l)),
    onSnapshot: (map) => setLoad((l) => (l.kind === 'ok' ? { ...l, map } : l)),
  });

  const liveMap = useRef<SeatMap | null>(null);
  liveMap.current = live.map;

  useEffect(() => {
    let cancelled = false;
    Promise.all([getSeatMap(event.id), listTiers(event.id), getAvailability(event.id)])
      .then(([loaded, tiers, left]) => {
        if (cancelled) return;
        // Changes may have arrived while this loaded: the stream's map already has them.
        const map = liveMap.current ?? loaded;
        setLoad({ kind: 'ok', map, tiers, hasSales: left.ticketsLeft < event.totalTicketCapacity });
        adopt(map);
      })
      .catch(() => !cancelled && setLoad({ kind: 'unavailable' }));
    return () => {
      cancelled = true;
    };
  }, [event.id, event.totalTicketCapacity]);

  function adopt(map: SeatMap): void {
    setReserved(map.reservedSeating);
    setTierOf(
      Object.fromEntries(map.sections.filter((s) => s.tierId).map((s) => [s.sectionId, s.tierId!])),
    );
  }

  async function save(): Promise<void> {
    if (busyRef.current || load.kind !== 'ok') return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const map = await updateSeating(event.id, {
        reservedSeating: reserved,
        sections: Object.entries(tierOf)
          .filter(([, tierId]) => tierId)
          .map(([sectionId, tierId]) => ({ sectionId, tierId })),
      });
      setLoad({ ...load, map });
      adopt(map);
      onSaved?.();
    } catch (err) {
      setError(asApiError(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const body = (): React.ReactNode => {
    if (load.kind === 'loading') return <p className="loading">Loading seating…</p>;
    if (load.kind === 'unavailable') {
      return <p className="note">Seating is unavailable right now.</p>;
    }
    const { map, tiers, hasSales } = load;
    const noLayout = map.sections.length === 0;
    const reason = noLayout
      ? 'This venue has no seating layout.'
      : hasSales
        ? "Seats can't change after tickets are sold."
        : null;
    const shown = map.sections.find((s) => s.sectionId === viewing) ?? map.sections[0];

    return (
      <>
        <label>
          <input
            type="checkbox"
            checked={reserved}
            disabled={reason !== null}
            onChange={(e) => setReserved(e.target.checked)}
          />{' '}
          Reserved seating
        </label>
        {reason && <p className="note">{reason}</p>}

        {reserved && tiers.length > 0 && (
          <div className="form__row">
            {map.sections.map((s) => (
              <label key={s.sectionId}>
                {`Section ${s.name} tier `}
                <select
                  aria-label={`Section ${s.name} tier`}
                  value={tierOf[s.sectionId] ?? ''}
                  onChange={(e) => setTierOf({ ...tierOf, [s.sectionId]: e.target.value })}
                >
                  <option value="">Not for sale</option>
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        {!noLayout && (
          <div className="form__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : 'Save seating'}
            </button>
          </div>
        )}

        {/* FR-006: a tier with no section sells nothing; say so instead of letting it look on sale. */}
        {map.reservedSeating &&
          tiers
            .filter((t) => !map.sections.some((s) => s.tierId === t.id))
            .map((t) => (
              <p key={t.id} className="note">
                {`${t.name} has no section, so it sells nothing. Choose a tier for a section above.`}
              </p>
            ))}

        {map.reservedSeating && shown && (
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
        )}
      </>
    );
  };

  return (
    <section className="card" aria-labelledby="seating-heading">
      <h2 id="seating-heading">Seating</h2>
      {error && <ErrorBanner error={error} title="Could not change seating" />}
      {body()}
    </section>
  );
}
