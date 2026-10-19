import { useEffect, useState } from 'react';
import { useEventImage } from '@queuepass/shared/web';
import {
  EVENT_IMAGE_LIMITS,
  IMAGE_PIXEL_LIMITS,
  readImageHeader,
  type EventImage,
} from '@queuepass/shared';

/** One picture in the form: already stored, or chosen and not yet sent (research R9). */
export type ImageItem =
  { kind: 'saved'; key: string; image: EventImage } | { kind: 'new'; key: string; file: File };

const HINT = 'Up to 5 images. JPG, PNG, or WebP, up to 5 MB each. The first image is the cover.';

/**
 * Spec 014 FR-016: why the form will not send `file`, or `null`. A convenience only: it reads the
 * header, as the Backend does, but not the whole structure, so the Backend still decides.
 */
async function refusalOf(file: File): Promise<string | null> {
  if (file.size > EVENT_IMAGE_LIMITS.maxBytes) return 'over 5 MB';
  const header = readImageHeader(new Uint8Array(await file.arrayBuffer()));
  if (!header) return 'only JPG, PNG, or WebP pictures';
  if (header.animated) return 'animated pictures are not accepted';
  const { maxSide, maxPixels } = IMAGE_PIXEL_LIMITS;
  if (header.width > maxSide || header.height > maxSide || header.width * header.height > maxPixels)
    return 'over 16,384 pixels a side or 40 megapixels';
  return null;
}

/** A chosen file's preview, from an object URL revoked when the item goes. */
function NewThumb({ file, alt }: { file: File; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? (
    <img className="image-item__thumb" src={url} alt={alt} />
  ) : (
    <span className="image-item__thumb" />
  );
}

/** A stored image's preview, loaded with the token through the shared cache (research R4). */
function SavedThumb({ eventId, image, alt }: { eventId: string; image: EventImage; alt: string }) {
  const { url } = useEventImage(eventId, image.id);
  return url ? (
    <img className="image-item__thumb" src={url} alt={alt} />
  ) : (
    <span className="image-item__thumb" role="img" aria-label={alt} />
  );
}

/**
 * Spec 014 FR-014, FR-016 (research R9): the Images control of the event form: add, move earlier
 * or later, and remove. Changes are made when the form is saved, so this only edits the list the
 * form holds.
 */
export function ImagesField({
  eventId,
  items,
  onAdd,
  onMove,
  onRemove,
}: {
  /** The event, once it exists; stored images are shown from it. */
  eventId: string | undefined;
  items: ImageItem[];
  onAdd: (files: File[]) => void;
  /** Moves the item at `index` one place earlier (`-1`) or later (`1`). */
  onMove: (index: number, by: -1 | 1) => void;
  onRemove: (index: number) => void;
}): React.ReactElement {
  const [refused, setRefused] = useState<string[]>([]);
  const full = items.length >= EVENT_IMAGE_LIMITS.maxCount;

  async function choose(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = e.currentTarget;
    const files = [...(input.files ?? [])];
    // So the same file can be chosen again.
    input.value = '';
    const accepted: File[] = [];
    const notes: string[] = [];
    let room = EVENT_IMAGE_LIMITS.maxCount - items.length;
    for (const file of files) {
      if (room <= 0) {
        notes.push(`${file.name}: an event can have at most ${EVENT_IMAGE_LIMITS.maxCount} images`);
        continue;
      }
      const why = await refusalOf(file);
      if (why) notes.push(`${file.name}: ${why}`);
      else {
        accepted.push(file);
        room -= 1;
      }
    }
    setRefused(notes);
    if (accepted.length > 0) onAdd(accepted);
  }

  return (
    <fieldset className="field">
      <legend>Images</legend>
      <span className="field__hint">{HINT}</span>
      {items.length > 0 && (
        <ol className="image-list">
          {items.map((item, i) => {
            const alt = `Image ${i + 1}`;
            return (
              <li key={item.key} className="image-item">
                {item.kind === 'new' ? (
                  <NewThumb file={item.file} alt={alt} />
                ) : eventId ? (
                  <SavedThumb eventId={eventId} image={item.image} alt={alt} />
                ) : null}
                <span>{alt}</span>
                {i === 0 && <span className="pill">Cover</span>}
                <div className="image-item__actions">
                  {i > 0 && (
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Move image ${i + 1} earlier`}
                      onClick={() => onMove(i, -1)}
                    >
                      Earlier
                    </button>
                  )}
                  {i < items.length - 1 && (
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Move image ${i + 1} later`}
                      onClick={() => onMove(i, 1)}
                    >
                      Later
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Remove image ${i + 1}`}
                    onClick={() => onRemove(i)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {full ? (
        <p className="note">
          {`${EVENT_IMAGE_LIMITS.maxCount} of ${EVENT_IMAGE_LIMITS.maxCount} images. Remove one to add another.`}
        </p>
      ) : (
        <div className="field">
          <label htmlFor="event-images">Add images</label>
          <input
            id="event-images"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => void choose(e)}
          />
        </div>
      )}
      {/* FR-016: the refusals are announced; the live region is there from the start so a screen
          reader hears what is added to it. */}
      <div aria-live="polite" data-testid="images-live">
        {refused.length > 0 && (
          <div className="note" data-testid="images-note">
            {refused.map((r) => (
              <p key={r}>{r}</p>
            ))}
          </div>
        )}
      </div>
    </fieldset>
  );
}
