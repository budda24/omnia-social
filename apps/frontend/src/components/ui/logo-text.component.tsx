import React from 'react';
import { OmniaRings } from '@gitroom/frontend/components/ui/omnia-rings';

/** Wordmark for the sign-in pages: the rings, "Omnia" in the display serif, "SOCIAL" as a kicker. */
export const LogoTextComponent = () => {
  return (
    <div className="flex items-center gap-[10px]" aria-label="Omnia Social">
      <OmniaRings size={34} />
      <span
        className="text-[30px] leading-none tracking-[-0.01em] text-[#FBFAF7]"
        style={{ fontFamily: 'var(--font-display), Georgia, serif' }}
      >
        Omnia
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#9CA3AF] mt-[8px]">
        Social
      </span>
    </div>
  );
};
