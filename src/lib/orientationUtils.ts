/**
 * Helper to manage screen orientation in PWA and tablet browsers.
 * Unlocks orientation locks so tablets can freely rotate to landscape,
 * and allows 1-click manual switching to landscape if needed.
 */

export function unlockScreenOrientation(): void {
  if (typeof window === 'undefined' || !window.screen?.orientation) return;
  try {
    if (typeof window.screen.orientation.unlock === 'function') {
      window.screen.orientation.unlock();
    }
  } catch (err) {
    // Ignore permissions/unsupported errors
  }
}

export async function forceLandscapeOrientation(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.screen?.orientation) return false;
  try {
    if (typeof (window.screen.orientation as any).lock === 'function') {
      await (window.screen.orientation as any).lock('landscape');
      return true;
    }
  } catch (err) {
    // If lock fails, ensure orientation is at least unlocked for sensor rotation
    unlockScreenOrientation();
  }
  return false;
}

export async function forcePortraitOrientation(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.screen?.orientation) return false;
  try {
    if (typeof (window.screen.orientation as any).lock === 'function') {
      await (window.screen.orientation as any).lock('portrait');
      return true;
    }
  } catch (err) {
    unlockScreenOrientation();
  }
  return false;
}

export function isDeviceLandscape(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.screen?.orientation?.type) {
    return window.screen.orientation.type.includes('landscape');
  }
  return window.innerWidth > window.innerHeight;
}
