// src/hooks/useAppUpdate.ts
import { useEffect, useState, useCallback } from 'react';

// CHANGE THIS ON EVERY DEPLOYMENT if not using environment variables
const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0';

export function useAppUpdate(): {
  updateAvailable: boolean;
  refreshApp: () => void;
  checkForUpdates: () => Promise<void>;
} {
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const VERSION_KEY = 'app_version';

  const checkForUpdates = useCallback(async () => {
    // Skip update checks in development mode
    if (import.meta.env.DEV) {
      console.log('Update checks disabled in development mode');
      return;
    }

    try {
      // Fetch version.json from the server with a cache-buster
      const response = await fetch(`/version.json?t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });

      if (!response.ok) return;

      const data = await response.json();
      const remoteVersion = data.version;
      const storedVersion = localStorage.getItem(VERSION_KEY);

      console.log('Update Check:', {
        remote: remoteVersion,
        local: APP_VERSION,
        stored: storedVersion
      });

      // Only show update if remote version is different from current app version
      if (remoteVersion && remoteVersion !== APP_VERSION) {
        console.log('New version detected:', remoteVersion);
        setUpdateAvailable(true);
      } else if (remoteVersion === APP_VERSION && storedVersion !== APP_VERSION) {
        // Sync stored version if it's out of date but matches remote
        localStorage.setItem(VERSION_KEY, APP_VERSION);
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
    }
  }, []);

  // 1. Initial check
  useEffect(() => {
    checkForUpdates();

    // Also store current version if not set
    if (!localStorage.getItem(VERSION_KEY)) {
      localStorage.setItem(VERSION_KEY, APP_VERSION);
    }
  }, [checkForUpdates]);

  // 2. Service Worker update detection
  useEffect(() => {
    const handleControllerChange = () => {
      setUpdateAvailable(true);
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

      // Check for updates every 5 minutes
      const interval = setInterval(() => {
        checkForUpdates();
        navigator.serviceWorker.ready.then((registration) => {
          registration.update();
        });
      }, 5 * 60 * 1000);

      return () => {
        clearInterval(interval);
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      };
    }
  }, [checkForUpdates]);

  const refreshApp = useCallback((): void => {
    console.log('Performing hard refresh...');

    // Update stored version before refresh
    fetch(`/version.json?t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        if (data.version) {
          localStorage.setItem(VERSION_KEY, data.version);
        }
      })
      .catch(() => { })
      .finally(() => {
        // Force refresh from server
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      });
  }, []);

  return { updateAvailable, refreshApp, checkForUpdates };
}