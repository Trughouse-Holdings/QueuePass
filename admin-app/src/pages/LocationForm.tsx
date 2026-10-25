import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  DEFAULT_TIME_ZONE,
  STATE_TIME_ZONES,
  US_STATES,
  US_TIME_ZONES,
  ZIP_PATTERN,
  zoneName,
  type Location,
  type UsState,
  type UsTimeZone,
} from '@queuepass/shared';
import { SOURCE_TEXT, venueZone } from '../format';
import { listEvents } from '../api/events';
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
import type { NoticeState } from '../hooks/use-delete';

/** Spec 013 FR-011: the only refusals that offer "Save anyway". */
const SAVE_ANYWAY_CODES = ['ADDRESS_NOT_FOUND', 'ADDRESS_AMBIGUOUS'];

interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
}
const EMPTY: Address = { street: '', city: '', state: '', zip: '' };

/**
 * Spec 013 FR-013: a preview of the Backend's field rules, naming each problem. The Backend
 * still decides (FR-018).
 */
function addressProblems(a: Address): string[] {
  const problems: string[] = [];
  if (!a.street.trim()) problems.push('Street address is required.');
  if (!a.city.trim()) problems.push('City is required.');
  if (!a.state) problems.push('Choose a state.');
  if (!ZIP_PATTERN.test(a.zip.trim())) {
    problems.push('ZIP code must be 5 digits, or 5 digits, a hyphen, and 4 digits.');
  }
  return problems;
}

/** Spec 013 FR-012: the address as saved, from the response; spec 020 R14: and its zone. */
const savedNotice = (v: Location): NoticeState['notice'] => ({
  kind: 'success',
  text:
    (v.addressVerified
      ? `Venue saved. Address: ${v.address}.`
      : `Venue saved. Address (not verified): ${v.address}.`) + ` Time zone: ${venueZone(v)}.`,
});

const ZONE_CHANGE_NOTE =
  "Changing the time zone keeps each event's local time (7:00 PM stays 7:00 PM), so their times " +
  'move. Not possible once tickets are sold.';

const stateName = (code: string): string => US_STATES.find((s) => s.code === code)?.name ?? code;

