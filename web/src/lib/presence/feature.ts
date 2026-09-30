/** Set EVENTS_ENABLED=true on the app and worker to resume the preserved module. */
export function isEventsEnabled() {
  return process.env.EVENTS_ENABLED === "true";
}

export function isEventsPath(pathname: string) {
  return ["/admin/presencas", "/api/admin/presencas", "/presenca", "/api/presenca", "/p", "/api/webhooks/resend"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
