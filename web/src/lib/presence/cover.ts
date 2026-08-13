import type { PresenceTheme } from "@/lib/presence/schema";

export type PresenceCover = PresenceTheme["cover"];

export const presenceCoverOptions: Array<{
  value: PresenceCover;
  label: string;
  image: string | null;
  alt: string;
}> = [
  {
    value: "EVENT_TABLE",
    label: "Celebração",
    image: "/presence/event-table.png",
    alt: "Mesa preparada para uma celebração",
  },
  {
    value: "WEDDING",
    label: "Casamento",
    image: "/presence/covers/wedding.webp",
    alt: "Mesa de casamento ao ar livre",
  },
  {
    value: "BIRTHDAY",
    label: "Aniversário",
    image: "/presence/covers/birthday.webp",
    alt: "Mesa colorida de aniversário",
  },
  {
    value: "KITCHEN_TEA",
    label: "Chá de cozinha",
    image: "/presence/covers/kitchen-tea.webp",
    alt: "Cozinha preparada para um chá de cozinha",
  },
  {
    value: "BABY_SHOWER",
    label: "Chá de bebê",
    image: "/presence/covers/baby-shower.webp",
    alt: "Mesa delicada de chá de bebê",
  },
  { value: "NONE", label: "Sem fotografia", image: null, alt: "" },
];

export function presenceCover(value: PresenceCover) {
  return (
    presenceCoverOptions.find((option) => option.value === value) ??
    presenceCoverOptions[0]
  );
}
