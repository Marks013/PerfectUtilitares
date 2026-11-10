# Fechamento da loja e relatório de jornadas mistas

Data: 10 de novembro de 2026.

## Uso

Na etapa **Escolher jornada e gerar**, o campo **Fechamento da loja** define até que horas as propostas automáticas podem terminar. O padrão é **20:00** para todas as filiais, exceto a **18**, cujo padrão é **22:00**. Códigos numéricos com zeros à esquerda preservam a mesma identidade da filial.

O horário pode ser alterado e salvo em cada planejamento. **Usar padrão da filial** remove a escolha manual. **00:00** significa fechamento à meia-noite, no fim do dia. Essa configuração operacional não altera autorizações trabalhistas nem confirma a viabilidade de qualquer duração de jornada.

Mudar o fechamento marca os resultados anteriores para nova geração, mantendo a grade visível para comparação. A estimativa de cobertura é recalculada; mínimos operacionais informados manualmente são preservados. A invalidação também ocorre no servidor, mesmo se um cliente omitir o indicador de proposta desatualizada.

## Geração

As jornadas propostas são deslocadas integralmente para mais cedo quando necessário, sem reduzir minutos trabalhados nem a duração do intervalo. Alternativas ordinárias, flexíveis e mistas respeitam o fechamento. A opção mista mantém sua janela diurna e o intervalo de três horas nos dias de nove horas.

As referências originais importadas, históricos, ausências e bloqueios não são reescritos. Se um dia bloqueado termina após o fechamento escolhido, a geração explica o conflito e preserva o registro. O responsável pode corrigir o horário bloqueado, desbloquear deliberadamente o dia ou ajustar o fechamento; o sistema não flexibiliza essa decisão sozinho.

## PDF e XLSX

O relatório de horários apresenta os dias e semanas em que cada variante da jornada mista foi efetivamente usada. O intervalo de três horas aparece explicitamente nos dias de nove horas. Semanas com ausência, dias fora do mês visível e transição de carga não são preenchidas artificialmente como três dias de oito horas e dois de nove horas.

## Validação real do Solver

Foram usadas cópias em memória dos dados reais das filiais 08 e 18, selecionando os setores críticos existentes para exercitar a jornada mista. Nenhuma regra mista foi ativada nem resultado sobrescrito nos planejamentos apenas para esse teste.

- Filial 08: proposta FEASIBLE em 13,148 s, 169 semanas completas mistas e 341 dias de nove horas, todas as saídas até 20:00.
- Filial 18: proposta FEASIBLE em 13,292 s, 249 semanas completas mistas e 498 dias de nove horas, todas as saídas até 22:00.
- Nas 418 semanas completas conferidas: três dias de 480 minutos, dois de 540 minutos, total de 2.520 minutos (42 horas), intervalo de 180 minutos nos dias longos e duas folgas. Ausências e decisões bloqueadas foram preservadas; o validador independente retornou zero erros.
- O motor Python não precisou ser alterado: ele escolhe as alternativas recebidas, agora preparadas dentro da janela de funcionamento. FEASIBLE significa solução válida encontrada, não prova de ótimo nem garantia de cobertura integral.

A prévia de oito planejamentos existentes também passou: nenhuma opção livre após o fechamento, sem alteração dos dados originais. Os testes focados incluem configuração, persistência, retorno ao padrão, idempotência, referências protegidas e leitura real dos arquivos exportados. O relatório de entrega registra os controles finais e a revisão implantada.
