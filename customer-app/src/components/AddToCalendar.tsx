import type { MyOrder } from '@queuepass/shared';
import { ICS_TYPE, calendarEntry, icsFile, icsFileName } from '../calendar';

/** Spec 019 FR-003 (research R11): the snapshot note, read as both controls' description. */
export const CALENDAR_NOTE = "A copy for your calendar: it won't change if the event does.";

/** Research R12: an immediate revoke can cancel the download in Safari and Firefox. */
const REVOKE_AFTER_MS = 60_000;

/**
 * Spec 019 US1 (FR-001, FR-003, FR-008 to FR-010, FR-013, FR-014; research R11, R12): the "Add to
 * calendar" group on an eligible order card. The file is made on the device at the click, from
 * what My tickets already loaded; nothing is requested (FR-010).
 */
export function AddToCalendar({ order }: { order: MyOrder }) {
  const { event } = order;
  // Unique per card: two orders of one event each show a group (research R11).
  const labelId = `calendar-label-${order.id}`;
  const noteId = `calendar-note-${order.id}`;

  const saveFile = () => {
    const text = icsFile(calendarEntry(event), new Date());
    const url = URL.createObjectURL(new Blob([text], { type: ICS_TYPE }));
    const a = document.createElement('a');
    a.href = url;
    a.download = icsFileName(event.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  };

  return (
    <div role="group" aria-labelledby={labelId} className="calendar-actions">
      <span id={labelId} className="calendar-actions__label">
        Add to calendar
      </span>
      <p id={noteId} className="calendar-actions__note">
        {CALENDAR_NOTE}
      </p>
      <div className="calendar-actions__controls">
        <button
          type="button"
          className="btn btn--ghost"
          aria-label={`Add to Apple Calendar or Outlook: ${event.name}, downloads a calendar file`}
          aria-describedby={noteId}
          onClick={saveFile}
        >
          Add to Apple Calendar or Outlook
        </button>
      </div>
    </div>
  );
}
