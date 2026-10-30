# Escalas — correções da auditoria de 30/10/2026

Estado: concluído. Correções implantadas e validações comparativas aprovadas; resultados e limites registrados abaixo.

## Escopo entregue

Manutenção realizada diretamente em `/home/ubuntu/PerfectUtilitares`, preservando dados, credenciais, regras explícitas e alterações anteriores. Sem novas dependências.

| Achado | Correção |
| --- | --- |
| Afastamentos de pessoas excluídas podiam desaparecer ou ser rejeitados | Preparação, Solver, cliente e validador preservam ABSENCE e registros bloqueados legítimos para qualquer cargo excluído. Eles não contam como cobertura. Novas atribuições desbloqueadas continuam rejeitadas. |
| Identidades equivalentes de filial podiam divergir | Normalização compartilhada, validação no banco e resposta 409 para duplicatas, inclusive concorrentes. `8`, `08` e `0008` representam a mesma filial; códigos alfanuméricos não são fundidos. |
| Conferência de publicação permanecia válida após mudança | Confirmação vinculada ao planejamento, revisão e entrada conferida; edição ou revisão nova exige nova confirmação. |
| Painéis ocultos continuavam recalculando | Trabalho derivado limitado à área ativa, mantendo estado e conteúdo das outras áreas. |
| Linhas extensas transbordavam PDF/XLSX | Continuação de conteúdo entre páginas/linhas, cabeçalhos repetidos e altura de linha limitada, sem truncar descrições. |
| Exportações podiam consumir recursos repetidamente | Autorização e revisão conferidas antes de cada acesso; limitação persistente de frequência, capacidade disponível, duas gerações simultâneas e cache limitado a 16 MiB/16 entradas/120 segundos. Solicitações idênticas compartilham a geração. |
| Objetivos constantes consumiam buscas e setores grandes perdiam refinamento | Limites inferiores calculados pelos domínios, inclusive coeficientes negativos; vizinhanças grandes tratadas integralmente sem ampliar o orçamento existente. |
| Melhora geral escondia piora localizada | Baseline exato por setor, combinado com sugestões apenas nos setores incompletos e validado por CP-SAT. Guards de cobertura total e dominical protegem tanto o horizonte quanto o mês visível recebido; ganhos nas bordas não podem financiar perdas nesse mês. Sem mês informado, não se inventa escopo. Baseline inválido não vira restrição obrigatória. |
| Preparação removia WORK apesar de manter a jornada curta original | Comparação semântica de horários, carga e minutos diários. Se nada mudou, registros e identificadores originais permanecem; mudanças reais continuam sendo tratadas. Referências curtas não são ampliadas automaticamente. |

A preferência de blocos de até 4h30 permanece desligada por padrão, conforme decisão anterior. Ausências, bloqueios, jornada escolhida e limites explícitos não foram flexibilizados silenciosamente.

## Evidências de validação

- Etapa inicial: 301 testes Vitest em 18 arquivos afetados.
- Complementos: 84 regressões de validação/preparação/cliente e 54 de geração/preparação, com sobreposição entre conjuntos; não são uma soma de testes únicos.
- Solver: 32 regressões CP-SAT e três cenários de warm start no runtime existente, sem novo ambiente isolado. Contraprova determinística comprova a necessidade e a eficácia do guard mensal, reutilizando as variáveis existentes, sem solve adicional.
- TypeScript, Biome dos arquivos de aplicação alterados, `git diff --check` e gate estrutural aprovados. O gate verificou 386 módulos, sem exceções legadas.
- Gate de rotas: 73/73 com arquivo dedicado e caminho funcional 2xx. Esse indicador não significa cobertura integral de todos os fluxos.
- Revisão independente dos patches, sem novos bloqueadores confirmados.
- E2E autenticado em produção, versão final da aplicação: um cenário completo aprovado em 29,5 segundos. Criação, duplicata canônica 409, navegação com estado preservado, invalidação da conferência após edição, salvamento, geração, aplicação, afastamento de pessoa excluída e bloqueio preservados. O ajuste posterior exclusivamente Python foi validado pelas regressões e pela rodada prática abaixo, sem repetir a suíte de interface.
- PDF baixado e aberto como documento válido; XLSX baixado e descompactado com a aba de horários. Ausência de transbordamento da página em larguras de 375, 768 e 1280 pixels.
- Rascunhos técnicos exclusivos do teste removidos ao final; nenhum planejamento existente foi publicado ou sobrescrito.

O teste antigo que exigia folgas futuras em todos os dias da semana misturava essa expectativa com três sábados e domingos anteriores de folga. Foram separados os cenários de importação sem histórico e histórico conhecido. O primeiro mantém a exigência de dispersão em todos os dias; o segundo mantém 5×2, rodízio dominical, dispersão útil e imutabilidade. A heurística não foi alterada para satisfazer o teste.

Por orientação do usuário, a validação foi focada nos componentes afetados e no fluxo real. Não foi executada a suíte global `npm run quality`, que inclui ambiente E2E isolado, nem acompanhamento do CI ou uma auditoria de navegação pública.

## Verificação prática final: 07, 08 e 11

