import { useEffect, useRef, useState } from 'react';
import type { ConsentState } from '@shared/types';

/**
 * Bottom-left consent panel.
 *
 * Refusing is exactly as easy as accepting: same place, same size, same weight,
 * one click each. Optional categories are off until accepted, and the panel
 * never covers the Stop control or the microphone.
 */

interface CookieConsentProps {
  consent: ConsentState;
  onDecide: (analytics: boolean) => Promise<void>;
  onOpenPolicy: (page: 'privacy' | 'cookies') => void;
  /** Forced open from the footer, after an earlier dismissal. */
  forceOpen: boolean;
  onClose: () => void;
}

export function CookieConsent({
  consent,
  onDecide,
  onOpenPolicy,
  forceOpen,
  onClose,
}: CookieConsentProps) {
  const undecided = consent.decidedAt === null || consent.policyVersion !== consent.policyVersion;
  const [managing, setManaging] = useState(false);
  const [analytics, setAnalytics] = useState(consent.analytics);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const open = forceOpen || undecided;

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setAnalytics(consent.analytics);
  }, [consent.analytics]);

  if (!open) return null;

  const decide = async (value: boolean) => {
    setSaving(true);
    try {
      await onDecide(value);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label="Cookies and storage"
      tabIndex={-1}
      // Bottom-left, and narrow enough that it never reaches the controls on
      // the right. On a small screen it sits above them rather than over them.
      className="border-hairline bg-ground-raised fixed bottom-4 left-4 z-40 w-[min(24rem,calc(100vw-2rem))] border p-4 shadow-2xl max-sm:bottom-24"
    >
      <h2 className="mb-2 font-mono text-[0.75rem] tracking-wide uppercase">Cookies and storage</h2>

      <p className="text-ink-dim text-[0.85rem]">
        One signed cookie keeps you signed in and blocks cross-site request forgery. It is required
        for the app to work at all, so it is not a toggle.
      </p>
      <p className="text-ink-dim mt-2 text-[0.85rem]">
        Anything optional is off until you accept it, and nothing optional loads before you choose.
      </p>

      {managing && (
        <fieldset className="border-hairline mt-3 border-t pt-3">
          <legend className="sr-only">Optional categories</legend>
          <label className="flex cursor-pointer items-start gap-2.5 text-[0.85rem]">
            <input
              type="checkbox"
              checked={analytics}
              onChange={(e) => setAnalytics(e.target.checked)}
              className="accent-signal mt-1"
            />
            <span>
              <span className="block">Usage records</span>
              <span className="text-ink-faint block text-[0.78rem]">
                Which skills ran and whether they worked. Not your request text. Switching this off
                later deletes what was collected.
              </span>
            </span>
          </label>
        </fieldset>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {/*
          Refuse first and visually identical to accept. A dimmer or smaller
          refusal is the pattern regulators single out.
        */}
        <button
          type="button"
          disabled={saving}
          onClick={() => void decide(false)}
          className="border-hairline-bright hover:bg-ground-sunken flex-1 border px-3 py-2 text-[0.85rem] disabled:opacity-50"
        >
          Necessary only
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void decide(managing ? analytics : true)}
          className="border-hairline-bright hover:bg-ground-sunken flex-1 border px-3 py-2 text-[0.85rem] disabled:opacity-50"
        >
          {managing ? 'Save choices' : 'Accept optional'}
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between text-[0.78rem]">
        <button
          type="button"
          onClick={() => setManaging((m) => !m)}
          className="text-ink-dim hover:text-ink underline underline-offset-2"
        >
          {managing ? 'Hide preferences' : 'Manage preferences'}
        </button>
        <span className="flex gap-3">
          <button
            type="button"
            onClick={() => onOpenPolicy('cookies')}
            className="text-ink-dim hover:text-ink underline underline-offset-2"
          >
            Cookies
          </button>
          <button
            type="button"
            onClick={() => onOpenPolicy('privacy')}
            className="text-ink-dim hover:text-ink underline underline-offset-2"
          >
            Privacy
          </button>
        </span>
      </div>
    </div>
  );
}
