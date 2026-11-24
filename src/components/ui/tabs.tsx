"use client";

import { useId, useRef, useState, type ReactNode } from "react";

export function Tabs({ label, items }: { label: string; items: { title: string; content: ReactNode }[] }) {
  const id = useId();
  const [current, setCurrent] = useState(0);
  const controls = useRef<(HTMLButtonElement | null)[]>([]);

  return (
    <>
      <div className="ui-tabs" role="tablist" aria-label={label} onKeyDown={(event) => {
        const moves = { ArrowLeft: (current + items.length - 1) % items.length,
          ArrowRight: (current + 1) % items.length, Home: 0, End: items.length - 1 };
        if (!Object.hasOwn(moves, event.key)) return;
        event.preventDefault();
        const next = moves[event.key as keyof typeof moves];
        setCurrent(next);
        controls.current[next]?.focus();
      }}>
        {items.map(({ title }, index) => <button key={title} type="button" role="tab"
          id={id + "-tab-" + index} aria-selected={current === index} aria-controls={id + "-panel-" + index}
          tabIndex={current === index ? 0 : -1} ref={(element) => { controls.current[index] = element; }}
          onClick={() => setCurrent(index)}>{title}</button>)}
      </div>
      {items.map(({ title, content }, index) => (
        <div key={title} role="tabpanel" className="ui-tab-panel" hidden={current !== index}
          id={id + "-panel-" + index} aria-labelledby={id + "-tab-" + index}>{content}</div>
      ))}
    </>
  );
}
