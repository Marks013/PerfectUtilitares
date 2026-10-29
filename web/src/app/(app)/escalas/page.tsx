import { redirect } from "next/navigation";

export const metadata = { robots: { index: false, follow: false }, title: "Escalas 5×2" };
export default function EscalasAliasPage() { redirect("/escala"); }
