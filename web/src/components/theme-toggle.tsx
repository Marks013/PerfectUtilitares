"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type AppTheme = "dark" | "light";

function readTheme(): AppTheme {
  if (typeof document === "undefined") {
    return "dark";
  }

  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("light", theme === "light");
  document.documentElement.classList.toggle("dark", theme === "dark");
  window.localStorage.setItem("app-theme", theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<AppTheme>("dark");

  useEffect(() => {
    setTheme(readTheme());

    function syncTheme(event: Event) {
      const customEvent = event as CustomEvent<{ theme?: AppTheme }>;
      setTheme(customEvent.detail?.theme === "light" ? "light" : readTheme());
    }

    window.addEventListener("app-theme-change", syncTheme);
    return () => window.removeEventListener("app-theme-change", syncTheme);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    setTheme(nextTheme);
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      aria-label={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
      title={isDark ? "Tema claro" : "Tema escuro"}
      onClick={toggleTheme}
      className="inline-flex size-10 items-center justify-center rounded-md border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
    >
      {isDark ? (
        <Sun className="size-4" aria-hidden="true" />
      ) : (
        <Moon className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
