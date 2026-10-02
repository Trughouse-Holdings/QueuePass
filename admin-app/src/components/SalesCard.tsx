import { useEffect, useState } from 'react';
import type { EventSales } from '@queuepass/shared';
import { getSalesReport } from '../api/reports';
import { usd } from '../money';

/**
 * Spec 005 FR-006: one event's sales, with each tier broken out. Read from the sales report,
 * which is small enough at this scale to fetch whole (research R6). Shows nothing if the report
 * cannot be loaded: the rest of the event page still works.
 */
export function SalesCard({ eventId }: { eventId: string }): React.ReactElement | null {
  const [sales, setSales] = useState<EventSales | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSalesReport()
      .then((r) => !cancelled && setSales(r.events.find((e) => e.eventId === eventId) ?? null))
      .catch(() => !cancelled && setSales(null));
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (!sales) return null;
  return (
    <section className="card" aria-labelledby="sales-heading">
      <h2 id="sales-heading">Sales</h2>
      <p>
        {`${sales.ticketsSold.toLocaleString()} of ${sales.ticketCapacity.toLocaleString()} tickets sold`}
      </p>
      <p className="price">{usd(sales.revenue)}</p>
      <p className="note">{`${sales.checkedIn.toLocaleString()} checked in`}</p>
      {sales.tiers.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tier</th>
                <th>Sold</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {sales.tiers.map((t) => (
                <tr key={t.tierId}>
                  <td className="cell-strong">{t.name}</td>
                  <td className="cell-num">{`${t.ticketsSold.toLocaleString()} of ${t.quantity.toLocaleString()}`}</td>
                  <td className="price">{usd(t.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
