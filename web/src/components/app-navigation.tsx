"use client";

import { useId, useState } from "react";

export function AppNavigation({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="app-navigation" data-open={open} data-compact={compact} onKeyDown={(event) => {
      if (event.key === "Escape") {
        setOpen(false);
        event.currentTarget.querySelector("button")?.focus();
      }
    }}>
      <button type="button" className="app-nav-link app-menu-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>Menu</button>
      <div id={id} className="app-navigation-panel" onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) setOpen(false);
      }}>
        {children}
      </div>
    </div>
  );
}
