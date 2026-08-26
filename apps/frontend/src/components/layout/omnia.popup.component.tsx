'use client';

import { useEffect } from 'react';

// Omnia: an OAuth round-trip started from the embedded studio runs in a popup named
// `omnia-oauth` (add.provider.component.tsx). Once the provider sends the popup back to the
// studio, this closes it; the frame that opened it reloads and shows the new channel.
export const OmniaPopupComponent = (): null => {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.name === 'omnia-oauth' && window.opener && window.opener !== window) {
      window.close();
    }
  }, []);
  return null;
};
