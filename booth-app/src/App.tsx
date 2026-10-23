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
import { EntryResult, refusalText, type Outcome } from './EntryResult';
import { EventPicker, openForEntry, saveEventId, savedEventId } from './EventPicker';
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

function Booth() {
  const { api, signIn } = useAuth();
  const [events, setEvents] = useState<Event[] | null>(null);
  const [eventsFailed, setEventsFailed] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [chosen, setChosen] = useState<Event | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  // Spec 017 FR-009 (US5): whether the camera panel is open.
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEventsFailed(false);
    void (async () => {
      try {
        const { data, response } = await listEvents(api);
        if (cancelled) return;
        if (response.ok && data) {
          const open = openForEntry(data as Event[]);
          setEvents(open);
          // FR-007: the choice survives a remount or a fresh sign-in in this tab.
          const saved = savedEventId();
          const found = saved ? open.find((e) => e.id === saved) : undefined;
          if (found) setChosen((c) => c ?? found);
        } else if (response.status === 401) {
          await signIn();
        } else {
          setEventsFailed(true);
        }
      } catch {
        if (!cancelled) setEventsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, signIn, reloads]);

  const choose = (e: Event): void => {
    setChosen(e);
    saveEventId(e.id);
    setOutcome(null);
    setNotice(null);
  };

  const changeEvent = (): void => {
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

  /** FR-024: the previous result leaves the screen only when the next lookup starts. */
  async function lookUp(code: string): Promise<void> {
    if (!chosen) return;
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
                  usedAt: ticket.usedAt ?? undefined,
                  entryOpensAt: ticket.entryOpensAt,
                }),
              },
        );
      } else if (response.status === 401) {
        await signIn();
      } else if (error?.error.code === 'TICKET_NOT_FOUND') {
        setOutcome({ kind: 'refused', message: 'No ticket has this code' });
      } else {
        setNotice(error?.error.message ?? UNREACHABLE);
      }
    } catch {
      setNotice(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

  async function admit(wholeOrder: boolean): Promise<void> {
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
      } else if (response.status === 401) {
        // The session expired mid-scan: nothing was recorded; the chosen event is kept (Edge Cases).
        await signIn();
      } else if (error?.error.code === 'ENTRY_REFUSED') {
        const d = (error.error.details ?? {}) as {
          reason?: string;
          usedAt?: string;
          entryOpensAt?: string;
          event?: { name?: string; startsAt?: string };
        };
        setOutcome({
          kind: 'refused',
          message: refusalText(d.reason, {
            eventName: d.event?.name,
            eventStartsAt: d.event?.startsAt,
            usedAt: d.usedAt,
            entryOpensAt: d.entryOpensAt,
          }),
        });
      } else {
        setNotice(error?.error.message ?? UNREACHABLE);
      }
    } catch {
      setNotice(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

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
          <LogoutButton />
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
            <EventPicker events={events} onChoose={choose} />
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
                onTicketCode={(code) => {
                  // A scan behaves exactly like typing the code it carries (FR-009).
                  setScanning(false);
                  void lookUp(code);
                }}
                onStop={() => setScanning(false)}
              />
            )}
            <EntryResult
              outcome={outcome}
              busy={busy}
              onAdmit={(wholeOrder) => void admit(wholeOrder)}
              onRefuse={() => setOutcome({ kind: 'notAdmitted' })}
              onAnother={another}
            />
          </>
        )}
      </main>
    </>
  );
}
