"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

type AppTheme = "dark" | "light";
const THEME_EVENT = "app-theme-change";

function readTheme(): AppTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function readServerTheme(): AppTheme {
  return "dark";
}

function subscribeToTheme(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

function toggleTheme() {
  const nextTheme = readTheme() === "dark" ? "light" : "dark";
  const root = document.documentElement;
  root.dataset.theme = nextTheme;
  root.classList.toggle("light", nextTheme === "light");
  root.classList.toggle("dark", nextTheme === "dark");
  try {
    window.localStorage.setItem("app-theme", nextTheme);
  } catch {
    // The toggle still works for the current page when storage is blocked.
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { theme: nextTheme } }));
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, readServerTheme);

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      aria-label={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
      title={isDark ? "Tema claro" : "Tema escuro"}
      onClick={toggleTheme}
      className="app-icon-button"
    >
      {isDark ? (
        <Sun className="size-4" aria-hidden="true" />
      ) : (
        <Moon className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
