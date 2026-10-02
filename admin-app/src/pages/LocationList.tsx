import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Location } from '@queuepass/shared';
import { listLocations } from '../api/locations';
import { Notice } from '../components/Notice';

/**
 * Spec 002 FR-024 — the venue list; spec 004 US3 — search by name or address, kept in the
 * address (FR-008). Delete lives on the venue page (spec 002 research R3).
 */
export function LocationList(): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLocations(null);
    listLocations(q.trim() || undefined)
      .then((l) => !cancelled && setLocations(l))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [q]);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    setParams(t ? { q: t } : {});
  };

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">Venues</h1>
          <p className="page-sub">
            {locations
              ? `${locations.length} venue${locations.length === 1 ? '' : 's'} ${q ? 'match' : 'on file'}`
              : 'Loading…'}
          </p>
        </div>
        <Link to="/locations/new" className="btn btn--primary">
          <span aria-hidden="true">+</span> Add venue
        </Link>
      </div>

      <Notice />

      <form role="search" className="card form" onSubmit={search}>
        <div className="field-row">
          <label className="field">
            Search venues
            <input
              type="search"
              value={text}
              maxLength={200}
              placeholder="Name or address, such as a city"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        </div>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary">
            Search
          </button>
          {q && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setText('');
                setParams({});
              }}
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {error && (
        <div role="alert" className="banner banner--error">
          <span className="banner__icon" aria-hidden="true">
            ✕
          </span>
          <div className="banner__body">
            <strong>Could not load venues</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <div className="card">
        {!locations ? (
          <p className="loading">Loading venues…</p>
        ) : locations.length === 0 && q ? (
          <div className="empty">
            <p className="empty__title">No venues match &quot;{q}&quot;.</p>
          </div>
        ) : locations.length === 0 ? (
          <div className="empty">
            <div className="empty__icon" aria-hidden="true">
              ◇
            </div>
            <p className="empty__title">No venues yet</p>
            <p className="empty__body">Add one to start scheduling events.</p>
            <Link to="/locations/new" className="btn btn--primary">
              Add venue
            </Link>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th>Seating capacity</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {locations.map((l) => (
                  <tr key={l.id}>
                    <td className="cell-strong">
                      <Link to={`/locations/${l.id}`} className="rowlink">
                        {l.name}
                      </Link>
                    </td>
                    <td className="cell-muted">{l.address}</td>
                    <td className="cell-num">{l.seatingCapacity.toLocaleString()}</td>
                    <td className="cell-action">
                      <Link to={`/locations/${l.id}/edit`} className="rowlink">
                        Edit
                      </Link>
                    </td>
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
