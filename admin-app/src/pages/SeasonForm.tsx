import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  DEFAULT_TIME_ZONE,
  formatEventTime,
  toLocalDateTime,
  type Event,
  type LayoutSummary,
  type Location,
  type UsTimeZone,
} from '@queuepass/shared';
import { ApiError } from '../api/client';
import { listEvents } from '../api/events';
import { getVenueLayout, listVenueLayouts } from '../api/layouts';
import { listLocations } from '../api/locations';
import {
  cancelSeason,
  createSeason,
  deleteSeason,
  getSeason,
  publishSeason,
  updateSeason,
  type Season,
} from '../api/seasons';
import { listTiers } from '../api/tiers';
import { Notice } from '../components/Notice';
import { SuccessState } from '../components/SuccessState';
import { useDelete } from '../hooks/use-delete';
import { usd } from '../money';
import { DateTimeFields } from './DateTimeFields';
import {
  GENERAL_ADMISSION,
  SPORTS,
  byName,
  firstErrorKey,
  focusIdFor,
  pickableEvents,
  placeSeasonErrors,
  previewSeason,
  priceKeys,
  sameDraft,
  seasonStatusText,
  tierKey,
  toSeasonInput,
  type PickerEvent,
  type SeasonDraft,
} from './season-form-checks';

const EMPTY: SeasonDraft = {
  name: '',
  locationId: '',
  layout: '',
  sport: '',
  team: '',
  salesEndAt: '',
  singleSalesOpenAt: '',
  maxPassesPerCustomer: '',
  eventIds: [],
  prices: {},
};

/** FR-005, FR-017: why a control is locked. */
export const SEASON_LOCK = {
  passes: "Passes have been sold, so the events, venue and layout can't change.",
  cancelled: 'This season is cancelled, so it can no longer be changed.',
} as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The form's values from a saved Season, its times in the venue's zone (`020`). */
function draftOf(s: Season): SeasonDraft {
  const local = (iso: string | null) => (iso ? toLocalDateTime(iso, s.timeZone).slice(0, 16) : '');
  const prices: Record<string, string> = {};
  for (const p of s.prices) prices[p.levelId ?? tierKey(p.tierName ?? '')] = p.price;
  return {
    name: s.name,
    locationId: s.locationId,
    layout: s.layoutId ?? GENERAL_ADMISSION,
    sport: s.sport ?? '',
    team: s.team ?? '',
    salesEndAt: local(s.salesEndAt),
    singleSalesOpenAt: local(s.singleSalesOpenAt),
    maxPassesPerCustomer: s.maxPassesPerCustomer === null ? '' : String(s.maxPassesPerCustomer),
    eventIds: s.events.map((e) => e.id),
    prices,
  };
}

/** The keys a publish refusal's `prices.<i>` names: the saved prices, in the page's order. */
const savedPriceKeys = (s: Season): string[] =>
  s.prices.map((p) => `prices.${p.levelId ?? tierKey(p.tierName ?? '')}`);

/**
 * Spec 041 US1, US2 (FR-005, FR-008, FR-014, FR-017; research R11): a new Season, or one to edit,
 * put on sale, delete (a draft) or cancel (on sale). Remounted for each Season, so a save that
 * moves from /seasons/new to the Season's own address starts fresh.
 */
export function SeasonForm(): React.ReactElement {
  const { id } = useParams();
  return <SeasonPage key={id ?? 'new'} id={id} />;
}

