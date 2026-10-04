import { useEffect, useRef, useState } from 'react';
import type { Location, SeatingLayout } from '@queuepass/shared';
import { ApiError } from '../api/client';
import { deleteLayout, getLayout, replaceLayout } from '../api/seating';
import { ErrorBanner } from './ErrorBanner';
import { SectionLines, toSectionInputs, type SectionLine } from './SectionLines';

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Any failure as an ApiError, so ErrorBanner can show it. */
const asApiError = (err: unknown): ApiError =>
  err instanceof ApiError
    ? err
    : new ApiError(0, {
        error: { code: 'VALIDATION_FAILED', message: "Can't reach the QueuePass service." },
      });

/**
 * Spec 007 US1 (FR-001, FR-003): a venue's seating layout, edited as a whole. The Backend
 * refuses a layout over the venue's capacity, or one that seated sales depend on.
 */
export function LayoutCard({ venue }: { venue: Location }): React.ReactElement {
  const [layout, setLayout] = useState<SeatingLayout | null | 'unavailable'>(null);
  const [lines, setLines] = useState<SectionLine[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getLayout(venue.id)
      .then((l) => !cancelled && setLayout(l))
      .catch(() => !cancelled && setLayout('unavailable'));
    return () => {
      cancelled = true;
    };
  }, [venue.id]);

  async function run(action: () => Promise<void>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(asApiError(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      const saved = await replaceLayout(venue.id, {
        sections: toSectionInputs(lines ?? []),
      });
      setLayout(saved);
      setLines(null);
    });

  const remove = () => {
    if (!window.confirm(`Remove the seating layout of "${venue.name}"?`)) return;
    void run(async () => {
      await deleteLayout(venue.id);
      setLayout({ locationId: venue.id, totalSeats: 0, sections: [] });
    });
  };

  return (
    <section className="card" aria-labelledby="layout-heading">
      <h2 id="layout-heading">Seating layout</h2>
      {error && <ErrorBanner error={error} title="Could not change the layout" />}
      {layout === null ? (
        <p className="loading">Loading layout…</p>
      ) : layout === 'unavailable' ? (
        <p className="note">The seating layout is unavailable right now.</p>
      ) : lines ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <SectionLines lines={lines} onChange={setLines} />
          <div className="form__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save layout'}
            </button>
            <button type="button" className="btn" onClick={() => setLines(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {layout.sections.length === 0 ? (
            <p className="note">No seating layout</p>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th>Size</th>
                      <th>Seats</th>
                    </tr>
                  </thead>
                  <tbody>
                    {layout.sections.map((s) => (
                      <tr key={s.id}>
                        <td className="cell-strong">{s.name}</td>
                        <td>{`${plural(s.rows, 'row', 'rows')} × ${plural(s.seatsPerRow, 'seat', 'seats')}`}</td>
                        <td className="cell-num">{(s.rows * s.seatsPerRow).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>{`Total: ${plural(layout.totalSeats, 'seat', 'seats')}`}</p>
            </>
          )}
          <div className="form__actions">
            <button
              type="button"
              className="btn"
              onClick={() =>
                setLines(
                  layout.sections.map((s) => ({
                    name: s.name,
                    rows: String(s.rows),
                    seatsPerRow: String(s.seatsPerRow),
                  })),
                )
              }
            >
              Edit layout
            </button>
            {layout.sections.length > 0 && (
              <button type="button" className="btn" onClick={remove} disabled={busy}>
                Remove layout
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
