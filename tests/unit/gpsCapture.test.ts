import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureGPS } from '../../src/services/gps';

type SuccessCallback = PositionCallback;
type ErrorCallback = PositionErrorCallback;

describe('captureGPS', () => {
  let reportPosition: SuccessCallback;
  let reportError: ErrorCallback;
  let clearWatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    clearWatch = vi.fn();
    const watchPosition = vi.fn((success: SuccessCallback, error: ErrorCallback) => {
      reportPosition = success;
      reportError = error;
      return 41;
    });

    vi.stubGlobal('navigator', {
      geolocation: { watchPosition, clearWatch },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function position(accuracy: number): GeolocationPosition {
    return {
      coords: {
        latitude: 52.2053,
        longitude: 0.1218,
        accuracy,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: Date.now(),
      toJSON: () => ({}),
    };
  }

  function error(code: number, message: string): GeolocationPositionError {
    return {
      code,
      message,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    };
  }

  it('returns the best available fix when the browser watch times out', async () => {
    const result = captureGPS();
    reportPosition(position(30));
    reportError(error(3, 'Position timed out'));

    await expect(result).resolves.toEqual({ lat: 52.2053, lon: 0.1218, accuracyM: 30 });
    expect(clearWatch).toHaveBeenCalledWith(41);
  });

  it('returns the best available fix when the position becomes unavailable', async () => {
    const result = captureGPS();
    reportPosition(position(45));
    reportError(error(2, 'Position unavailable'));

    await expect(result).resolves.toMatchObject({ accuracyM: 45 });
  });

  it('still rejects permission denial even after receiving a fix', async () => {
    const result = captureGPS();
    reportPosition(position(30));
    reportError(error(1, 'Permission denied'));

    await expect(result).rejects.toThrow('Permission denied');
  });

  it('rejects an early manual acceptance instead of leaving the promise pending', async () => {
    const acceptRef: { accept: (() => void) | null } = { accept: null };
    const result = captureGPS({ acceptRef });

    acceptRef.accept?.();

    await expect(result).rejects.toThrow('before a location fix is available');
    expect(acceptRef.accept).toBeNull();
  });

  it('returns the best fix when the overall precision timer expires', async () => {
    const result = captureGPS();
    reportPosition(position(25));
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toMatchObject({ accuracyM: 25 });
  });
});