function SeasonPage({ id }: { id: string | undefined }): React.ReactElement {
  const navigate = useNavigate();
  const [venues, setVenues] = useState<Location[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [layouts, setLayouts] = useState<LayoutSummary[]>([]);
  const [levels, setLevels] = useState<{ id: string; name: string; rank: number }[]>([]);
  const [tiersOf, setTiersOf] = useState<Record<string, string[]>>({});
  const [season, setSeason] = useState<Season | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SeasonDraft>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [sent, setSent] = useState<{ eventIds: string[]; priceKeys: string[] }>({
    eventIds: [],
    priceKeys: [],
  });
  const [focusKey, setFocusKey] = useState<{ key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [publishChecks, setPublishChecks] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    listLocations()
      .then(setVenues)
      .catch(() => setVenues([]));
    if (!id) return;
    getSeason(id)
      .then((s) => {
        setSeason(s);
        setDraft(draftOf(s));
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [id]);

  // The picker asks for the chosen venue's events only (review).
  useEffect(() => {
    setEvents([]);
    if (!draft.locationId) return;
    let cancelled = false;
    listEvents({ locationId: draft.locationId })
      .then((e) => !cancelled && setEvents(e))
      .catch(() => !cancelled && setEvents([]));
    return () => {
      cancelled = true;
    };
  }, [draft.locationId]);

  useEffect(() => {
    setLayouts([]);
    if (!draft.locationId) return;
    let cancelled = false;
    listVenueLayouts(draft.locationId)
      .then((l) => !cancelled && setLayouts(l))
      .catch(() => !cancelled && setLayouts([]));
    return () => {
      cancelled = true;
    };
  }, [draft.locationId]);

  const seated = draft.layout !== '' && draft.layout !== GENERAL_ADMISSION;
  useEffect(() => {
    setLevels([]);
    if (!seated) return;
    let cancelled = false;
    getVenueLayout(draft.layout)
      .then((l) => !cancelled && setLevels(l.levels))
      .catch(() => !cancelled && setLevels([]));
    return () => {
      cancelled = true;
    };
  }, [draft.layout, seated]);

  // General admission: each chosen event's ticket type names, read once.
  useEffect(() => {
    if (draft.layout !== GENERAL_ADMISSION) return;
    for (const eventId of draft.eventIds) {
      if (tiersOf[eventId]) continue;
      listTiers(eventId)
        .then((t) => setTiersOf((now) => ({ ...now, [eventId]: t.map((x) => x.name) })))
        .catch(() => setTiersOf((now) => ({ ...now, [eventId]: [] })));
    }
  }, [draft.layout, draft.eventIds, tiersOf]);

  useEffect(() => {
    if (!focusKey) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(focusIdFor(focusKey.key))?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [focusKey]);

  const venue = venues.find((v) => v.id === draft.locationId) ?? null;
  const zone = (venue?.timeZone ?? season?.timeZone ?? DEFAULT_TIME_ZONE) as UsTimeZone;
  const cancelled = season?.status === 'CANCELLED';
  const passesLocked = (season?.passesSold ?? 0) > 0;

  // The events the picker offers, the Season's own included though past or cancelled.
  const offered = useMemo(() => {
    if (!draft.locationId || !draft.layout) return [];
    const own: PickerEvent[] = (season?.events ?? []).map((e) => ({
      ...e,
      locationId: season!.locationId,
      layoutId: season!.layoutId,
      season: { id: season!.id, name: season!.name },
    }));
    const all: PickerEvent[] = [
      ...events,
      ...own.filter((o) => !events.some((e) => e.id === o.id)),
    ];
    const sameShape = season && season.locationId === draft.locationId;
    return pickableEvents(all, {
      locationId: draft.locationId,
      layoutId: seated ? draft.layout : null,
      seasonId: season?.id ?? null,
      now,
      keep: sameShape ? own.map((o) => o.id) : [],
    });
  }, [events, season, draft.locationId, draft.layout, seated, now]);

  const chosen = offered.filter((e) => draft.eventIds.includes(e.id));
  // General admission: the names every chosen event sells (ignoring case), and the priced ones.
  const tierNames = useMemo(() => {
    if (draft.layout !== GENERAL_ADMISSION) return [];
    const live = chosen.filter((e) => e.status !== 'CANCELLED');
    const lists = live.map((e) => tiersOf[e.id] ?? []);
    const common =
      lists.length === 0
        ? []
        : lists[0]!.filter((n) => lists.every((l) => l.some((m) => tierKey(m) === tierKey(n))));
    const priced = (season?.prices ?? []).flatMap((p) => (p.tierName ? [p.tierName] : []));
    const out: string[] = [];
    for (const n of [...common, ...priced]) {
      if (!out.some((o) => tierKey(o) === tierKey(n))) out.push(n);
    }
    return out.sort(byName);
  }, [draft.layout, chosen, tiersOf, season]);

  const ctx = {
    zone,
    events: chosen.map((e) => ({ id: e.id, name: e.name, startsAt: e.startsAt, status: e.status })),
    levels,
    tierNames,
    complete: season?.status === 'ON_SALE',
  };
  const keys = priceKeys(draft, ctx);
  const previews = previewSeason(draft, ctx);
  const placed = placeSeasonErrors(
    error,
    sent,
    keys.map((k) => `prices.${k}`),
  );
  // Review 041: Put on sale publishes the saved Season, so only while the form still shows it.
  const dirty = season !== null && !sameDraft(draftOf(season), draft);
  const hintFor = (key: string): string[] =>
    placed.fields.get(key) ??
    (publishChecks?.has(key)
      ? [publishChecks.get(key)!]
      : submitted && previews.has(key)
        ? [previews.get(key)!]
        : []);
  const invalid = (key: string, testId = `${key}-error`) =>
    hintFor(key).length > 0 ? { 'aria-invalid': true as const, 'aria-describedby': testId } : {};
  const hint = (testId: string, messages: string[]) =>
    messages.length > 0 ? (
      <span className="field__hint" role="alert" id={testId} data-testid={testId}>
        {messages.join(' ')}
      </span>
    ) : null;

  const change = (patch: Partial<SeasonDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
    setPublishChecks(null);
    setSaved(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setError(null);
    setSaved(null);
    if (previews.size > 0) {
      setFocusKey({ key: firstErrorKey(previews, keys)! });
      return;
    }
    const { input, priceKeys: sentKeys } = toSeasonInput(draft, ctx);
    setSent({ eventIds: input.eventIds, priceKeys: sentKeys });
    setBusy(true);
    try {
      if (!id) {
        const created = await createSeason(input);
        navigate(`/seasons/${created.id}`, {
          state: { notice: { kind: 'success', text: 'Season saved.' } },
        });
        return;
      }
      const updated = await updateSeason(id, input);
      setSeason(updated);
      setDraft(draftOf(updated));
      setSubmitted(false);
      setSaved('Season saved.');
    } catch (err) {
      refused(err, { eventIds: input.eventIds, priceKeys: sentKeys });
    } finally {
      setBusy(false);
    }
  };

  /** A refusal placed beside its fields, focus on the first (FR-016, FR-017). */
  const refused = (err: unknown, mapping: { eventIds: string[]; priceKeys: string[] }) => {
    const apiError =
      err instanceof ApiError
        ? err
        : new ApiError(0, {
            error: { code: 'VALIDATION_FAILED', message: "Can't reach the QueuePass service." },
          });
    setError(apiError);
    const first = firstErrorKey(placeSeasonErrors(apiError, mapping).fields, keys);
    if (first) setFocusKey({ key: first });
  };

  const publish = async () => {
    if (!season || busy || dirty) return;
    // FR-010: the publish rules previewed first (at least 2 events, every level priced, the sales
    // end ahead); nothing is sent while one fails.
    const checks = previewSeason(draft, { ...ctx, complete: true, publishing: true });
    if (checks.size > 0) {
      setError(null);
      setSaved(null);
      setPublishChecks(checks);
      setFocusKey({ key: firstErrorKey(checks, keys)! });
      return;
    }
    setPublishChecks(null);
    const mapping = { eventIds: season.events.map((e) => e.id), priceKeys: savedPriceKeys(season) };
    setSent(mapping);
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      const s = await publishSeason(season.id);
      setSeason(s);
      setDraft(draftOf(s));
      setSaved(`${s.name} is on sale.`);
    } catch (err) {
      refused(err, mapping);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!season || busy) return;
    const n = season.passesSold ?? 0;
    const ok = window.confirm(
      `Cancel "${season.name}"? ${plural(n, 'pass', 'passes')} will be refunded: every order bought ` +
        'on a pass refunded and its tickets voided. Its events stay scheduled. This cannot be undone.',
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await cancelSeason(season.id);
      setSeason(result.season);
      setDraft(draftOf(result.season));
      setSaved(
        `${result.season.name} is cancelled. ${plural(result.passesRefunded, 'pass', 'passes')} ` +
          `refunded, ${plural(result.ordersRefunded, 'order', 'orders')} refunded, ` +
          `${plural(result.ticketsVoided, 'ticket', 'tickets')} voided.`,
      );
    } catch (err) {
      refused(err, sent);
    } finally {
      setBusy(false);
    }
  };

  const del = useDelete({
    kind: 'season',
    name: season?.name ?? '',
    run: () => deleteSeason(season!.id),
    listPath: '/seasons',
  });

  if (id && loadError) {
    return (
      <section>
        <div role="alert" className="banner banner--error">
          <span className="banner__icon" aria-hidden="true">
            ✕
          </span>
          <div className="banner__body">
            <strong>Could not load the season</strong>
            <p>{loadError}</p>
          </div>
        </div>
        <Link to="/seasons" className="btn">
          Back to seasons
        </Link>
      </section>
    );
  }
  if (id && !season) return <p className="loading">Loading season…</p>;

  const readOnly = cancelled;
  const deleteError = del.error ? del.error.envelope.error.message : null;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1 className="page-title">{season ? season.name : 'New season'}</h1>
          {season ? (
            <>
              <p className="page-sub" data-testid="season-status">
                {seasonStatusText(season, Date.now())}
              </p>
              <p className="page-sub" data-testid="season-figures">
                {`${plural(season.passesSold ?? 0, 'pass sold', 'passes sold')} · ${usd(season.passRevenue ?? '0.00')} pass revenue`}
              </p>
            </>
          ) : (
            <p className="page-sub">Sell a set of events at one venue as one pass.</p>
          )}
        </div>
        {season && !readOnly && (
          <div className="form__actions">
            {season.status === 'DRAFT' && (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void publish()}
                disabled={busy || dirty}
                {...(dirty ? { 'aria-describedby': 'publish-hint' } : {})}
              >
                Put on sale
              </button>
            )}
            {season.status === 'DRAFT' && dirty && (
              <span className="field__hint" id="publish-hint" data-testid="publish-hint">
                Save your changes first.
              </span>
            )}
            {season.status === 'ON_SALE' && (
              <button type="button" className="btn" onClick={() => void cancel()} disabled={busy}>
                Cancel season
              </button>
            )}
            {season.status === 'DRAFT' && (
              <button
                type="button"
                className="btn"
                onClick={() => void del.remove()}
                disabled={del.deleting}
              >
                {del.deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        )}
      </div>

      <Notice />
      {saved && <SuccessState message={saved} />}
      {deleteError && (
        <p className="field__hint" role="alert" data-testid="delete-error">
          {deleteError}
        </p>
      )}
      {readOnly && (
        <div role="status" className="banner">
          <div className="banner__body">
            <p>{SEASON_LOCK.cancelled}</p>
          </div>
        </div>
      )}

      <div className="card">
        <form className="form" onSubmit={(e) => void save(e)} noValidate>
          <fieldset className="field">
            <legend>Season</legend>
            <div className="field">
              <label htmlFor="name">Season name</label>
              <input
                id="name"
                value={draft.name}
                placeholder="Louisville Cardinals Basketball 2026–27"
                disabled={readOnly}
                onChange={(e) => change({ name: e.target.value })}
                {...invalid('name')}
              />
              {hint('name-error', hintFor('name'))}
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="sport">Sport</label>
                <select
                  id="sport"
                  value={draft.sport}
                  disabled={readOnly}
                  onChange={(e) => change({ sport: e.target.value as SeasonDraft['sport'] })}
                  {...invalid('sport')}
                >
                  <option value="">No sport</option>
                  {SPORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {hint('sport-error', hintFor('sport'))}
              </div>
              <div className="field">
                <label htmlFor="team">Team</label>
                <input
                  id="team"
                  value={draft.team}
                  placeholder="Louisville Cardinals"
                  disabled={readOnly}
                  onChange={(e) => change({ team: e.target.value })}
                  {...invalid('team')}
                />
                {hint('team-error', hintFor('team'))}
              </div>
            </div>
          </fieldset>

          <fieldset className="field">
            <legend>Venue and seating</legend>
            <div className="field">
              <label htmlFor="locationId">Venue</label>
              <select
                id="locationId"
                value={draft.locationId}
                disabled={readOnly || passesLocked}
                onChange={(e) =>
                  change({ locationId: e.target.value, layout: '', eventIds: [], prices: {} })
                }
                {...invalid('locationId')}
              >
                <option value="">Select a venue…</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              {hint('locationId-error', hintFor('locationId'))}
            </div>
            <div className="field">
              <label htmlFor="layoutId">Layout</label>
              <select
                id="layoutId"
                value={draft.layout}
                disabled={readOnly || passesLocked || !draft.locationId}
                onChange={(e) => change({ layout: e.target.value, eventIds: [], prices: {} })}
                {...invalid('layoutId')}
              >
                <option value="">Select a layout…</option>
                <option value={GENERAL_ADMISSION}>General admission</option>
                {layouts.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              {hint('layoutId-error', hintFor('layoutId'))}
            </div>
            {passesLocked && !readOnly && (
              <span className="field__hint" data-testid="venue-locked">
                {SEASON_LOCK.passes}
              </span>
            )}
          </fieldset>

          <fieldset className="field">
            <legend>Sales</legend>
            <div className="field">
              <DateTimeFields
                id="salesEndAt"
                name="Pass sales end"
                value={draft.salesEndAt}
                onChange={(v) => change({ salesEndAt: v })}
                fieldProps={{ disabled: readOnly, ...invalid('salesEndAt') }}
              />
              <span className="field__hint">
                {`In the venue's time zone; no later than the first event's start.`}
              </span>
              {hint('salesEndAt-error', hintFor('salesEndAt'))}
            </div>
            <div className="field">
              <DateTimeFields
                id="singleSalesOpenAt"
                name="Single tickets on sale"
                value={draft.singleSalesOpenAt}
                onChange={(v) => change({ singleSalesOpenAt: v })}
                fieldProps={{ disabled: readOnly, ...invalid('singleSalesOpenAt') }}
              />
              <span className="field__hint">
                Until then the events sell only passes. Leave blank for no presale.
              </span>
              {hint('singleSalesOpenAt-error', hintFor('singleSalesOpenAt'))}
            </div>
            <div className="field">
              <label htmlFor="maxPassesPerCustomer">Passes per customer</label>
              <input
                id="maxPassesPerCustomer"
                type="number"
                min={1}
                max={10}
                step={1}
                value={draft.maxPassesPerCustomer}
                disabled={readOnly}
                onChange={(e) => change({ maxPassesPerCustomer: e.target.value })}
                {...invalid('maxPassesPerCustomer')}
              />
              <span className="field__hint">Leave blank for no limit.</span>
              {hint('maxPassesPerCustomer-error', hintFor('maxPassesPerCustomer'))}
            </div>
          </fieldset>

          <fieldset className="field" id="eventIds" tabIndex={-1} {...invalid('eventIds')}>
            <legend>Events</legend>
            {/* Review 041: the reason beside the locked boxes too (FR-017). */}
            {passesLocked && !readOnly && (
              <span className="field__hint" data-testid="events-locked">
                {SEASON_LOCK.passes}
              </span>
            )}
            {!draft.locationId || !draft.layout ? (
              <p className="note">Choose a venue and a layout to see its upcoming events.</p>
            ) : offered.length === 0 ? (
              <p className="note">No upcoming events at this venue on this layout.</p>
            ) : (
              offered.map((e) => (
                <label key={e.id} className="choice">
                  <input
                    type="checkbox"
                    checked={draft.eventIds.includes(e.id)}
                    disabled={readOnly || passesLocked}
                    onChange={(ev) =>
                      change({
                        eventIds: ev.target.checked
                          ? [...draft.eventIds, e.id]
                          : draft.eventIds.filter((x) => x !== e.id),
                      })
                    }
                  />
                  {`${e.name} · ${formatEventTime(e.startsAt, zone)}`}
                  {e.status === 'CANCELLED' && (
                    <>
                      {' '}
                      <span className="pill pill--danger">Cancelled</span>
                    </>
                  )}
                </label>
              ))
            )}
            {hint('eventIds-error', hintFor('eventIds'))}
          </fieldset>

          <fieldset className="field" id="prices" tabIndex={-1} {...invalid('prices')}>
            <legend>Pass prices</legend>
            {keys.length === 0 ? (
              <p className="note">
                {seated
                  ? 'Loading the layout’s price levels…'
                  : draft.layout === GENERAL_ADMISSION
                    ? 'Choose events to price the ticket types they all sell.'
                    : 'Choose a layout to price its levels.'}
              </p>
            ) : (
              <div className="field-row">
                {keys.map((key) => {
                  const label = seated
                    ? (levels.find((l) => l.id === key)?.name ?? key)
                    : (tierNames.find((n) => tierKey(n) === key) ?? key);
                  const testId = `price-${key}-error`;
                  return (
                    <div className="field" key={key}>
                      <label htmlFor={`price-${key}`}>{`${label} pass price`}</label>
                      <input
                        id={`price-${key}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={draft.prices[key] ?? ''}
                        disabled={readOnly}
                        onChange={(e) =>
                          change({ prices: { ...draft.prices, [key]: e.target.value } })
                        }
                        {...invalid(`prices.${key}`, testId)}
                      />
                      {hint(testId, hintFor(`prices.${key}`))}
                    </div>
                  );
                })}
              </div>
            )}
            <span className="field__hint">
              The whole season’s price, split evenly across its events.
            </span>
            {hint('prices-error', hintFor('prices'))}
          </fieldset>

          {placed.unmapped.length > 0 && (
            <p className="field__hint" role="alert" data-testid="submit-error">
              {placed.unmapped.join(' ')}
            </p>
          )}

          <div className="form__actions">
            {!readOnly && (
              <button type="submit" className="btn btn--primary" disabled={busy}>
                {busy ? 'Saving…' : id ? 'Save changes' : 'Save season'}
              </button>
            )}
            <Link to="/seasons" className="btn btn--ghost">
              Back to seasons
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}
