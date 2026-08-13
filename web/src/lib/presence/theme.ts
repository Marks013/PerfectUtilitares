import {
  defaultPresenceTheme,
  type PresenceTheme,
  presenceThemeSchema,
} from "@/lib/presence/schema";

export function parsePresenceTheme(value: unknown): PresenceTheme {
  const parsed = presenceThemeSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultPresenceTheme;
}
