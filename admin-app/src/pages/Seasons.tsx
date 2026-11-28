import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listSeasons, type Season } from '../api/seasons';
import { Notice } from '../components/Notice';
import { usd } from '../money';
import { seasonStatusText, sportTeamText } from './season-form-checks';

/**
 * Spec 041 FR-018 (research R11): every Season, with its venue, sport and team, number of
 * events, status (Draft, On sale, Presale until …, Sales ended, Cancelled), passes sold and pass
 * revenue. Ordered by the Backend (earliest event first).
 */
export function Seasons(): React.ReactElement {
  // The time is read when the Seasons arrive and kept with them, as the event list does (030).
  const [loaded, setLoaded] = useState<{ seasons: Season[]; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSeasons()
      .then((seasons) => !cancelled && setLoaded({ seasons, at: Date.now() }))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const seasons = loaded?.seasons ?? null;
  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">Seasons</h1>
          <p className="page-sub">
            {seasons
              ? `${seasons.length} season${seasons.length === 1 ? '' : 's'}`
              : error
                ? ''
                : 'Loading…'}
          </p>
        </div>
        <Link to="/seasons/new" className="btn btn--primary">
          <span aria-hidden="true">+</span> New season
        </Link>
      </div>

      <Notice />

      {error && (
        <div role="alert" className="banner banner--error">
          <span className="banner__icon" aria-hidden="true">
            ✕
          </span>
          <div className="banner__body">
            <strong>Could not load seasons</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <div className="card">
        {!seasons ? (
          !error && <p className="loading">Loading seasons…</p>
        ) : seasons.length === 0 ? (
          <div className="empty">
            <div className="empty__icon" aria-hidden="true">
              ◷
            </div>
            <p className="empty__title">No seasons yet</p>
            <p className="empty__body">
              Group upcoming events at one venue into a season to sell them as one pass.
            </p>
            <Link to="/seasons/new" className="btn btn--primary">
              New season
            </Link>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Season</th>
                  <th>Venue</th>
                  <th>Sport and team</th>
                  <th>Events</th>
                  <th>Status</th>
                  <th>Passes sold</th>
                  <th>Pass revenue</th>
                </tr>
              </thead>
              <tbody>
                {seasons.map((s) => (
                  <tr key={s.id}>
                    <td className="cell-strong">
                      <Link to={`/seasons/${s.id}`} className="rowlink">
                        {s.name}
                      </Link>
                    </td>
                    <td>
                      <span className="pill">{s.venueName}</span>
                    </td>
                    <td>{sportTeamText(s)}</td>
                    <td className="cell-num">{s.events.length}</td>
                    <td>{seasonStatusText(s, loaded!.at)}</td>
                    <td className="cell-num">{(s.passesSold ?? 0).toLocaleString()}</td>
                    <td className="price">{usd(s.passRevenue ?? '0.00')}</td>
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
