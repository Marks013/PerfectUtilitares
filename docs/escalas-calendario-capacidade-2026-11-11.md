# Escalas: calendário, referência importada e capacidade

Implementação de 11/11/2026. O calendário é uma referência operacional de planejamento,
não um parecer jurídico, autorização de abertura ou cálculo de folha de pagamento.

## Comportamento

- Horário FPRE136 compatível com cinco dias na jornada escolhida fica fixo nos dias livres.
  As conversões 44/42/40 continuam disponíveis. Contratos individuais, edições manuais,
  bloqueios e afastamentos não são substituídos por uma estimativa de cobertura.
- A seleção de planejamentos é separada por filial, ano e mês. Um mês novo é outro
  planejamento; períodos legados e duplicados continuam acessíveis.
- Calendário local: filial 02 usa Icaraíma-PR; demais filiais usam Umuarama-PR, por decisão
  operacional do responsável. Datas nacionais e municipais recorrentes são calculadas
  sem pontos facultativos, Carnaval ou 19/12. O modo manual mantém datas editáveis.
- Feriado aberto em dia útil não substitui a folga regular. Se cair no domingo,
  a folga dominical permanece permitida.
- O perfil fecha em 01/01, 01/05 e 25/12. FE/HOLIDAY identifica o fechamento, não falta
  ou trabalho fictício. Em dia útil, não consome as duas folgas regulares; no domingo,
  conta como descanso dominical. O relatório soma somente as horas trabalhadas.
  Nenhum crédito remuneratório, compensação futura ou autorização é inventado.
- A capacidade por setor compara 44h, 42h e 40h nominais. Exemplo: dez pessoas entregam
  440h, 420h ou 400h. Equivalentes de pessoas são comparação matemática, não demanda
  confirmada nem recomendação de contratação. Afastamentos, feriados e cobertura por
  horário permanecem análises distintas.

## Fontes e limites

- [Icaraíma: Lei 1.426/2017](https://www.icaraima.pr.leg.br/leis/legislacao-municipal-1/leis-2017/lei-1426-2017-dispoe-sobre-feriados-municipais-e-da-outras-providencias).
- [Prefeitura de Umuarama: calendário municipal](https://www.umuarama.pr.gov.br/public/umuarama).
- Feriados nacionais: leis 662/1949, 6.802/1980 e 14.759/2023. Datas futuras seguem as
  regras recorrentes conhecidas; decretos futuros não foram presumidos.
- Os três fechamentos são a regra deste perfil solicitada pelo responsável. A consulta
  direta ao instrumento MR065022/2026 no Mediador não esteve acessível nesta execução;
  não foi certificada sua abrangência para Icaraíma ou para todas as filiais.