/** Spec 013 FR-008's "same address", on the form's side: ignoring case and extra spaces. */
function sameAsStored(a: Address, v: Location | null): boolean {
  if (!v || v.street == null) return Object.values(a).every((x) => x.trim() === '');
  const norm = (s: string | null | undefined) =>
    (s ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return (
    norm(a.street) === norm(v.street) &&
    norm(a.city) === norm(v.city) &&
    a.state === v.state &&
    a.zip.trim().slice(0, 5) === v.zip
  );
}

/** FR-031, FR-033, FR-035 — create/edit a venue. No removal control (API-only). */
export function LocationForm(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [name, setName] = useState('');
  const [address, setAddress] = useState<Address>(EMPTY);
  const [seatingCapacity, setSeatingCapacity] = useState('');
  // Spec 013 research R13: the venue as loaded, for the not-verified notes on edit.
  const [loaded, setLoaded] = useState<Location | null>(null);
  // Spec 007 FR-017: a venue with a seating layout takes its capacity from it.
  const [setByLayout, setSetByLayout] = useState(false);
  // Spec 008 US5: a new venue is seated (sections, capacity calculated) or general admission.
  const [kind, setKind] = useState<'general' | 'seated'>('general');
  const [lines, setLines] = useState<SectionLine[]>([]);
  const [layoutRefused, setLayoutRefused] = useState<{ venueId: string; error: ApiError } | null>(
    null,
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  // Spec 013 FR-011: offered only after a not-found or ambiguous refusal of this address.
  const [offerSaveAnyway, setOfferSaveAnyway] = useState(false);
  const [busy, setBusy] = useState(false);
  // Spec 020 research R14: an explicit zone ('' works it out), and a split state's choice.
  const [zoneChoice, setZoneChoice] = useState<UsTimeZone | ''>('');
  const [stateZone, setStateZone] = useState<UsTimeZone | ''>('');
  /** The zones of a TIME_ZONE_REQUIRED refusal, until the state changes. */
  const [requiredZones, setRequiredZones] = useState<UsTimeZone[] | null>(null);
  const [zoneProblem, setZoneProblem] = useState<string | null>(null);
  /** Spec 020 R14: whether the venue has events (null while unknown: the note is shown). */
  const [hasEvents, setHasEvents] = useState<boolean | null>(null);

  useEffect(() => {
    if (!id) return;
    getLocation(id)
      .then((l) => {
        setLoaded(l);
        setName(l.name);
        // A venue from before 013 has no parts: its fields start empty (research R13).
        setAddress({
          street: l.street ?? '',
          city: l.city ?? '',
          state: l.state ?? '',
          zip: l.zip ?? '',
        });
        setSeatingCapacity(String(l.seatingCapacity));
      })
      .catch((err: ApiError) => setError(err));
    getLayout(id)
      .then((layout) => setSetByLayout(layout.sections.length > 0))
      .catch(() => setSetByLayout(false));
    listEvents({ locationId: id })
      .then((events) => setHasEvents(events.length > 0))
      .catch(() => setHasEvents(null));
  }, [id]);

  // Spec 013 US4: a venue from before 013 has a one-line address and no parts.
  const legacy = loaded !== null && loaded.street == null;

  function changeAddress(key: keyof Address, value: string): void {
    setAddress((a) => ({ ...a, [key]: value }));
    // The confirmation applies only to the address the admin saw refused.
    setOfferSaveAnyway(false);
    // Spec 020 R14: a split state's choice belongs to that state.
    if (key === 'state') {
      setStateZone('');
      setRequiredZones(null);
      setZoneProblem(null);
    }
  }

  // Spec 020 FR-003 (research R14): the state's zones, asked when Save anyway is offered in a
  // split state, or after TIME_ZONE_REQUIRED.
  const splitZones =
    requiredZones ??
    (offerSaveAnyway && (STATE_TIME_ZONES[address.state as UsState]?.length ?? 0) > 1
      ? [...STATE_TIME_ZONES[address.state as UsState]]
      : null);
  // On edit, the stored zone starts selected when it is one of them (review round 1, m4).
  const storedInState =
    splitZones && loaded?.timeZone && splitZones.includes(loaded.timeZone) ? loaded.timeZone : '';
  const chosenStateZone = splitZones ? stateZone || storedInState : '';
  const addressChanged = !sameAsStored(address, loaded);

  async function save(acceptUnverifiedAddress: boolean): Promise<void> {
    if (acceptUnverifiedAddress && splitZones && !zoneChoice && !chosenStateZone) {
      setZoneProblem("Choose this venue's time zone first.");
      return;
    }
    setZoneProblem(null);
    setError(null);
    setLayoutRefused(null);
    setOfferSaveAnyway(false);

    // A venue from before 013 may keep its old address: the four fields are sent only once one
    // is filled in, and then all four are needed (research R13).
    const sendAddress = !legacy || Object.values(address).some((v) => v.trim() !== '');
    const found = sendAddress ? addressProblems(address) : [];
    setProblems(found);
    if (found.length > 0) return;

    setBusy(true);
    const seated = !isEdit && kind === 'seated';
    const parts = {
      street: address.street,
      city: address.city,
      state: address.state as UsState,
      zip: address.zip.trim(),
      ...(acceptUnverifiedAddress ? { acceptUnverifiedAddress: true } : {}),
    };
    const sentParts = sendAddress ? parts : {};
    // Spec 020 R4: a zone is sent only when the admin picked one, in the select or for the state.
    const zone = zoneChoice || chosenStateZone;
    const zonePart = zone ? { timeZone: zone } : {};
    // Spec 008 R8: the contract needs a capacity; the layout saved next sets it for good.
    const capacity = seated ? totalSeats(lines) : Number(seatingCapacity);

    try {
      let venue: Location;
      // Spec 007 FR-017: a laid-out venue's capacity is never sent; its layout sets it.
      if (isEdit && id) {
        venue = await updateLocation(
          id,
          setByLayout
            ? { name, ...sentParts, ...zonePart }
            : { name, ...sentParts, ...zonePart, seatingCapacity: capacity },
        );
      } else {
        venue = await createLocation({ name, ...parts, ...zonePart, seatingCapacity: capacity });
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
      navigate('/locations', { state: { notice: savedNotice(venue) } });
    } catch (err) {
      // FR-035: surface the rejection but keep every entered value — an admin should
      // never retype a whole form to correct one field.
      const refusal = err as ApiError;
      setError(refusal);
      // Spec 020 R14: after TIME_ZONE_REQUIRED, the state's zones are asked, and a save anyway
      // that was refused for it is offered again.
      if (refusal.code === 'TIME_ZONE_REQUIRED') {
        setRequiredZones((refusal.details?.timeZones as UsTimeZone[] | undefined) ?? null);
      }
      setOfferSaveAnyway(
        SAVE_ANYWAY_CODES.includes(refusal.code) ||
          (refusal.code === 'TIME_ZONE_REQUIRED' && acceptUnverifiedAddress),
      );
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    void save(false);
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">{isEdit ? 'Edit venue' : 'New venue'}</h1>
          <p className="page-sub">Name, address, and how many seats it holds.</p>
        </div>
      </div>

      {problems.length > 0 && (
        <div role="alert" className="banner banner--error">
          <span className="banner__icon" aria-hidden="true">
            ✕
          </span>
          <div className="banner__body">
            <strong>Check the address</strong>
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {error && <ErrorBanner error={error} />}
      {offerSaveAnyway && (
        <div className="form__actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void save(true)}>
            Save anyway (address not verified)
          </button>
          <p className="note">
            Use this only if you are sure the address is right. The venue will be marked not
            verified.
          </p>
        </div>
      )}
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

          {legacy && loaded && (
            <p className="note">
              {`Current address (not verified): ${loaded.address}. Enter it below to verify it.`}
            </p>
          )}
          {!legacy && loaded?.addressVerified === false && (
            <p className="note">This address is not verified.</p>
          )}

          <div className="field">
            <label htmlFor="street">Street address</label>
            <input
              id="street"
              autoComplete="address-line1"
              value={address.street}
              placeholder="430 W Vine St"
              onChange={(e) => changeAddress('street', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="city">City</label>
            <input
              id="city"
              autoComplete="address-level2"
              value={address.city}
              placeholder="Lexington"
              onChange={(e) => changeAddress('city', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="state">State</label>
            <select
              id="state"
              autoComplete="address-level1"
              value={address.state}
              onChange={(e) => changeAddress('state', e.target.value)}
            >
              <option value="">Choose a state</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {`${s.name} (${s.code})`}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="zip">ZIP code</label>
            <input
              id="zip"
              inputMode="numeric"
              autoComplete="postal-code"
              value={address.zip}
              placeholder="40507"
              onChange={(e) => changeAddress('zip', e.target.value)}
            />
          </div>

          {/* Spec 020 FR-004, FR-024 (research R4, R14): worked out unless the admin picks one. */}
          <div className="field">
            <label htmlFor="timeZone">Time zone</label>
            <select
              id="timeZone"
              value={zoneChoice}
              onChange={(e) => setZoneChoice(e.target.value as UsTimeZone | '')}
            >
              <option value="">
                {!loaded
                  ? 'Work it out from the address'
                  : addressChanged
                    ? 'Work it out from the new address'
                    : `Keep ${zoneName(loaded.timeZone ?? DEFAULT_TIME_ZONE)} (${SOURCE_TEXT[loaded.timeZoneSource ?? 'DEFAULT']})`}
              </option>
              {US_TIME_ZONES.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
            {loaded &&
              hasEvents !== false &&
              zoneChoice &&
              zoneChoice !== (loaded.timeZone ?? DEFAULT_TIME_ZONE) && (
                <span className="field__hint">{ZONE_CHANGE_NOTE}</span>
              )}
          </div>

          {splitZones && (
            <fieldset className="field">
              <legend>{`${stateName(address.state)} has more than one time zone. Choose this venue's time zone:`}</legend>
              {splitZones.map((z) => (
                <label key={z} className="choice">
                  <input
                    type="radio"
                    name="stateZone"
                    checked={chosenStateZone === z}
                    onChange={() => {
                      setStateZone(z);
                      setZoneProblem(null);
                    }}
                  />
                  {zoneName(z)}
                </label>
              ))}
              {zoneProblem && <span className="field__hint">{zoneProblem}</span>}
            </fieldset>
          )}

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
