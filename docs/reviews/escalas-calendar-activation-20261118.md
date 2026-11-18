# Ativação operacional da semana domingo–sábado

## Mudança em relação à fundação da PR #35

A revisão anterior `b2aadd66` continha a fundação de calendário, ainda sem ativação. Esta implementação conecta o metadado semanal à criação, importação do cenário, carga efetiva, Solver Python, verificador independente, cobertura estimada, capacidade, reparos, comparação de candidatas, interface e relatórios.

`planningWeekStartsOn: "SUNDAY"` significa domingo a sábado. Domingo pertence somente à semana iniciada naquela data. A ausência do metadado mantém a leitura histórica segunda–domingo. Os identificadores de dia continuam segunda=0 e domingo=6; preferências, sábados, feriados e restrições individuais não foram renumerados.

Novos planejamentos usam domingo a sábado. Para dezembro/2026, o horizonte completo vai de 29/11/2026 a 02/01/2027; a apresentação mensal continua restrita a dezembro. A contagem de trabalho, folgas e minutos semanais usa o mesmo agrupamento no Python e no TypeScript.

## Planejamentos existentes

Uma revisão antiga não é reinterpretada silenciosamente. A interface identifica seu calendário e oferece **Usar semana de domingo a sábado**. A ação explícita `UPGRADE_CALENDAR`, com ID e revisão esperada, cria outro rascunho e registra `planningCalendarSource`; o planejamento original permanece intacto.

Datas dos colaboradores não são deslocadas. Decisões protegidas que saem do horizonte técnico ficam como continuidade datada e protegida. Essa continuidade é restaurada a partir da revisão salva, não aceita por confiança no cliente. A origem não pode ser forjada em CREATE nem removida ou alterada em SAVE. Prioridades de movimento e vigências manuais são intersectadas com o novo horizonte; os dados completos permanecem na origem.

A cópia fica desatualizada até nova geração. Não há geração, aplicação ou publicação implícita. **Apenas horários** continua sem inventar dias: se a ampliação introduzir uma data sem classificação conhecida, use uma geração de folgas para montar essa base antes de ajustar somente horários. Mínimos obrigatórios, afastamentos, bloqueios e compromissos publicados continuam protegidos.

O vínculo de origem registra a revisão imutável usada, não uma promessa de ser sempre a revisão mais recente. Excluir posteriormente a origem é uma ação independente e explícita; a continuidade protegida já copiada é autocontida no rascunho novo.

## Verificação e liberação

As regressões incluem semanas concretas com cinco dias de trabalho e duas folgas, rejeição do domingo emprestado à semana anterior, ENC sem horas fictícias, feriados, jornada mista, transição de dezembro, virada do ano, persistência da conversão e arquivos PDF/XLSX reais. O verificador Python×TypeScript acrescenta cenários dominicais positivos e negativos. O E2E utiliza somente a base descartável nativa para conferir a ação e a persistência real; nenhuma grade de produção é criada por efeito da implantação.

Testes legados que sobrescreviam datas de um novo planejamento passaram a usar um construtor explicitamente legado. Não foram enfraquecidas as asserções de cobertura, jornada, preservação ou segurança para acomodar o novo padrão.

Este documento descreve a implementação. A aprovação final do quality, a revisão efetivamente implantada, os resultados, falhas intermediárias e limitações devem ser registrados na evidência de liberação. Não constitui antecipação de CI verde, implantação ou melhora medida de distribuição nas filiais reais.

O módulo `planning_calendar.py` entra no COPY explícito da imagem e no smoke de importação não-root. Não houve mudança de dependências, objetivos, limites operacionais, regra de 4h30/9h, orçamento do Solver, cores ou permissões.

## Recuperação

Depois que revisões SUNDAY existirem, não retornar a um leitor antigo que rejeite esse metadado. Uma correção ou reversão deve conservar a leitura das duas convenções e a continuidade copiada, sem reescrever revisões salvas. Backups e imagens de recuperação não autorizam sobrescrever dados novos sem conferência e autorização específicas.
