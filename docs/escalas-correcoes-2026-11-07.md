# Correções da auditoria das propostas de Escalas — 07/11/2026

Estado: implementação e validação concluídas. Este registro descreve código, critérios e evidências anteriores à liberação. O relatório de entrega registra o commit efetivamente implantado e a verificação posterior. Não é um plano de funcionalidades futuras.

## Correções

1. Horários automáticos passam a oferecer até quatro alternativas por duração, somente no modo de folgas e horários. Referências manuais, originais, afastamentos, bloqueios, limites individuais e limites globais de 120 horários/12 por pessoa permanecem protegidos. Opções extras que não cabem são ignoradas, sem impedir uma grade antes válida.
2. Referências curtas utilizam a duração efetiva. Repreparar uma grade não apaga dias de trabalho cujo horário continua permitido, nem libera para outros dias um turno mantido apenas por um bloqueio.
3. O polimento não congela objetivos operacionais por estabilidade ou desempate de prioridade inferior. Reparo inclui setores pequenos e vizinhanças alternadas, dentro do orçamento existente. A resposta admite dez objetivos e até quatro reparos, sem truncar fases.
4. Um refinamento local limitado tenta uma troca de trabalho/folga na mesma semana e no mesmo horário. Não toca domingos, afastamentos, bloqueios ou jornadas que atravessam a meia-noite. A retirada não pode aumentar o déficit daquele dia nem deixar o setor vazio. Reutiliza os verificadores existentes, sem duplicar regras.
5. A proposta inicial é enviada como dica privada `_initialAssignments`, separada de `assignments`. A grade salva continua sendo a referência para regras e contagem de pessoas/registros alterados. O Python verifica a dica no modelo; dica inválida não substitui a grade original nem prova impossibilidade.
6. O refinamento usa prazo monotônico cooperativo de até 1.500 ms e verifica no máximo 32 candidatos. Falhas inesperadas geram erro estruturado, sem registrar dados pessoais; não são ocultadas como ausência de melhoria.
7. `coverageBasis` identifica os insumos da referência estimada. Alternativas extras e trocas de WORK/OFF desbloqueadas não mudam o alvo. Alterações reais de equipe, carga, horários-base, afastamentos, restrições ou mínimos invalidam a referência. Grades legadas completas, válidas e compatíveis preservam sua estimativa ao receber a assinatura; não há migração silenciosa da régua.
8. Dias inteiros sem cobertura com horário são distinguidos de déficit contra uma referência positiva. Dias ainda não preenchidos não são apresentados como ausência operacional confirmada. Pessoas ENC podem estar escaladas, mas não são contadas como cobertura horária garantida.
9. Interface, PDF e XLSX agrupam os diagnósticos por setor em ordem portuguesa A–Z, com ordenação numérica coerente. As exportações distinguem dia inteiro de alguma faixa, sem repetir cargos em páginas separadas.
10. O resumo de domingos separa o mês visível do horizonte técnico e informa folgas, trabalho, afastamentos e dias sem definição. Trabalho iniciado no sábado não vira folga dominical fictícia.

## Evidência real

Comparação acumulada com a auditoria inicial, sobre as mesmas referências estimadas. Valores são pessoas-minutos, não vagas nem demanda comercial comprovada.

| Filial | Desfalque inicial | Desfalque após os ajustes validados | Domingo inicial | Domingo após |
| --- | ---: | ---: | ---: | ---: |
| 02 | 29.788 | 29.284 | 3.820 | 3.820 |
| 06 | 104.754 | 104.250 | 11.862 | 11.862 |
| 07 | 95.990 | 94.712 | 10.996 | 10.996 |
| 08 | 42.103 | 41.599 | 3.595 | 3.595 |
| 11 | 57.294 | 53.518 | 5.155 | 4.841 |
| 16 | 26.678 | 25.670 | 2.400 | 2.400 |
| 18 | 81.092 | 80.588 | 11.954 | 11.954 |

Ganho acumulado: 8.078 pessoas-minutos (134h38), incluindo 314 aos domingos. As sete filiais melhoraram no total. Nenhum setor piorou no total ou nos domingos, tanto no mês quanto no horizonte técnico; nenhum novo dia-setor vazio foi aceito. Ausências e bloqueios foram conferidos antes de cada salvamento pela API normal com controle de revisão. As três propostas que regrediram durante o desenvolvimento foram rejeitadas e não foram salvas.

O primeiro instrumento de comparação congelava o alvo explicitamente. Após corrigir a paridade, a execução final das três grades afetadas utilizou a saída nativa de `prepareGeneration`, sem sobrescrever `demands`. Nas sete grades, duas preparações sucessivas preservaram as demandas salvas. Não se atribuiu ganho ao Solver por reduzir a estimativa.

A seleção geral permanece em 42 horas. Cinco referências individuais curtas continuam preservadas: quatro de 350 minutos por dia e uma de 240. Não foram ampliadas automaticamente para 8h24. A conferência das 3.528 semanas completas e dos pisos configurados não encontrou erro nos resultados aceitos.

O refinamento observado nas execuções aprovadas levou aproximadamente 0,312–0,965 s; o Python manteve seu orçamento de 12 s. Preparação, transporte e validação acrescentam tempo: não se promete resposta HTTP completa em 12 s. Há fases `UNKNOWN` e objetivos sem execução quando o prazo termina. `FEASIBLE` não significa ótimo global.

## Verificação

- `npm run quality:code`: aprovado na revisão final; 322 arquivos, 2.536 testes aprovados e três testes já ignorados. Não foi executado o E2E isolado, conforme orientação do usuário.
- Regressões Python focadas: prioridade, cobertura por setor, presença diária, reparo, domingos, cancelamento e dica separada da referência. A troca de dois dias continua contando uma pessoa e dois registros alterados contra a grade original.
- Regressões funcionais de preparação, referência estável, horários curtos, interface e exportações reais PDF/XLSX.
- Compose validado com acesso aos arquivos protegidos. Nenhum segredo, dependência ou esquema SQL alterado.
- A liberação exige imagens com a mesma revisão, saúde dos serviços e smoke autenticado no servidor; esses resultados constam no relatório de entrega.

## Dados e recuperação

`coverageBasis` é metadado opcional dentro do JSON da revisão, não autorização, mínimo operacional ou evidência jurídica. Para retroceder a uma versão anterior que rejeite esse campo, ainda usando a aplicação nova, salve os mesmos inputs sem `coverageBasis` pela API normal e com a revisão esperada, antes de trocar as imagens. Não remova horários, demandas, ausências ou histórico. As imagens anteriores são preservadas como recuperação; não se executa migração SQL para esta etapa.

As grades continuam rascunhos. Dados e autorizações não fornecidos não foram inventados. Permanecem desfalques estimados e limitações de setores com uma pessoa, horários não apurados e crédito noturno. Não foi demonstrado atendimento real de sete dias nem ótimo global.

Relatos de outros módulos recebidos durante a coordenação — autenticação, recuperação de senha, fila PDF e processamento XLSX do Unimed — não são apresentados como corrigidos por esta entrega de Escalas. Exigem lotes próprios e validação específica.
