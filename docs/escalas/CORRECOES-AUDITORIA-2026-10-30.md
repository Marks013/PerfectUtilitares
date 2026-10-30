# Escalas — correções da auditoria de 30/10/2026

Estado: evidências do build consolidado registradas; encerramento condicionado à validação da proteção adicional do mês visível. O resultado final será registrado abaixo antes da publicação desta etapa.

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
| Melhora geral escondia piora localizada | Baseline exato por setor, combinado com sugestões apenas nos setores incompletos. CP-SAT valida a composição antes de usá-la como referência dos guards de cobertura total e dominical. Baseline inválido não vira restrição obrigatória. |
| Preparação removia WORK apesar de manter a jornada curta original | Comparação semântica de horários, carga e minutos diários. Se nada mudou, registros e identificadores originais permanecem; mudanças reais continuam sendo tratadas. Referências curtas não são ampliadas automaticamente. |

A preferência de blocos de até 4h30 permanece desligada por padrão, conforme decisão anterior. Ausências, bloqueios, jornada escolhida e limites explícitos não foram flexibilizados silenciosamente.

## Evidências de validação

- Etapa inicial: 301 testes Vitest em 18 arquivos afetados.
- Complementos: 84 regressões de validação/preparação/cliente e 54 de geração/preparação, com sobreposição entre conjuntos; não são uma soma de testes únicos.
- Solver: 30 regressões CP-SAT e três cenários de warm start no runtime existente, sem novo ambiente isolado.
- TypeScript, Biome dos arquivos de aplicação alterados, `git diff --check` e gate estrutural aprovados. O gate verificou 386 módulos, sem exceções legadas.
- Gate de rotas: 73/73 com arquivo dedicado e caminho funcional 2xx. Esse indicador não significa cobertura integral de todos os fluxos.
- Revisão independente dos patches, sem novos bloqueadores confirmados.
- E2E autenticado em produção, versão final: um cenário completo aprovado em 29,5 segundos. Criação, duplicata canônica 409, navegação com estado preservado, invalidação da conferência após edição, salvamento, geração, aplicação, afastamento de pessoa excluída e bloqueio preservados.
- PDF baixado e aberto como documento válido; XLSX baixado e descompactado com a aba de horários. Ausência de transbordamento da página em larguras de 375, 768 e 1280 pixels.
- Rascunhos técnicos exclusivos do teste removidos ao final; nenhum planejamento existente foi publicado ou sobrescrito.

O teste antigo que exigia folgas futuras em todos os dias da semana misturava essa expectativa com três sábados e domingos anteriores de folga. Foram separados os cenários de importação sem histórico e histórico conhecido. O primeiro mantém a exigência de dispersão em todos os dias; o segundo mantém 5×2, rodízio dominical, dispersão útil e imutabilidade. A heurística não foi alterada para satisfazer o teste.

Por orientação do usuário, a validação foi focada nos componentes afetados e no fluxo real. Não foi executada a suíte global `npm run quality`, que inclui ambiente E2E isolado, nem acompanhamento do CI ou uma auditoria de navegação pública.

## Migração e integridade

Migração aplicada: `20261030190000_canonical_escala_branch_identity`. Executada sem seed, sem redefinir contas ou senhas e sem alterar payloads históricos. Verificação prévia de colisões e transação com limites de espera; nenhum conflito foi encontrado.

Conferência após implantação e limpeza dos rascunhos técnicos:

- Quatro planejamentos existentes, zero permissões adicionais e 44 revisões preservados.
- Assinatura dos payloads das revisões antes/depois: `2afd220f8bbabfbc1311b257b6db05e7`.
- Constraints canônicas de `EscalaWorkspace` e `EscalaBranchAccess` presentes.
- Banco e worker de PDF não foram recriados; nenhuma alteração de credenciais de implantação.

## Identificação da implantação

Código implantado: `8fe2db29ff9071b8dfdb163c17488766fb7fa18d`, incluindo as correções anteriores `1aefeba` e `181bd5d`.

- Aplicação: `sha256:6d3788b58736091a28c580e36c80ca8478dbca074fe2d529930207e34f24de64`.
- Solver: `sha256:123ef0806934fa8b74b2c8d07dd9de68fb32b224104419b473c80ff58433fc16`.
- Fingerprint das fontes de runtime: `bb5a2bb67628aa2ad7233c9c73e35c82584b673187ed265c88635b82fb81093e`.
- Compose validado com acesso aos arquivos protegidos; aplicação, Solver, banco e worker de PDF saudáveis. Os nove arquivos Python implantados correspondem às fontes do servidor.

Evidências e manifesto mantidos no diretório protegido `/home/ubuntu/perfectutilitares-reports/escalas-remediation-2026-10-30T18-35-24-113Z`.

Recuperação imediata anterior à versão final: imagens `web-app:rollback-audit-7ca752e3c627` e `web-escalas-solver:rollback-audit-7336f36f7d2b`. Imagens anteriores também foram preservadas. Não restaurar cliente antigo com Solver novo sem verificar compatibilidade dos registros de pessoas excluídas.

A migração não remove dados; uma recuperação deve preservar os códigos normalizados e as revisões. Não apagar constraints, reescrever identidades ou restaurar dados automaticamente. Documentação e resultados adicionados depois desta implantação não exigem rebuild se as fontes de runtime permanecerem idênticas.

## Limites da conclusão

Cobertura sem demanda operacional informada continua sendo estimativa, não garantia de efetivo. Resultado FEASIBLE é uma proposta válida encontrada no orçamento, não prova de ótimo global. A proteção comparativa exige baseline representável e validado nas regras atuais; uma grade incompatível não impede a busca de uma solução corrigida.
