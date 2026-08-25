import { useEffect, useRef, useState } from "react";

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: any) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    onloadTurnstileCallback?: () => void;
  }
}

export function TurnstileWidget({ onVerify, onExpire, onError }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [devChecked, setDevChecked] = useState(false);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || "test-site-key";
  // Demo/dev mode: no real site key configured, so render a fake checkbox that
  // yields the "test-token" accepted by the backend when TURNSTILE_SECRET=test.
  const devMode = siteKey === "test-site-key";

  useEffect(() => {
    if (devMode) return;
    // Load Turnstile script
    if (window.turnstile) {
      setLoaded(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => setLoaded(true);
    document.body.appendChild(script);

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
    };
  }, [devMode]);

  useEffect(() => {
    if (devMode || !loaded || !containerRef.current || !window.turnstile) return;
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: "light",
      callback: (token: string) => onVerify(token),
      "expired-callback": () => onExpire?.(),
      "error-callback": () => onError?.(),
    });

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [devMode, loaded, siteKey, onVerify, onExpire, onError]);

  if (devMode) {
    return (
      <label className="flex items-center gap-2 border rounded px-3 py-2 text-sm text-slate-700 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={devChecked}
          onChange={(e) => {
            setDevChecked(e.target.checked);
            if (e.target.checked) {
              onVerify("test-token");
            } else {
              onExpire?.();
            }
          }}
        />
        Verify you are human
      </label>
    );
  }

  return (
    <div ref={containerRef} className="flex justify-center" />
  );
}
