export const dynamic = 'force-dynamic';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Omnia Social · Sign in on Omnia',
  description: '',
};

/**
 * Omnia: the studio has no sign-in of its own. A visitor without a live platform
 * session — never signed in, signed out on the platform, or a platform session
 * that expired — lands here. The only way in is the Omnia console, which mints a
 * one-time studio login from the platform session (OMN-35).
 */
export default async function LoginRequiredPage() {
  const consoleUrl = process.env.OMNIA_CONSOLE_URL || '/';
  return (
    <div className="flex flex-col gap-[16px] w-full" data-omnia="login-required">
      <h1 className="text-[28px] leading-[1.15]" style={{ fontFamily: 'var(--font-display, serif)' }}>
        Sign in on Omnia
      </h1>
      <p className="text-[15px] text-[#9CA3AF] leading-[1.5]">
        Your Omnia session has ended, or you opened the studio without one. The studio has no
        sign-in of its own: it opens on your Omnia console session.
      </p>
      <a
        href={consoleUrl}
        target="_top"
        className="inline-flex justify-center rounded-[8px] bg-[#1E56E8] px-[18px] py-[10px] text-[14px] font-medium text-white"
      >
        Open the Omnia console
      </a>
    </div>
  );
}
