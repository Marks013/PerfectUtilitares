# Turnos e relatórios — guia de contratos e operação

Atualizado em 13/11/2026. Este guia descreve os contratos e o fluxo de operação de turnos e relatórios; não constitui evidência de testes ou de liberação de produção. Consulte também [Operação de Escalas](OPERACAO.md).

## Preparar e revisar

1. Escolha empresa, filial e mês/ano; abra o planejamento existente antes de criar outro para o mesmo período.
2. Importe a equipe pelo FPRE136 e confira filial, matrícula, cargo, setor, referências originais e exclusões. Afastamentos opcionais exigem conciliação inequívoca por matrícula/filial, com revisão do período. Quem não aparece no arquivo de afastamentos não é excluído.
3. Escolha a carga semanal e o modo. A referência importada 6×1 permanece disponível para comparação; a operação 5×2 começa em **01/12/2026**. Novembro de teste não vira histórico real automaticamente. A carga proposta não altera um contrato de trabalho.
4. Gere a proposta, confira os avisos e compare original/proposto antes de aplicar e salvar. Observe jornada, pausas, descanso, fechamento, cobertura e bloqueios. Sem grade, preparar referências não inventa calendário, presença ou folga.
5. Exporte a revisão escolhida depois da conferência. Uma configuração ou revisão alterada exige nova preparação; confirmação antiga não aplica nem substitui dados atuais.

| Modo | Resultado esperado |
|---|---|
| Só folgas | Distribui dias de trabalho e folga, mantendo as referências de relógio; preserva exceções bloqueadas. |
| Só horários | Ajusta referências; com grade, preserva a classificação dos dias. Sem grade, entrega apenas referências. |
| Folgas e horários | Distribui dias e procura horários permitidos, respeitando as restrições. |

Quatro zeros confirmados no FPRE136 representam UNTIMED/ENC, sem relógio fictício; um período válido com outro par zerado continua TIMED. Incompletos exigem conferência. Afastamento não é folga nem presença horária. Aprendizes e principal válido inferior a 6h permanecem excluídos da geração conforme a regra cadastrada, preservando cadastro e origem. Sábado de 4h com principal de 8h continua elegível.

## Catálogo e troca por vigência

O catálogo é global **dentro da empresa**, compartilhado pelas filiais. O código numérico começa em 1500. Na primeira sincronização, confirme o conjunto de fontes e revisões selecionadas: a operação é atômica, deduplica as quatro marcações e ordena a tupla antes de numerar. Depois, marcações e códigos emitidos são imutáveis; entradas novas recebem o próximo número, sem renumeração ou reciclagem. **Código do catálogo, matrícula e legenda local Txx são identidades diferentes.**

Para trocar um turno, selecione a pessoa, o código e as datas inicial/final. Confira dias afetados, preservados e conflitos antes de confirmar. O CSV original fica preservado. A seleção datada não obriga WORK, não cria locked e não reescreve afastamentos, folgas, feriados ou bloqueios. Um WORK bloqueado incompatível exige resolução explícita; não há substituição silenciosa.

Fora da vigência, continuam as opções de base. Salvar, reabrir ou reimportar deve conservar origem e decisões manuais; alteração de vigência muda o fingerprint e exige conferência da revisão. No contrato interno, `manualShiftByDate` deriva de `manualShiftOverrides`; `shiftIds` contém somente a base. Um turno exclusivamente manual não pode ampliar as opções de outras datas. Limites operacionais continuam obrigatórios.

## Exportar os dois TXT

Escolha mês/ano e **um planejamento/revisão por filial da empresa autorizada**. Se houver variantes por semana ou data, escolha explicitamente a referência de cada pessoa; não usar o primeiro turno ou resumir apenas pela duração. Ambos os arquivos usam o mesmo manifesto.

Confira inclusões e confirme omissões com seus motivos. ENC, horários incompletos e referências irrepresentáveis não recebem zeros fictícios. Exclusão apenas da geração não impede exportar uma referência válida explicitamente selecionada. Matrículas conflitantes entre filiais precisam ser resolvidas porque o layout não informa filial.

O manifesto possui validade limitada (TTL), expiração exibida e vínculo com ator, empresa e revisões. Manifesto expirado ou stale exige nova prévia e confirmação; não aplica uma seleção antiga.

- **TXT1:** `matrícula,entrada,saída,entrada,saída`; matrícula textual com zeros iniciais preservados.
- **TXT2:** `código,nome,entrada,saída,entrada,saída`; uma linha por código distinto. Nome padrão: quatro marcações separadas por espaços.
- Ambos: UTF-8 sem BOM, CRLF, sem cabeçalho, horários HH:mm. Não há sistema destinatário identificado nem compatibilidade externa comprovada.

Exemplo **sintético**, sem vínculo com cadastro ou código real:

```text
TXT1: 000000,08:00,12:00,14:00,18:24
TXT2: 1500,08:00 12:00 14:00 18:24,08:00,12:00,14:00,18:24
```

Os prefixos TXT1/TXT2 acima são explicativos e não integram os arquivos.

## PDF operacional e relatórios regulares

A aba **PDF operacional** é opcional, exclusivamente PDF e acionada por escolha explícita, sem autosave ou geração. Selecione a revisão salva, o mês visível, setores e seções: calendário mensal, jornadas/turnos, variantes, presença por horário, cobertura e resumo. Presença exige um dia do mês. Sem grade, somente jornadas e variantes ficam disponíveis. Dias do horizonte técnico adjacente não entram no relatório mensal.

Nos PDF/XLSX regulares, desfalques aparecem em horários/completo, não em só folgas. Quantidade prevista e referência pertencem ao **mesmo instante do pico**. Estimativa não é demanda confirmada; recorrência conta dias distintos com falta, não faixas repetidas. Horas acumuladas da equipe não indicam pessoas a contratar. Valor desconhecido permanece identificado, não vira zero.

O XLSX de desfalques contém 12 colunas: setor, origem, previstas, referência, maior desfalque, dia, horário, duração da faixa, dias com falta, falta acumulada da equipe, tempo com falta e observado no pico. Datas e contagens mantêm tipos próprios; durações usam `[h]:mm`, inclusive acima de 24h. Tela e arquivos devem conservar unidades e variantes coerentes.

## Qualidade e liberação

A [CI existente](../../.github/workflows/ci.yml) separa código, Solver e E2E com banco adequado. Em `web/`, os comandos reais de gate são `npm run quality:code`, `npm run test:escalas:python`, `npm run test:escalas:model`, `npm run test:escalas:properties`, `npm run test:e2e:isolated` e `npm run build`. `npm run quality` reúne código e E2E. A coordenação escolhe a rodada final afetada, sem repetir gates válidos; não execute o runner de banco descartável em produção.

Os novos E2Es de mutação exigem `E2E_MUTATION=1`; o caso de catálogo inicialmente vazio também exige `E2E_EMPTY_TURNO_CATALOG=1` e banco/tenant realmente adequado no CI. Inicialização deve ocorrer antes dos testes que populam o catálogo. Só esse cenário usa `retries: 0`; isso não altera a política geral de retries. Uma nova tentativa requer estado inicial novo, sem apagar catálogo utilizado. Flags não substituem preparação nem autorização.

Contratos de referência: [catálogo](../../web/src/lib/escalas/shift-catalog/contracts.ts) e [PDF operacional](../../web/src/lib/escalas/operational-report-contracts.ts). Testes funcionais, inspeção dos arquivos, CI e produção dependem do gate final; não são apresentados como concluídos neste guia.
