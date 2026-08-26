import { FeriasError } from "./errors";

export const FERIAS_CALENDAR_VERSION = "umuarama-2026-v1";

// Municipal holidays retain their date; administrative optional days are excluded.
// https://umuarama.pr.gov.br/files/Atos/arquivo/decreto%20-%201770298375.pdf
// https://umuarama.pr.gov.br/noticias/administracao/umuarama-ter-feriado-na-quinta-4-e-ponto-facultativo-na-sexta-feira-5
const HOLIDAYS_2026 = new Set([
	"2026-01-01",
	"2026-04-03",
	"2026-04-21",
	"2026-05-01",
	"2026-06-04",
	"2026-06-26",
	"2026-08-15",
	"2026-09-07",
	"2026-10-04",
	"2026-10-12",
	"2026-11-02",
	"2026-11-15",
	"2026-11-20",
	"2026-12-25",
]);

const DAY_MS = 86_400_000;

export class FeriasCalendarError extends FeriasError {
	constructor(message: string) {
		super("FERIAS_CALENDAR_INVALID", message);
		this.name = "FeriasCalendarError";
	}
}

function parseDate(value: string): Date {
	if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) {
		throw new FeriasCalendarError(
			"Informe uma data válida no formato AAAA-MM-DD.",
		);
	}
	const [year, month, day] = value.split("-").map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.toISOString().slice(0, 10) !== value) {
		throw new FeriasCalendarError("O período contém uma data inexistente.");
	}
	return date;
}

function businessDay(date: Date): boolean {
	return (
		date.getUTCDay() !== 0 &&
		date.getUTCDay() !== 6 &&
		!HOLIDAYS_2026.has(date.toISOString().slice(0, 10))
	);
}

export function vacationHighlight(
	start: string,
	end: string,
): { days: number; highlight: boolean; nonBusinessStart: boolean } {
	const first = parseDate(start);
	const last = parseDate(end);
	const days = (last.getTime() - first.getTime()) / DAY_MS + 1;
	if (days < 1) {
		throw new FeriasCalendarError(
			"A data final está antes da data inicial. Confira o período digitado.",
		);
	}
	if (days > 30) {
		throw new FeriasCalendarError(
			"O período ultrapassa 30 dias e parece conter erro de digitação. Confira as datas de início e fim.",
		);
	}
	if (first.getUTCFullYear() !== 2026) {
		throw new FeriasCalendarError(
			"O calendário de feriados deste ano ainda precisa ser revisado. Use um período iniciado em 2026.",
		);
	}
	let businessDays = 0;
	const secondBusinessDay = new Date(
		Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1),
	);
	for (let offset = 0; offset < 31; offset += 1) {
		if (businessDay(secondBusinessDay)) businessDays += 1;
		if (businessDays === 2) break;
		secondBusinessDay.setUTCDate(secondBusinessDay.getUTCDate() + 1);
	}
	return {
		days,
		highlight: days < 30 || first.getTime() >= secondBusinessDay.getTime(),
		nonBusinessStart: !businessDay(first),
	};
}
