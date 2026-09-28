import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Location } from '@queuepass/shared';
import { listLocations } from '../api/locations';
import { Notice } from '../components/Notice';

/** Spec 002 FR-024 — the venue list. Delete lives on the venue page (spec 002 research R3). */
export function LocationList(): React.ReactElement {
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listLocations()
      .then(setLocations)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">Venues</h1>
          <p className="page-sub">
            {locations
              ? `${locations.length} venue${locations.length === 1 ? '' : 's'} on file`
              : 'Loading…'}
          </p>
        </div>
        <Link to="/locations/new" className="btn btn--primary">
          <span aria-hidden="true">+</span> Add venue
        </Link>
      </div>

      <Notice />

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
