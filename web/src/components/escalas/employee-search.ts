import { sortEmployees } from "@/lib/escalas/order";
import type { EscalaEmployee } from "@/lib/escalas/types";

function searchText(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim();
}
export function indexEmployees(employees: EscalaEmployee[]) {
  return sortEmployees(employees).map(employee => ({ employee,
    text: searchText(`${employee.name} ${employee.registration} ${employee.sector} ${employee.role}`),
  }));
}
export function searchEmployees(index: ReturnType<typeof indexEmployees>, query: string) {
  const text = searchText(query);
  return index.filter(item => !text || item.text.includes(text)).map(item => item.employee);
}
