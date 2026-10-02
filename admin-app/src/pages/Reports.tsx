import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SalesReport } from '@queuepass/shared';
import { getSalesReport } from '../api/reports';
import { usd } from '../money';

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const percent = (sold: number, capacity: number): string =>
  capacity > 0 ? `${Math.round((sold / capacity) * 100)}%` : '0%';

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

  if (failed) return <p role="alert">Can&apos;t reach the QueuePass service.</p>;
  if (!report) return <p className="loading">Loading report…</p>;
  const { totals } = report;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-sub">As of {new Date(report.generatedAt).toLocaleString()}</p>
        </div>
      </div>

      <section className="card" aria-labelledby="totals-heading">
        <h2 id="totals-heading">Totals</h2>
        <dl>
          <dt>Scheduled events</dt>
          <dd className="cell-num">{totals.events.toLocaleString()}</dd>
          <dt>Tickets sold</dt>
          <dd className="cell-num">
            {totals.ticketsSold.toLocaleString()} of {totals.ticketCapacity.toLocaleString()}
          </dd>
          <dt>Revenue</dt>
          <dd className="price">{usd(totals.revenue)}</dd>
          <dt>Checked in</dt>
          <dd className="cell-num">{totals.checkedIn.toLocaleString()}</dd>
        </dl>
      </section>

      <div className="card">
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
                  <th>Revenue</th>
                  <th>Checked in</th>
                </tr>
              </thead>
              <tbody>
                {report.events.map((e) => (
                  <tr key={e.eventId}>
                    <td className="cell-strong">
                      <Link to={`/events/${e.eventId}`} className="rowlink">
                        {e.name}
                      </Link>{' '}
                      {e.status === 'CANCELLED' && <span className="pill">Cancelled</span>}
                    </td>
                    <td>{e.venueName}</td>
                    <td className="cell-time">{day(e.startsAt)}</td>
                    <td className="cell-num">
                      {`${e.ticketsSold.toLocaleString()} of ${e.ticketCapacity.toLocaleString()} (${percent(e.ticketsSold, e.ticketCapacity)})`}
                    </td>
                    <td className="price">{usd(e.revenue)}</td>
                    <td className="cell-num">{e.checkedIn.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
