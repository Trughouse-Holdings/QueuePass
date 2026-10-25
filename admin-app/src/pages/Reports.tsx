import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DEFAULT_TIME_ZONE,
  formatEventDate,
  formatViewerTime,
  type SalesReport,
} from '@queuepass/shared';
import { getSalesReport } from '../api/reports';
import { usd } from '../money';

/** Spec 020 FR-022: an event's date in its venue's zone (research R12). */
const day = (iso: string, timeZone?: string): string =>
  formatEventDate(iso, timeZone ?? DEFAULT_TIME_ZONE);
const share = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

/** A thin sell-through bar. Decorative: the same figure is always written beside it. */
function Meter({ value, label }: { value: number; label: string }): React.ReactElement {
  return (
    <span className="meter" title={label} aria-hidden="true">
      {/* Nothing at zero: even a sliver would read as "some sold". */}
      {value > 0 && <span className="meter__fill" style={{ width: `${Math.min(100, value)}%` }} />}
    </span>
  );
}

/**
 * Spec 005 US2 (FR-005, FR-006): what's going on, right now. The Backend computes the report on
 * every request, so reloading the page always shows current figures.
 */
export function Reports(): React.ReactElement {
  const [report, setReport] = useState<SalesReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getSalesReport()
      .then(setReport)
      .catch(() => setFailed(true));
  }, []);

  if (failed)
    return (
      <p role="alert" className="banner banner--error">
        Can&apos;t reach the QueuePass service.
      </p>
    );
  if (!report) return <p className="loading">Loading report…</p>;
  const { totals } = report;
  const soldPct = share(totals.ticketsSold, totals.ticketCapacity);
  const checkedPct = share(totals.checkedIn, totals.ticketsSold);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-sub">
            Live sales across every event · as of{' '}
            {formatViewerTime(report.generatedAt, { date: true })}
          </p>
        </div>
      </div>

      <section className="stats" aria-labelledby="totals-heading">
        <h2 id="totals-heading" className="visually-hidden">
          Totals
        </h2>
        <div className="stat stat--hero">
          <p className="stat__label">Revenue</p>
          <p className="stat__value">{usd(totals.revenue)}</p>
          <p className="stat__note">Confirmed orders; refunds excluded</p>
        </div>
        <div className="stat">
          <p className="stat__label">Tickets sold</p>
          <p className="stat__value">
            {totals.ticketsSold.toLocaleString()} of {totals.ticketCapacity.toLocaleString()}
          </p>
          <Meter value={soldPct} label={`${soldPct}% of capacity sold`} />
          <p className="stat__note">{soldPct}% of capacity</p>
        </div>
        <div className="stat">
          <p className="stat__label">Checked in</p>
          <p className="stat__value">{totals.checkedIn.toLocaleString()}</p>
          <Meter value={checkedPct} label={`${checkedPct}% of tickets sold checked in`} />
          <p className="stat__note">{checkedPct}% of tickets sold</p>
        </div>
        <div className="stat">
          <p className="stat__label">Scheduled events</p>
          <p className="stat__value">{totals.events.toLocaleString()}</p>
          <p className="stat__note">Cancelled events not counted</p>
        </div>
      </section>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">By event</h2>
          <p className="card__sub">Soonest first</p>
        </div>
        {report.events.length === 0 ? (
          <p className="note">No events yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Venue</th>
                  <th>Date</th>
                  <th>Sold</th>
                  <th className="num-head">Revenue</th>
                  <th className="num-head">Checked in</th>
                </tr>
              </thead>
              <tbody>
                {report.events.map((e) => {
                  const pct = share(e.ticketsSold, e.ticketCapacity);
                  const cancelled = e.status === 'CANCELLED';
                  return (
                    <tr key={e.eventId} className={cancelled ? 'row--muted' : undefined}>
                      <td className="cell-strong">
                        <Link to={`/events/${e.eventId}`} className="rowlink">
                          {e.name}
                        </Link>{' '}
                        {cancelled && <span className="pill pill--danger">Cancelled</span>}
                      </td>
                      <td className="cell-muted">{e.venueName}</td>
                      <td className="cell-time">{day(e.startsAt, e.timeZone)}</td>
                      <td className="cell-meter">
                        <span className="cell-num">
                          {`${e.ticketsSold.toLocaleString()} of ${e.ticketCapacity.toLocaleString()} (${pct}%)`}
                        </span>
                        <Meter value={pct} label={`${pct}% sold`} />
                      </td>
                      <td className="price num">{usd(e.revenue)}</td>
                      <td className="cell-num num">{e.checkedIn.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
