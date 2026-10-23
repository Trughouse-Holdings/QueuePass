import { useEffect, useRef, useState } from 'react';
import { CameraRefusedError, NoCameraError, openCamera } from './camera';
import { decodeFrame, normalizeScan } from './decode';

/**
 * Spec 017 US5 (FR-009; research R9): the camera view, decoding about 6 frames a second. A
 * decoded ticket code stops the camera and runs the lookup with no further tap; anything else
 * says it is not a QueuePass ticket, once per distinct value, and scanning continues. The tracks
 * stop when a code is read, when the agent stops scanning, and when the screen unmounts.
 */
export function Scanner({
  onTicketCode,
  onStop,
}: {
  onTicketCode: (code: string) => void;
  onStop: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let stop: (() => void) | null = null;
    let timer: number | undefined;
    void (async () => {
      try {
        const camera = await openCamera();
        if (!active) {
          camera.stop();
          return;
        }
        stop = camera.stop;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = camera.stream;
        await video.play()?.catch(() => undefined);
        const canvas = document.createElement('canvas');
        const tick = (): void => {
          if (!active) return;
          const value = decodeFrame(video, canvas);
          if (value !== null) {
            const code = normalizeScan(value);
            if (code !== null) {
              active = false;
              stop?.();
              stop = null;
              onTicketCode(code);
              return;
            }
            setRejected(value);
          }
          timer = window.setTimeout(tick, 160);
        };
        tick();
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof CameraRefusedError
            ? 'Camera access was refused. Type the code instead.'
            : err instanceof NoCameraError
              ? 'This device has no camera. Type the code instead.'
              : "The camera can't be opened. Type the code instead.",
        );
      }
    })();
    return () => {
      active = false;
      stop?.();
      if (timer !== undefined) clearTimeout(timer);
    };
    // onTicketCode and onStop are stable callbacks from the App.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="scanner" aria-label="Scan a ticket">
      {error ? (
        <p className="banner banner--error">{error}</p>
      ) : (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a live camera preview */}
          <video ref={videoRef} className="scanner__video" playsInline muted />
          <p>Point the camera at the ticket&apos;s QR code.</p>
          {rejected !== null && <p className="banner banner--error">Not a QueuePass ticket</p>}
        </>
      )}
      <button type="button" className="btn" onClick={onStop}>
        Stop scanning
      </button>
    </section>
  );
}
