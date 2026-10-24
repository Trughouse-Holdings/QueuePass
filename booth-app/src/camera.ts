/**
 * Spec 017 FR-009 (research R9): the camera behind one small module, so tests stub it and never
 * need a real camera. `facingMode: environment` opens the back camera where there is one, else
 * the webcam.
 */

/** The person refused camera access in the browser (US5 scenario 5). */
export class CameraRefusedError extends Error {
  constructor() {
    super('Camera access was refused.');
  }
}

/** The device has no camera, or the browser offers none here. */
export class NoCameraError extends Error {
  constructor() {
    super('No camera is available.');
  }
}

export interface OpenCamera {
  stream: MediaStream;
  /** Stops every track; safe to call more than once. */
  stop: () => void;
}

export async function openCamera(): Promise<OpenCamera> {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) throw new NoCameraError();
  let stream: MediaStream;
  try {
    stream = await devices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraRefusedError();
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new NoCameraError();
    // Anything else (a webcam busy in another app, a hardware fault): the camera exists but
    // can't be opened, and the Scanner says so.
    throw err;
  }
  return { stream, stop: () => stream.getTracks().forEach((t) => t.stop()) };
}
