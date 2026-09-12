"use client";

import { useEffect, useId, useRef, useState } from "react";

export function AppNavigation({
  children,
  compact = false,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const navigation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = navigation.current;
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        element.querySelector("button")?.focus();
      }
    };
    const onClick = (event: MouseEvent) => {
      // Native link clicks also cover keyboard activation with Enter.
      if (event.target instanceof Element && event.target.closest("a"))
        setOpen(false);
    };
    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("click", onClick);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("click", onClick);
    };
  }, []);
  return (
    <div
      ref={navigation}
      className="app-navigation"
      data-open={open}
      data-compact={compact}
    >
      <button
        type="button"
        className="app-nav-link app-menu-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        Menu
      </button>
      <div id={id} className="app-navigation-panel">
        {children}
      </div>
    </div>
  );
}
