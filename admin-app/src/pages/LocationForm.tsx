import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createLocation, getLocation, updateLocation } from '../api/locations';
import { ApiError } from '../api/client';
import { ErrorBanner } from '../components/ErrorBanner';
import { SuccessState } from '../components/SuccessState';

/** FR-031, FR-033, FR-035 — create/edit a venue. No removal control (API-only). */
export function LocationForm(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [seatingCapacity, setSeatingCapacity] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    getLocation(id)
      .then((l) => {
        setName(l.name);
        setAddress(l.address);
        setSeatingCapacity(String(l.seatingCapacity));
      })
      .catch((err: ApiError) => setError(err));
  }, [id]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);

    const payload = { name, address, seatingCapacity: Number(seatingCapacity) };

    try {
      if (isEdit && id) await updateLocation(id, payload);
      else await createLocation(payload);
      setSaved(true);
      setTimeout(() => navigate('/locations'), 700);
    } catch (err) {
      // FR-035: surface the rejection but keep every entered value — an admin should
      // never retype a whole form to correct one field.
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">{isEdit ? 'Edit venue' : 'New venue'}</h1>
          <p className="page-sub">Name, address, and how many seats it holds.</p>
        </div>
      </div>

      {saved && <SuccessState message="Venue saved." />}
      {error && <ErrorBanner error={error} />}

      <div className="card">
        <form className="form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              value={name}
              placeholder="KFC Yum! Center"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="address">Address</label>
            <input
              id="address"
              value={address}
              placeholder="1 Arena Plaza, Louisville, KY"
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="seatingCapacity">Seating capacity</label>
            <input
              id="seatingCapacity"
              type="number"
              min={1}
              value={seatingCapacity}
              placeholder="22090"
              onChange={(e) => setSeatingCapacity(e.target.value)}
            />
            <span className="field__hint">
              An event scheduled here cannot sell more tickets than this.
            </span>
          </div>

          <div className="form__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create venue'}
            </button>
            <Link to="/locations" className="btn btn--ghost">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}