Uma geração por planejamento na versão final do Solver, com PostgreSQL protegido em modo somente leitura. Comparação independente com a grade salva, usando exatamente as mesmas demandas. Valores em pessoas-minuto de desfalque estimado; não representam quantidade de pessoas faltantes nem demanda operacional comprovada.

| Planejamento | Total no período visível, antes → depois | Domingos visíveis, antes → depois | Redução dominical |
| --- | ---: | ---: | ---: |
| 07 | 113.572 → 101.356 | 26.326 → 15.244 | 42,1% |
| 08 | 60.071 → 49.498 | 12.635 → 8.167 | 35,4% |
| 11 | 55.883 → 50.377 | 6.876 → 4.722 | 31,3% |

| Planejamento | Total no horizonte completo, antes → depois | Domingos no horizonte, antes → depois |
| --- | ---: | ---: |
| 07 | 165.378 → 142.080 | 35.404 → 19.356 |
| 08 | 86.072 → 70.292 | 14.951 → 9.679 |
| 11 | 78.238 → 70.396 | 7.740 → 5.143 |

Nos 31 grupos setoriais avaliados, nenhuma piora em total ou domingos, tanto no período visível quanto no horizonte. Os valores iniciais de COVERAGE coincidiram exatamente com os baselines independentes: 165.378 / 86.072 / 78.238.

Todos retornaram FEASIBLE e validação independente válida, com zero ERROR, dias faltantes ou duplicados, 5×2 respeitado e máximo de cinco dias consecutivos. As 120 ausências do planejamento 11 permaneceram intactas. Não havia bloqueios nas três grades reais; a preservação de bloqueio foi exercitada no E2E técnico, não nesses planejamentos.

Revisões 17 / 21 / 5 e hashes persistidos inalterados. Nenhuma proposta gerada nesta verificação foi salva. Os planejamentos continuam rascunhos, com publicação pendente de revisão operacional; esta validação não os publica nem certifica conformidade. Resultados são de execuções práticas pontuais, não um benchmark estatístico.


## Migração e integridade

Migração aplicada: `20261030190000_canonical_escala_branch_identity`. Executada sem seed, sem redefinir contas ou senhas e sem alterar payloads históricos. Verificação prévia de colisões e transação com limites de espera; nenhum conflito foi encontrado.

Conferência após implantação e limpeza dos rascunhos técnicos:

- Quatro planejamentos existentes, zero permissões adicionais e 44 revisões preservados.
- Assinatura dos payloads das revisões antes/depois: `2afd220f8bbabfbc1311b257b6db05e7`.
- Constraints canônicas de `EscalaWorkspace` e `EscalaBranchAccess` presentes.
- Banco e worker de PDF não foram recriados; nenhuma alteração de credenciais de implantação.

## Identificação da implantação

Aplicação implantada: `8fe2db29ff9071b8dfdb163c17488766fb7fa18d`. Correção final exclusivamente do Solver: `d0a4bb828ad3be9153ea3bcea7d00e30d6f288cc`, incluindo as correções anteriores `1aefeba` e `181bd5d`. As fontes da aplicação foram conferidas como idênticas às do seu build; não houve rebuild desnecessário por documentação ou pelo último ajuste Python.

- Aplicação: `sha256:6d3788b58736091a28c580e36c80ca8478dbca074fe2d529930207e34f24de64`.
- Solver: `sha256:5e17df57987515dc8ce600dc4e0150003422cb9924dfa25e27cf48ab4a3a29f3`.
- Fingerprint final das fontes de implantação: `e60b71887dfdc0d8d82fd051d3f444c9ced27c19fd5309a778114713b4dc103c`.
- Compose validado com acesso aos arquivos protegidos; aplicação, Solver, banco e worker de PDF saudáveis. Os nove arquivos Python implantados correspondem às fontes do servidor.

Evidências e manifesto mantidos no diretório protegido `/home/ubuntu/perfectutilitares-reports/escalas-remediation-2026-10-30T18-35-24-113Z`.

Recuperação anterior ao guard mensal: imagem `web-escalas-solver:rollback-audit-123ef0806934`, mantendo a aplicação 8fe2db2. O par anterior ao build consolidado também foi preservado: `web-app:rollback-audit-7ca752e3c627` e `web-escalas-solver:rollback-audit-7336f36f7d2b`. Não restaurar cliente antigo com Solver novo sem verificar compatibilidade dos registros de pessoas excluídas.

A migração não remove dados; uma recuperação deve preservar os códigos normalizados e as revisões. Não apagar constraints, reescrever identidades ou restaurar dados automaticamente. Documentação e resultados adicionados depois desta implantação não exigem rebuild se as fontes de runtime permanecerem idênticas.

## Limites da conclusão

Cobertura sem demanda operacional informada continua sendo estimativa, não garantia de efetivo. Resultado FEASIBLE é uma proposta válida encontrada no orçamento, não prova de ótimo global. Algumas fases secundárias não couberam no orçamento das execuções; não se promete otimização de todos os objetivos em toda execução. A proteção comparativa exige baseline representável e validado nas regras atuais; uma grade incompatível não impede a busca de uma solução corrigida.
