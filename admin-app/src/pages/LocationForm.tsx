import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createLocation, getLocation, updateLocation } from '../api/locations';
import { getLayout, replaceLayout } from '../api/seating';
import { ApiError } from '../api/client';
import { ErrorBanner } from '../components/ErrorBanner';
import {
  SectionLines,
  toSectionInputs,
  totalSeats,
  type SectionLine,
} from '../components/SectionLines';
import { SuccessState } from '../components/SuccessState';

/** FR-031, FR-033, FR-035 — create/edit a venue. No removal control (API-only). */
export function LocationForm(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [seatingCapacity, setSeatingCapacity] = useState('');
  // Spec 007 FR-017: a venue with a seating layout takes its capacity from it.
  const [setByLayout, setSetByLayout] = useState(false);
  // Spec 008 US5: a new venue is seated (sections, capacity calculated) or general admission.
  const [kind, setKind] = useState<'general' | 'seated'>('general');
  const [lines, setLines] = useState<SectionLine[]>([]);
  const [layoutRefused, setLayoutRefused] = useState<{ venueId: string; error: ApiError } | null>(
    null,
  );
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
    getLayout(id)
      .then((layout) => setSetByLayout(layout.sections.length > 0))
      .catch(() => setSetByLayout(false));
  }, [id]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLayoutRefused(null);
    setSaved(false);
    setBusy(true);

    const seated = !isEdit && kind === 'seated';
    const payload = {
      name,
      address,
      // Spec 008 R8: the contract needs a capacity; the layout saved next sets it for good.
      seatingCapacity: seated ? totalSeats(lines) : Number(seatingCapacity),
    };

    try {
      // Spec 007 FR-017: a laid-out venue's capacity is never sent; its layout sets it.
      if (isEdit && id) await updateLocation(id, setByLayout ? { name, address } : payload);
      else {
        const venue = await createLocation(payload);
        if (seated) {
          try {
            await replaceLayout(venue.id, { sections: toSectionInputs(lines) });
          } catch (err) {
            // The venue exists; only its layout was refused. Say so, and where to add it.
            setLayoutRefused({ venueId: venue.id, error: err as ApiError });
            return;
          }
        }
      }
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
      {layoutRefused && (
        <div role="alert" className="banner banner--error">
          <div className="banner__body">
            <strong>Seating layout not saved</strong>
            <p>{layoutRefused.error.envelope.error.message}</p>
            <p>
              The venue was created without its seating layout.{' '}
              <Link to={`/locations/${layoutRefused.venueId}`}>Add the layout on its page</Link>
            </p>
          </div>
        </div>
      )}

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

          {!isEdit && (
            <fieldset className="field">
              <legend>Seating</legend>
              <label className="choice">
                <input
                  type="radio"
                  name="kind"
                  checked={kind === 'general'}
                  onChange={() => setKind('general')}
                />
                General admission
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="kind"
                  checked={kind === 'seated'}
                  onChange={() => setKind('seated')}
                />
                Seated
              </label>
            </fieldset>
          )}

          {!isEdit && kind === 'seated' ? (
            <>
              <SectionLines lines={lines} onChange={setLines} />
              <p className="note">{`Total: ${totalSeats(lines).toLocaleString()} ${
                totalSeats(lines) === 1 ? 'seat' : 'seats'
              }`}</p>
            </>
          ) : setByLayout ? (
            <p className="note">
              {`Seating capacity: ${Number(seatingCapacity).toLocaleString()}, set by its seating layout.`}
            </p>
          ) : (
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
                An event scheduled here cannot sell more tickets than this. A seating layout, once
                added on the venue page, sets it instead.
              </span>
            </div>
          )}

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
