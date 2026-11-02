import { useEffect, useState } from 'react';
import type { EntryTicket, Event } from '@queuepass/shared';
import {
  AuthProvider,
  LogoutButton,
  RequireRole,
  useAuth,
  type UserManagerLike,
} from '@queuepass/shared/web';
import { admitTicket, listEvents, lookupEntryTicket } from './api';
import { EntryResult, LIVE_CODE_REFUSALS, refusalText, type Outcome } from './EntryResult';
import { EventPicker, forTheGate, saveEventId, savedEventId } from './EventPicker';
import { Scanner } from './Scanner';
import { TicketLookup } from './TicketLookup';

/**
 * QueuePass Ticket Booth (spec 017, #40): a gate agent chooses the event they are working, looks
 * tickets up by typed code, checks the holder's ID, and admits or refuses. Gate-agent only; every
 * rule is the Backend's (Constitution IV, V).
 */
/** FR-007: a deliberate sign-out ends the shift, so the next agent chooses their own event. */
async function forgetEventOnLogout(): Promise<void> {
  saveEventId(null);
}

export function App({ userManager }: { userManager?: UserManagerLike }) {
  return (
    <AuthProvider
      authority={import.meta.env.VITE_OIDC_AUTHORITY}
      clientId={import.meta.env.VITE_OIDC_CLIENT_ID}
      userManager={userManager}
      beforeLogout={forgetEventOnLogout}
    >
      <RequireRole role="gate-agent">
        <Booth />
      </RequireRole>
    </AuthProvider>
  );
}

const UNREACHABLE = "Can't reach QueuePass right now. Nothing was recorded; try again.";
/**
 * A failed admit can't say "Nothing was recorded": the Backend may have recorded the entry and
 * only its answer was lost (Constitution IV). Looking the ticket up again tells which.
 */
/** Spec 025 FR-016 (research R8): how often the list is fetched again while it is shown. */
export const LIST_REFRESH_MS = 30_000;

const ADMIT_UNKNOWN =
  "Can't reach QueuePass right now, so this entry may not have been recorded. Look the ticket up again before admitting.";

