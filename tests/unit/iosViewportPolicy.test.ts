import { describe, expect, it } from "vitest";
import {
  applyIOSFocusZoomPolicy,
  isIOSViewportDevice,
  type ViewportNavigatorSignals,
} from "../../src/utils/iosViewportPolicy";

const IPHONE: ViewportNavigatorSignals = {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
};

const IPAD_DESKTOP_MODE: ViewportNavigatorSignals = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15",
  platform: "MacIntel",
  maxTouchPoints: 5,
};

const ANDROID: ViewportNavigatorSignals = {
  userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/138.0.0.0 Mobile Safari/537.36",
  platform: "Linux armv8l",
  maxTouchPoints: 5,
};

function viewportDocument(content: string) {
  const viewport = { content };
  const documentRef = {
    querySelector: () => viewport,
  } as unknown as Document;
  return { documentRef, viewport };
}

describe("iOS viewport policy", () => {
  it("recognises iPhone and iPadOS desktop-mode signals without matching Android", () => {
    expect(isIOSViewportDevice(IPHONE)).toBe(true);
    expect(isIOSViewportDevice(IPAD_DESKTOP_MODE)).toBe(true);
    expect(isIOSViewportDevice(ANDROID)).toBe(false);
  });

  it("adds the focus-zoom directive while preserving the existing viewport", () => {
    const { documentRef, viewport } = viewportDocument(
      "width=device-width, initial-scale=1.0",
    );

    expect(applyIOSFocusZoomPolicy(documentRef, IPHONE)).toBe(true);
    expect(viewport.content).toBe(
      "width=device-width, initial-scale=1.0, maximum-scale=1.0",
    );
  });

  it("does not change the Android viewport", () => {
    const { documentRef, viewport } = viewportDocument(
      "width=device-width, initial-scale=1.0",
    );

    expect(applyIOSFocusZoomPolicy(documentRef, ANDROID)).toBe(false);
    expect(viewport.content).toBe("width=device-width, initial-scale=1.0");
  });
});
