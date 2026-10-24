import jsQR from 'jsqr';
import { parseLiveCode } from '@queuepass/shared';

/**
 * Spec 017 FR-009 (research R9): one frame, drawn at most 640 pixels wide, decoded with jsQR.
 * `dontInvert` is faster, and printed codes are dark on light.
 */
export function decodeFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): string | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const scale = Math.min(1, 640 / width);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return (
    jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null
  );
}

/** The ticket-code alphabet (spec 005 research R3): no I, O, 0, or 1. */
const TICKET_CODE = /^[A-HJ-NP-Z2-9]{12}$/;

/**
 * FR-009: a scanned value behaves exactly like typing it — upper case, spaces and dashes removed —
 * or `null` when it is not a QueuePass ticket code (US5 scenario 6). Spec 018 FR-011 (research
 * R9): a live code is recognized too, by the shared parser (one live-code implementation), and
 * passed on upper-cased, so the agent never chooses which kind of code it is; the Backend
 * verifies it.
 */
export function normalizeScan(raw: string): string | null {
  const upper = raw.trim().toUpperCase();
  if (parseLiveCode(upper)) return upper;
  const code = upper.replace(/[\s-]/g, '');
  return TICKET_CODE.test(code) ? code : null;
}
