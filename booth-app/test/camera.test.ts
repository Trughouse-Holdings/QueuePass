import { describe, it, expect, vi, afterEach } from 'vitest';
import { CameraRefusedError, NoCameraError, openCamera } from '../src/camera';

/**
 * Spec 017 FR-009 (research R9): how a getUserMedia failure becomes the Scanner's message.
 * Refused and missing cameras each get their own error; anything else (a webcam busy in another
 * app, a hardware fault) is passed through, so the Scanner says the camera can't be opened.
 */

const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

function stubGetUserMedia(impl: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(impl) },
  });
}

const failingWith = (name: string) => () => Promise.reject(new DOMException('camera failed', name));

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'mediaDevices', original);
  else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
});

describe('openCamera', () => {
  it('returns the stream, and stop() stops every track', async () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    const stream = { getTracks: () => tracks } as unknown as MediaStream;
    stubGetUserMedia(() => Promise.resolve(stream));

    const camera = await openCamera();
    expect(camera.stream).toBe(stream);
    camera.stop();
    for (const t of tracks) expect(t.stop).toHaveBeenCalledTimes(1);
  });

  it.each(['NotAllowedError', 'SecurityError'])('%s is CameraRefusedError', async (name) => {
    stubGetUserMedia(failingWith(name));
    await expect(openCamera()).rejects.toBeInstanceOf(CameraRefusedError);
  });

  it.each(['NotFoundError', 'OverconstrainedError'])('%s is NoCameraError', async (name) => {
    stubGetUserMedia(failingWith(name));
    await expect(openCamera()).rejects.toBeInstanceOf(NoCameraError);
  });

  it.each(['NotReadableError', 'AbortError'])(
    '%s (e.g. a webcam busy in another app) is passed through, not called "no camera"',
    async (name) => {
      stubGetUserMedia(failingWith(name));
      const err = await openCamera().catch((e: unknown) => e);
      expect(err).not.toBeInstanceOf(NoCameraError);
      expect(err).not.toBeInstanceOf(CameraRefusedError);
      expect((err as DOMException).name).toBe(name);
    },
  );

  it('a browser without getUserMedia is NoCameraError', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    await expect(openCamera()).rejects.toBeInstanceOf(NoCameraError);
  });
});
