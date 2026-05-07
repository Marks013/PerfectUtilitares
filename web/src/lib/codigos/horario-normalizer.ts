const HORARIO_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function normalizarHorarios(horarios: string): string {
  if (!horarios || !horarios.trim()) {
    return "";
  }

  return horarios.trim().split(/[ \t]+/).map((item) => item.trim()).join(" ");
}

export function validarHorariosNormalizados(
  horariosNormalizado: string,
): { valido: true } | { valido: false; mensagem: string } {
  if (!horariosNormalizado) {
    return { valido: false, mensagem: "Horários obrigatórios" };
  }

  const pontos = horariosNormalizado.split(" ");

  if (pontos.length !== 2 && pontos.length !== 4) {
    return {
      valido: false,
      mensagem: "Informe 2 ou 4 horários no formato HH:MM",
    };
  }

  const invalido = pontos.find((ponto) => !HORARIO_PATTERN.test(ponto));
  if (invalido) {
    return {
      valido: false,
      mensagem: `Horario invalido: ${invalido}`,
    };
  }

  return { valido: true };
}
