import { useCallback, useEffect, useState } from 'react';
import type { Event, TicketTier } from '@queuepass/shared';
import { ApiError } from '../api/client';
import { createTier, deleteTier, listTiers, updateTier } from '../api/tiers';
import { ErrorBanner } from './ErrorBanner';

const unreachable = (): ApiError =>
  new ApiError(0, {
    error: { code: 'VALIDATION_FAILED', message: "Can't reach the QueuePass service." },
  });
const asApiError = (err: unknown): ApiError => (err instanceof ApiError ? err : unreachable());

interface Draft {
  name: string;
  price: string;
  quantity: string;
}
const EMPTY: Draft = { name: '', price: '', quantity: '' };

/**
 * Spec 004 US1: an event's ticket tiers, with add, edit, and remove (research R7). The Backend
 * enforces the capacity and name rules; refusals show in the banner and the typed values stay.
 */
export function TierSection({
  event,
  readOnly = false,
}: {
  event: Event;
  /** Spec 005: a cancelled event's tiers are shown but cannot change. */
  readOnly?: boolean;
}): React.ReactElement {
  const [tiers, setTiers] = useState<TicketTier[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const reload = useCallback(
    () =>
      listTiers(event.id)
        .then((t) => {
          setTiers(t);
          setLoadFailed(false);
        })
        .catch(() => setLoadFailed(true)),
    [event.id],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (action: () => Promise<unknown>, after?: () => void): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
      await reload();
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    void run(
      () =>
        createTier(event.id, {
          name: draft.name,
          price: draft.price,
          quantity: Number(draft.quantity),
        }),
      () => setDraft(EMPTY),
    );
  };

  const save = (tier: TicketTier, d: Draft) =>
    run(
      () =>
        updateTier(event.id, tier.id, {
          ...(d.name !== tier.name ? { name: d.name } : {}),
          ...(d.price !== tier.price ? { price: d.price } : {}),
          ...(Number(d.quantity) !== tier.quantity ? { quantity: Number(d.quantity) } : {}),
        }),
      () => setEditing(null),
    );

  const remove = (tier: TicketTier) => {
    if (!window.confirm(`Remove the tier "${tier.name}"? This cannot be undone.`)) return;
    void run(() => deleteTier(event.id, tier.id));
  };

  const allocated = (tiers ?? []).reduce((sum, t) => sum + t.quantity, 0);

  return (
    <section className="card" aria-labelledby="tiers-heading">
      <h2 id="tiers-heading">Ticket tiers</h2>
      {error && <ErrorBanner error={error} title="Could not save the tier" />}

      {loadFailed ? (
        <p className="note">The tiers could not be loaded.</p>
      ) : !tiers ? (
        <p className="loading">Loading tiers…</p>
      ) : (
        <>
          <p className="note">
            Allocated {allocated.toLocaleString()} of {event.totalTicketCapacity.toLocaleString()}{' '}
            tickets
          </p>
          {tiers.length === 0 ? (
            <p className="note">
              No tiers yet. Without tiers, the event sells one admission type at its base price.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th>Price</th>
                    <th>Quantity</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tiers.map((t) =>
                    !readOnly && editing?.id === t.id ? (
                      <tr key={t.id}>
                        <td>
                          <input
                            aria-label={`Name for ${t.name}`}
                            value={editing.draft.name}
                            onChange={(e) =>
                              setEditing({
                                id: t.id,
                                draft: { ...editing.draft, name: e.target.value },
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Price for ${t.name}`}
                            inputMode="decimal"
                            value={editing.draft.price}
                            onChange={(e) =>
                              setEditing({
                                id: t.id,
                                draft: { ...editing.draft, price: e.target.value },
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Quantity for ${t.name}`}
                            type="number"
                            min={1}
                            value={editing.draft.quantity}
                            onChange={(e) =>
                              setEditing({
                                id: t.id,
                                draft: { ...editing.draft, quantity: e.target.value },
                              })
                            }
                          />
                        </td>
                        <td className="cell-action">
                          <button
                            type="button"
                            className="btn btn--primary"
                            disabled={busy}
                            onClick={() => void save(t, editing.draft)}
                          >
                            Save
                          </button>{' '}
                          <button type="button" className="btn" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={t.id}>
                        <td className="cell-strong">{t.name}</td>
                        <td className="price">${t.price}</td>
                        <td className="cell-num">{t.quantity.toLocaleString()}</td>
                        <td className="cell-action">
                          {!readOnly && (
                            <>
                              <button
                                type="button"
                                className="btn"
                                disabled={busy}
                                onClick={() =>
                                  setEditing({
                                    id: t.id,
                                    draft: {
                                      name: t.name,
                                      price: t.price,
                                      quantity: String(t.quantity),
                                    },
                                  })
                                }
                              >
                                Edit
                              </button>{' '}
                              <button
                                type="button"
                                className="btn"
                                disabled={busy}
                                onClick={() => remove(t)}
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!readOnly && (
        <form className="form" onSubmit={add} aria-label="Add a tier">
          <div className="field-row">
            <label className="field">
              Tier name
              <input
                value={draft.name}
                required
                maxLength={100}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="field">
              Price
              <input
                value={draft.price}
                required
                inputMode="decimal"
                placeholder="45.00"
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              />
            </label>
            <label className="field">
              Quantity
              <input
                type="number"
                min={1}
                required
                value={draft.quantity}
                onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
              />
            </label>
          </div>
          <div className="form__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              Add tier
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
