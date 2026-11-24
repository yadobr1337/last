"use client";

import { useEffect, useRef, useState } from "react";
import { Notice } from "@/components/ui/feedback";

interface SmartCaptchaApi {
  render(container: HTMLElement, options: { sitekey: string; hl: "ru"; callback: (token: string) => void }): number;
  subscribe(id: number, event: "token-expired" | "network-error" | "javascript-error", callback: () => void): () => void;
  reset(id: number): void;
  destroy(id: number): void;
}

declare global {
  interface Window {
    smartCaptcha?: SmartCaptchaApi;
    onOneVpnSmartCaptchaReady?: () => void;
  }
}

export function SmartCaptchaWidget({ siteKey, onVerify, resetSignal }: {
  siteKey: string;
  onVerify: (token: string) => void;
  resetSignal: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const fail = () => {
      onVerify("");
      setError(true);
    };
    const render = () => {
      const api = window.smartCaptcha;
      if (!api || widgetId.current !== null) return;
      try {
        const id = api.render(element, {
          sitekey: siteKey,
          hl: "ru",
          callback: (token) => {
            setError(false);
            onVerify(token);
          },
        });
        widgetId.current = id;
        api.subscribe(id, "token-expired", () => onVerify(""));
        api.subscribe(id, "network-error", fail);
        api.subscribe(id, "javascript-error", fail);
      } catch {
        fail();
      }
    };

    const script = document.createElement("script");
    if (window.smartCaptcha) {
      render();
    } else {
      window.onOneVpnSmartCaptchaReady = render;
      script.src = "https://smartcaptcha.cloud.yandex.ru/captcha.js?render=onload&onload=onOneVpnSmartCaptchaReady";
      script.async = true;
      script.onerror = fail;
      document.head.appendChild(script);
    }

    return () => {
      script.onerror = null;
      script.remove();
      if (window.onOneVpnSmartCaptchaReady === render) delete window.onOneVpnSmartCaptchaReady;
      if (widgetId.current !== null) window.smartCaptcha?.destroy(widgetId.current);
      widgetId.current = null;
    };
  }, [onVerify, siteKey]);

  useEffect(() => {
    if (widgetId.current !== null) window.smartCaptcha?.reset(widgetId.current);
  }, [resetSignal]);

  return (
    <div className="space-y-2">
      <div className="min-h-[100px]" ref={container} aria-label="Проверка Яндекс SmartCaptcha" />
      {error ? <Notice tone="danger">SmartCaptcha не загрузилась. Обновите страницу и попробуйте снова.</Notice> : null}
    </div>
  );
}