function Booth() {
  const { api, signIn } = useAuth();
  const [events, setEvents] = useState<Event[] | null>(null);
  /** Spec 025 FR-016: the device's time the list is greyed against, refreshed with the list. */
  const [now, setNow] = useState(() => Date.now());
  const [eventsFailed, setEventsFailed] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [chosen, setChosen] = useState<Event | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  // Spec 017 FR-009 (US5): whether the camera panel is open.
  const [scanning, setScanning] = useState(false);

  // Spec 025 FR-016 (research R8): while no event is chosen, the list is fetched on load, after
  // Try again or Change event, and again every 30 seconds. Only a failed first load shows the
  // error; a failed refetch keeps the list and tries again at the next tick. A 401 signs in again.
  const picking = chosen === null;
  useEffect(() => {
    if (!picking) return;
    let cancelled = false;
    setEventsFailed(false);
    // Review M1: grey the list against the time now, not the time it was last shown.
    setNow(Date.now());
    let loaded = false;
    // Review M2: requests are numbered; an answer older than one already shown is ignored.
    let sent = 0;
    let shown = 0;
    const load = async (): Promise<void> => {
      const n = (sent += 1);
      try {
        const { data, response } = await listEvents(api);
        if (cancelled || n < shown) return;
        if (response.ok && data) {
          shown = n;
          const at = Date.now();
          const list = data as Event[];
          loaded = true;
          setNow(at);
          setEvents(list);
          // FR-007, spec 025 FR-017: the choice survives a remount or a fresh sign-in in this
          // tab, but only while its event is open for entry; otherwise it is forgotten.
          const saved = savedEventId();
          if (saved) {
            const found = forTheGate(list, at).find((g) => g.event.id === saved);
            if (found?.open) setChosen((c) => c ?? found.event);
            else saveEventId(null);
          }
        } else if (response.status === 401) {
          await signIn();
        } else if (!loaded) {
          setEventsFailed(true);
        }
      } catch {
        if (!cancelled && !loaded) setEventsFailed(true);
      }
    };
    void load();
    const timer = setInterval(() => {
      setNow(Date.now());
      void load();
    }, LIST_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, signIn, reloads, picking]);

  const choose = (e: Event): void => {
    setChosen(e);
    saveEventId(e.id);
    setOutcome(null);
    setNotice(null);
  };

  const changeEvent = (): void => {
    // The camera opens only when Scan is pressed, not when the next event is chosen (FR-009).
    setScanning(false);
    setChosen(null);
    saveEventId(null);
    setOutcome(null);
    setNotice(null);
  };

  const another = (): void => {
    setOutcome(null);
    setNotice(null);
    setFocusSignal((n) => n + 1);
  };

  /**
   * FR-024: the previous result leaves the screen only when the next lookup starts. Resolves
   * `true` when a ticket was found, whatever its state, so the typed code can be cleared; a
   * refusal of the code itself or a failed request keeps it (Constitution IV).
   */
  async function lookUp(code: string): Promise<boolean> {
    // FR-024: the camera is never open during a request, so it can't read another ticket whose
    // answer would race this one. Scan stays disabled until the request ends.
    setScanning(false);
    if (!chosen) return false;
    setOutcome(null);
    setNotice(null);
    setBusy(true);
    try {
      const { data, error, response } = await lookupEntryTicket(api, chosen.id, code);
      if (response.ok && data) {
        const ticket = data as EntryTicket;
        setOutcome(
          ticket.state === 'ADMITTABLE'
            ? { kind: 'ticket', ticket }
            : {
                kind: 'refused',
                ticket,
                message: refusalText(ticket.state, {
                  eventName: ticket.event.name,
                  eventStartsAt: ticket.event.startsAt,
                  eventTimeZone: ticket.event.timeZone,
                  timeZone: chosen.location?.timeZone,
                  usedAt: ticket.usedAt ?? undefined,
                  entryOpensAt: ticket.entryOpensAt,
                }),
              },
        );
        return true;
      } else if (response.status === 401) {
        await signIn();
      } else if (error?.error.code === 'TICKET_NOT_FOUND') {
        setOutcome({ kind: 'refused', message: 'No ticket has this code' });
      } else if (error && Object.hasOwn(LIVE_CODE_REFUSALS, error.error.code)) {
        // Spec 018 FR-011: an expired or forged live code, refused like an unknown code.
        setOutcome({ kind: 'refused', message: LIVE_CODE_REFUSALS[error.error.code] });
      } else {
        setNotice(error?.error.message ?? UNREACHABLE);
      }
    } catch {
      setNotice(UNREACHABLE);
    } finally {
      setBusy(false);
    }
    return false;
  }

  async function admit(wholeOrder: boolean): Promise<void> {
    setScanning(false);
    if (!chosen || outcome?.kind !== 'ticket') return;
    setNotice(null);
    setBusy(true);
    try {
      const { data, error, response } = await admitTicket(
        api,
        chosen.id,
        outcome.ticket.ticketId,
        wholeOrder,
      );
      if (response.ok && data) {
        setOutcome({ kind: 'admitted', admitted: data.admitted, alreadyUsed: data.alreadyUsed });
        // The pressed button is gone: the code field takes focus for the next ticket (FR-008).
        setFocusSignal((n) => n + 1);
      } else if (response.status === 401) {
        // The session expired mid-scan: nothing was recorded; the chosen event is kept (Edge Cases).
        await signIn();
      } else if (error?.error.code === 'ENTRY_REFUSED') {
        const d = (error.error.details ?? {}) as {
          reason?: string;
          usedAt?: string;
          entryOpensAt?: string;
          event?: { name?: string; startsAt?: string; timeZone?: string };
        };
        setOutcome({
          kind: 'refused',
          message: refusalText(d.reason, {
            eventName: d.event?.name,
            eventStartsAt: d.event?.startsAt,
            eventTimeZone: d.event?.timeZone,
            timeZone: chosen.location?.timeZone,
            usedAt: d.usedAt,
            entryOpensAt: d.entryOpensAt,
          }),
        });
        setFocusSignal((n) => n + 1);
      } else if (response.status >= 500) {
        setNotice(ADMIT_UNKNOWN);
      } else {
        setNotice(error?.error.message ?? ADMIT_UNKNOWN);
      }
    } catch {
      setNotice(ADMIT_UNKNOWN);
    } finally {
      setBusy(false);
    }
  }

  const refuse = (): void => {
    setOutcome({ kind: 'notAdmitted' });
    setFocusSignal((n) => n + 1);
  };

  return (
    <>
      <header className="booth-header">
        <div>
          <p className="booth-header__app">QueuePass Ticket Booth</p>
          {chosen && <p className="booth-header__event">{chosen.name}</p>}
        </div>
        <div className="booth-header__actions">
          {chosen && (
            <button type="button" className="btn btn--ghost" onClick={changeEvent}>
              Change event
            </button>
          )}
          {/* Issue #37: not in a .topbar, so it takes the theme button classes itself. */}
          <LogoutButton className="btn btn--ghost" />
        </div>
      </header>
      <main className="booth-main">
        {notice && (
          <p role="alert" className="banner banner--error">
            {notice}
          </p>
        )}
        {chosen === null ? (
          eventsFailed ? (
            <div>
              <p className="banner banner--error">
                Can&apos;t reach QueuePass right now. Try again.
              </p>
              <button type="button" className="btn" onClick={() => setReloads((n) => n + 1)}>
                Try again
              </button>
            </div>
          ) : events === null ? (
            <p>Loading events…</p>
          ) : (
            <EventPicker events={forTheGate(events, now)} now={now} onChoose={choose} />
          )
        ) : (
          <>
            <TicketLookup
              busy={busy}
              focusSignal={focusSignal}
              onLookup={lookUp}
              onScan={() => setScanning(true)}
            />
            {scanning && (
              <Scanner
                // A scan behaves exactly like typing the code it carries (FR-009); the lookup
                // closes the camera.
                onTicketCode={(code) => void lookUp(code)}
                onStop={() => setScanning(false)}
              />
            )}
            <EntryResult
              outcome={outcome}
              busy={busy}
              onAdmit={(wholeOrder) => void admit(wholeOrder)}
              onRefuse={refuse}
              onAnother={another}
              timeZone={chosen?.location?.timeZone}
            />
          </>
        )}
      </main>
    </>
  );
}
