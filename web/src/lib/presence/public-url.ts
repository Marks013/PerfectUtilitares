export function presenceShortUrlForOrigin(value: string, origin: string) {
  const target = new URL(value, origin);
  if (!/^\/p\/p_[A-Za-z0-9_-]{16}$/.test(target.pathname)) {
    throw new Error("Link curto de convite inválido.");
  }

  const publicOrigin = new URL(origin).origin;
  return new URL(target.pathname, publicOrigin).toString();
}
