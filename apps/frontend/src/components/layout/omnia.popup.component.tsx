'use client';

import { useEffect } from 'react';

// Omnia: an OAuth round-trip started from the embedded studio runs in a popup named
// `omnia-oauth` (add.provider.component.tsx). Once the provider sends the popup back to the
// studio, this closes it; the frame that opened it reloads and shows the new channel.
// No `window.opener` requirement: the dashboard recreates the studio iframe on every tab
// switch, so the opener may be gone by the time OAuth completes (OMN-113) — `window.close()`
// is only honoured for script-opened windows anyway, so this can never close a user's tab.
export const OmniaPopupComponent = (): null => {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.name === 'omnia-oauth' && window.self === window.top) {
      window.close();
    }
  }, []);
  return null;
};
