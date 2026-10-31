import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  DEFAULT_TIME_ZONE,
  US_STATES,
  US_TIME_ZONES,
  ZIP_PATTERN,
  zoneName,
  type Location,
  type UsState,
  type UsTimeZone,
} from '@queuepass/shared';
import { venueZone } from '../format';
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

/**
 * Spec 013 FR-012: the address as saved, from the response; spec 020 R14: and its zone. Spec 024
 * FR-014 (research R6): a not-verified address gets a plain notice, not the success one, saying
 * why it matters and how to verify it later.
 */
const savedNotice = (v: Location): NoticeState['notice'] =>
  v.addressVerified
    ? { kind: 'success', text: `Venue saved. Address: ${v.address}. Time zone: ${venueZone(v)}.` }
    : {
        kind: 'info',
        text:
          `Venue saved, but its address is not verified: ${v.address}. ` +
          // Spec 024 research R16.4: a venue from before 013 is verified only by entering its
          // four fields; saving it again does not check its one-line address.
          (v.street == null
            ? 'To verify it, edit the venue and enter its street, city, state, and ZIP code. '
            : "The US address service couldn't confirm it, so check that it's right: customers " +
              'see this address and its map link. To verify it later, edit the venue and save ' +
              "it, correcting the address if it's wrong. ") +
          `Time zone: ${venueZone(v)}.`,
      };

const ZONE_CHANGE_NOTE =
  "Changing the time zone keeps each event's local time (7:00 PM stays 7:00 PM), so their times " +
  'move. Not possible once tickets are sold.';

const ZONE_REQUIRED = "Choose the venue's time zone.";

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
  const [layoutRefused, setLayoutRefused] = useState<{ venue: Location; error: ApiError } | null>(
    null,
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Spec 024 research R1: the zone in the select; '' (none chosen yet) only on New venue, where
  // one is required; on edit it starts on the stored zone.
  const [zoneChoice, setZoneChoice] = useState<UsTimeZone | ''>('');
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
        setZoneChoice(l.timeZone ?? DEFAULT_TIME_ZONE);
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
  }

  const addressChanged = !sameAsStored(address, loaded);
  const storedZone = loaded?.timeZone ?? DEFAULT_TIME_ZONE;
  // Spec 024 research R3: on edit the address is sent only when it changed from the venue as
  // loaded (a venue from before 013 whose fields were filled in included, research R13 of 013),
  // or when the loaded venue's address is not verified, so it is checked again (R7).
  const sendAddress =
    !isEdit || addressChanged || (loaded?.addressVerified === false && loaded.street != null);
  // Spec 024 R1, R3: the zone shown goes with the address, and the Backend records it as chosen
  // by an admin; said before saving when it was set another way.
  const recordsAdminZone =
    isEdit &&
    loaded !== null &&
    sendAddress &&
    zoneChoice === storedZone &&
    loaded.timeZoneSource !== 'ADMIN';

  async function save(): Promise<void> {
    setError(null);
    setLayoutRefused(null);

    // Spec 024 R1: one press names every problem: the address fields and the missing zone.
    const found = sendAddress ? addressProblems(address) : [];
    setProblems(found);
    const missingZone = !isEdit && !zoneChoice;
    setZoneProblem(missingZone ? ZONE_REQUIRED : null);
    if (found.length > 0 || missingZone) return;

    setBusy(true);
    const seated = !isEdit && kind === 'seated';
    const parts = {
      street: address.street,
      city: address.city,
      state: address.state as UsState,
      zip: address.zip.trim(),
      // Spec 024 FR-009 (research R4): every address sent is saved even if it can't be verified;
      // the Backend still checks it and decides whether it is.
      acceptUnverifiedAddress: true,
    };
    const sentParts = sendAddress ? parts : {};
    // Spec 024 R3: the zone on every create, with the address on an edit, and otherwise only
    // when the admin picked another one.
    const zonePart =
      zoneChoice && (sendAddress || zoneChoice !== storedZone) ? { timeZone: zoneChoice } : {};
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
            setLayoutRefused({ venue, error: err as ApiError });
            return;
          }
        }
      }
      navigate('/locations', { state: { notice: savedNotice(venue) } });
    } catch (err) {
      // FR-035: surface the rejection but keep every entered value — an admin should
      // never retype a whole form to correct one field.
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  // Spec 024 R1 (review round 1, minor 6): what is said under the select, in order, each also
  // naming the select for assistive technology.
  const zoneHints = [
    zoneProblem && { id: 'timeZone-problem', text: zoneProblem },
    !isEdit && {
      id: 'timeZone-hint',
      text: 'Event times at this venue are shown and entered in this zone.',
    },
    loaded && { id: 'timeZone-stored', text: `${venueZone(loaded)}.` },
    loaded &&
      addressChanged && {
        id: 'timeZone-address',
        text:
          "Changing the address doesn't change the time zone. Choose another zone here if the " +
          'venue is in a different one.',
      },
    recordsAdminZone && {
      id: 'timeZone-records',
      text: `Saving records ${zoneName(storedZone)} as chosen by an admin.`,
    },
    loaded &&
      hasEvents !== false &&
      zoneChoice &&
      zoneChoice !== storedZone && { id: 'timeZone-change', text: ZONE_CHANGE_NOTE },
  ].filter((h): h is { id: string; text: string } => Boolean(h));

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    void save();
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
      {layoutRefused && (
        <div role="alert" className="banner banner--error">
          <div className="banner__body">
            <strong>Seating layout not saved</strong>
            <p>{layoutRefused.error.envelope.error.message}</p>
            <p>
              The venue was created without its seating layout.{' '}
              <Link to={`/locations/${layoutRefused.venue.id}`}>Add the layout on its page</Link>
            </p>
            {/* Spec 024 research R16.5: the not-verified notice is not reached from here. */}
            {!layoutRefused.venue.addressVerified && (
              <p>
                {`Its address is saved but not verified: ${layoutRefused.venue.address}. The US ` +
                  "address service couldn't confirm it, so check that it's right."}
              </p>
            )}
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
            <p className="note">This address is not verified. Saving checks it again.</p>
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

          {/* Spec 024 FR-001 to FR-004 (research R1): the admin's pick, required on create. */}
          <div className="field">
            <label htmlFor="timeZone">Time zone</label>
            <select
              id="timeZone"
              value={zoneChoice}
              aria-invalid={zoneProblem ? true : undefined}
              aria-describedby={zoneHints.map((h) => h.id).join(' ') || undefined}
              onChange={(e) => {
                setZoneChoice(e.target.value as UsTimeZone | '');
                setZoneProblem(null);
              }}
            >
              {!isEdit && <option value="">Choose a time zone</option>}
              {US_TIME_ZONES.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
            {zoneHints.map((h) => (
              <span
                key={h.id}
                id={h.id}
                className="field__hint"
                role={h.id === 'timeZone-problem' ? 'alert' : undefined}
              >
                {h.text}
              </span>
            ))}
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
