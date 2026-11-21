import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EscalaAccessProvider } from "./access-context";

/** Existing UI scenarios explicitly exercise the administrator view. */
export function renderAsAdministrator(element: ReactNode) {
  return renderToStaticMarkup(<EscalaAccessProvider value={{ channel: "ACCOUNT", roleLabel: "Administrador", administrator: true, allBranches: true, branches: [] }}>{element}</EscalaAccessProvider>);
}
