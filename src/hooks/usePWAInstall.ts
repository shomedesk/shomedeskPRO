import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isIframe, setIsIframe] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [browserName, setBrowserName] = useState<'chrome' | 'edge' | 'safari' | 'firefox' | 'other'>('other');

  useEffect(() => {
    // Check if running inside an iframe (like AI Studio or Cloud Run preview)
    try {
      const inIframe = window.self !== window.top;
      setIsIframe(inIframe);
    } catch {
      setIsIframe(true);
    }

    // Detect standalone mode (actively running as installed PWA window)
    const checkStandalone = () => {
      const isStandaloneMedia = window.matchMedia('(display-mode: standalone)').matches;
      const isIOSStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      const isAndroidTWA = document.referrer.includes('android-app://');
      const isStandalone = isStandaloneMedia || isIOSStandalone || isAndroidTWA;
      setIsInstalled(isStandalone);
      return isStandalone;
    };

    checkStandalone();

    // Listen to media query changes (e.g. app launched or mode changed)
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleMediaChange = (e: MediaQueryListEvent) => {
      setIsInstalled(e.matches);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleMediaChange);
    } else {
      (mediaQuery as any).addListener?.(handleMediaChange);
    }

    // Detect OS & Browser
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    const isAndroidDevice = /android/.test(userAgent);
    setIsIOS(isIOSDevice);
    setIsAndroid(isAndroidDevice);

    if (userAgent.includes('edg/')) {
      setBrowserName('edge');
    } else if (userAgent.includes('chrome') && !userAgent.includes('edg/')) {
      setBrowserName('chrome');
    } else if (userAgent.includes('safari') && !userAgent.includes('chrome')) {
      setBrowserName('safari');
    } else if (userAgent.includes('firefox')) {
      setBrowserName('firefox');
    } else {
      setBrowserName('other');
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent browser default mini-infobar so our custom UI controls it
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      // User accepted and app was installed
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleMediaChange);
      } else {
        (mediaQuery as any).removeListener?.(handleMediaChange);
      }
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<{ success: boolean; hadPrompt: boolean; outcome?: 'accepted' | 'dismissed' }> => {
    if (!deferredPrompt) {
      return { success: false, hadPrompt: false };
    }

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setIsInstalled(true);
        setDeferredPrompt(null);
        return { success: true, hadPrompt: true, outcome: 'accepted' };
      }
      return { success: false, hadPrompt: true, outcome: 'dismissed' };
    } catch (err) {
      console.warn('PWA install prompt error:', err);
      return { success: false, hadPrompt: true };
    }
  }, [deferredPrompt]);

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    isAndroid,
    isIframe,
    browserName,
    hasPrompt: !!deferredPrompt,
    install,
  };
}
