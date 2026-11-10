import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Availability, Event } from '@queuepass/shared';
import { ImageGallery, ServiceUnreachable } from '@queuepass/shared/web';
import { GetTickets } from '../components/GetTickets';
import { count, doorsOpen, hasEnded, usd, when } from '../format';
import { useLoad } from '../use-load';

/**
 * Spec 003 FR-005, US2-4: one event, with a way to its venue. Spec 006: and a way to get tickets,
 * the only write the Customer app makes (FR-009).
 */
export function EventDetail() {
  const { id = '' } = useParams();
  // Spec 030 research R7: the time is read once, when the event loads, and kept with it.
  const load = useLoad<{ event: Event; loadedAt: number }>(`event:${id}`, async (api) => {
    const { data, response } = await api.GET('/events/{id}', { params: { path: { id } } });
    return { response, data: data && { event: data, loadedAt: Date.now() } };
  });
  // Spec 034 FR-017 (research R4): the Get tickets panel's last answer about sales, by the
  // Backend's clock. An answer saying STARTED or without inProgress (a Backend from before 034)
  // counts as no answer.
  const [sales, setSales] = useState<Pick<
    Availability,
    'eventId' | 'salesClosed' | 'inProgress'
  > | null>(null);
  const onSales = useCallback((a: Availability) => {
    if (typeof a.inProgress !== 'boolean' || (a.salesClosed as string) === 'STARTED') return;
    setSales({ eventId: a.eventId, salesClosed: a.salesClosed, inProgress: a.inProgress });
  }, []);

  if (load.kind === 'loading') return <p>Loading…</p>;
  if (load.kind === 'unreachable') return <ServiceUnreachable />;
  if (load.kind === 'missing') {
    return (
      <section>
        <p>This event is no longer available.</p>
        <Link to="/events">Back to events</Link>
      </section>
    );
  }

  const e = load.data.event;
  // Spec 030 FR-014 (research R7): past by the browser's clock when the event loaded; spec 034
  // FR-017: once the panel has answered, its answer decides, never "ended" while in progress, and
  // a cancelled event (CANCELLED whatever the time) still needs the browser's clock.
  const byClock = hasEnded(e.endsAt, load.data.loadedAt);
  const answer = sales?.eventId === e.id ? sales : null;
  const ended =
    answer === null
      ? byClock
      : !answer.inProgress &&
        (answer.salesClosed === 'ENDED' || (answer.salesClosed === 'CANCELLED' && byClock));
  return (
    <section>
      {/* Spec 014 FR-021: the event's images across the full width of the app, above its name. */}
      {e.images && e.images.length > 0 && (
        <div className="page-band">
          <ImageGallery eventId={e.id} eventName={e.name} images={e.images} variant="page" />
        </div>
      )}
      <h1 className="page-title">{e.name}</h1>
      {/* Spec 005 FR-012: a cancelled event stays visible, clearly marked. */}
      {e.status === 'CANCELLED' && (
        <p>
          <strong>This event has been cancelled.</strong>
        </p>
      )}
      {/* Spec 030 FR-014 (research R7): a past event's page still opens, and says so. */}
      {ended && (
        <p>
          <strong>This event has ended.</strong>
        </p>
      )}
      <div className="card">
        <dl>
          <dt>Venue</dt>
          <dd>
            <Link to={`/venues/${e.locationId}`}>{e.location.name}</Link>
          </dd>
          {e.doorsOpenAt && (
            <>
              <dt>Doors open</dt>
              <dd>{doorsOpen(e.startsAt, e.doorsOpenAt, e.location.timeZone)}</dd>
            </>
          )}
          <dt>Starts</dt>
          <dd>{when(e.startsAt, e.location.timeZone)}</dd>
          <dt>Ends</dt>
          <dd>{when(e.endsAt, e.location.timeZone)}</dd>
          <dt>Tickets</dt>
          <dd>{count(e.totalTicketCapacity)}</dd>
          <dt>Base price</dt>
          <dd>{usd(e.basePrice)}</dd>
        </dl>
      </div>
      <GetTickets event={e} onSales={onSales} />
      <Link to="/events">All events</Link>
    </section>
  );
}
