# Recuperação global da geração e estudo do caso Hiper

Data: 29/10/2026. Implementação e verificação concluídas. Escopo: corrigir a causa geral da reincidência e a recuperação em qualquer planejamento, além de ajustar os dados do Hiper mediante escolha explícita do usuário. Não há condicionais por nome, código de filial ou identificador de planejamento no código da correção.

## Causa comprovada

O Hiper tinha 142 cadastros, 136 incluídos, jornada de 42 horas e nenhum dia bloqueado, ausência ou folga fixa. Havia 4.518 faixas marcadas como obrigatórias, sendo 4.308 com mínimo positivo. A mensagem genérica sugeria conferir bloqueios inexistentes e não identificava o conflito real.

A conferência independente encontrou mínimos acima da capacidade semanal. Exemplos: Administrativo, 851h42 exigidas contra no máximo 840h00; Frente de Caixa, 1.499h58 contra 1.428h00; Balcão Padaria, 66h16 contra 42h00. O conflito se repetia nas seis semanas do horizonte técnico. Não era necessário inventar autorizações nem flexibilizar descansos.

## Decisão e alteração autorizada

O usuário escolheu expressamente voltar à cobertura automática estimada. A alteração foi feita pela API autenticada, com revisão esperada, não por edição direta do banco. A revisão anterior permaneceu no histórico. Uma revisão intermediária retirou os mínimos anteriores antes do cálculo das novas estimativas, evitando que aprovações antigas reclassificassem as referências como obrigatórias.

O planejamento passou à revisão 5 com 6.270 faixas estimadas e nenhum mínimo obrigatório. Foram preservados jornada, cadastros, inclusão/exclusão individual, horários, ausências e bloqueios. A geração real retornou FEASIBLE, com 5.712 atribuições para os 136 colaboradores incluídos, e passou pelo verificador independente. A grade calculada não foi aplicada automaticamente: continua sujeita à revisão do usuário.

A prova isolada, usando os dados originais apenas em memória, reproduziu INFEASIBLE em 2,479 segundos e retornou FEASIBLE em 8,016 segundos após trocar somente a cobertura por estimativas. A revisão histórica antiga agora produz cinco diagnósticos específicos de capacidade; a revisão corrigida não produz esses conflitos.

## Correção da experiência

- Foi removida a conversão legada que usava uma confirmação global para transformar estimativas em mínimos obrigatórios na criação ou no salvamento. A origem de cada faixa é preservada; mínimos já explícitos continuam obrigatórios. Não existe migração que apague automaticamente as exigências reais das demais filiais.
- O resultado inviável aparece como **Proposta não gerada**, sem uma mensagem de conclusão bem-sucedida.
- O servidor informa conflitos concretos: setor/função, semana, horas exigidas e limite superior de capacidade. Sobreposições usam o maior mínimo simultâneo, sem contar a mesma exigência duas vezes. Estimativas nunca são tratadas como obrigação; pausas e pessoas sem horário não criam atendimento fictício. A análise considera conservadoramente possíveis parcelas noturnas vindas do dia anterior.
- Trabalho bloqueado em um dia também definido como folga fixa recebe diagnóstico próprio, com colaborador e data para navegação. Nenhuma condição é removida pelo diagnóstico.
- **Conferir cobertura** abre a lista correta após a montagem da área e filtra setor e dia. A lista tem controles próprios de consulta, sem exigir percorrer centenas de páginas sem orientação.
- **Conferir equipe e restrições** abre o painel real de restrições. Quando o conflito identifica uma pessoa, seu editor abre e recebe foco. O botão também funciona ao retornar de outra área e ao repetir a ação.
- A ação **Voltar à cobertura automática** exige confirmação explícita. Cancelar preserva os mínimos. Confirmar altera apenas o rascunho; a geração salva a remoção das obrigações antes de recalcular as estimativas. Bloqueios, ausências e jornada permanecem inalterados.

## Evidência de verificação

- Regressão do serviço reproduzida antes da correção: resultado inviável sem diagnóstico. Após a correção, o caso identifica a insuficiência de cobertura sem apontar bloqueios inexistentes e sem gravação de dados.
- 2.014 testes Vitest aprovados, em 272 arquivos; três testes condicionais não aplicáveis ignorados. TypeScript, lint, operações, cobertura, dead-code, tamanho e gate de rotas aprovados. Um teste de texto ainda usava o rótulo antigo; foi atualizado para conferir a distinção semântica e a ausência de confirmação antecipada, sem reduzir gates.
- Cinco regressões de criação e salvamento reproduziram a promoção indevida antes da correção e passaram depois, em códigos de filiais diferentes e com estados globais CONFIRMED/SUGGESTED. Os testes legados de uma conversão removida foram substituídos por testes na fronteira real de persistência; a preservação de mínimos explicitamente obrigatórios continua verificada.
- 54 testes de navegador aprovados no gate isolado. Os casos novos usam a API e o solver reais, sem simular resposta de geração: inviabilidade por cobertura, valores explicativos, navegação por teclado, filtros e foco, repetição do botão, cancelamento, confirmação, nova geração, aplicação e persistência de estimativas.
- Um segundo caso real de solver usa trabalho bloqueado em folga fixa e verifica que o botão abre o colaborador correto sem alterar o bloqueio ou o descanso.
- Os três fluxos alterados também são executados contra o build de produção. O terceiro cria e salva outras duas filiais pela API real e comprova que a confirmação antiga não endurece estimativas nem enfraquece mínimos explícitos. Compose é conferido com os arquivos protegidos; a publicação conserva imagens de recuperação e não limpa caches compartilhados. Depois, são conferidos saúde dos serviços, revisão em execução e login autenticado.

## Limites

O diagnóstico apresenta condições necessárias comprovadas, não um núcleo completo de toda inviabilidade possível. Quando não localiza um conflito pontual, a mensagem declara essa limitação e abre a conferência, sem atribuir uma causa inventada. FEASIBLE não comprova ótimo global, e uma referência estimada não garante demanda operacional satisfeita. Esta correção não contém migração de banco nem altera senhas ou segredos.
