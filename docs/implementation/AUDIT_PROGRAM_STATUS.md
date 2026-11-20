# Programa de correções A01–A12: rastreabilidade

**Plano-fonte:** `PLANO_CORRECOES_PERFECTUTILITARES_2026-11-20.md`, fornecido pelo responsável. **Baseline inicial:** `2657f4a6894d01df58db9e3353f3ff7421047fc1`.

| Achado | Estado verificável neste programa | Evidência necessária para encerrar |
| --- | --- | --- |
| A01 Checks obrigatórios na main | **Parcial:** verificação de diff destrutivo proposta na CI; Ruleset permanece bloqueado por permissão administrativa | Ruleset ativo, checks obrigatórios e prova de PR vermelho/pending recusado |
| A02 Gestão de acessos por filial | **Não autorizado anteriormente** | Nova decisão explícita; caso autorizado, API/UI e isolamento testados |
| A03 Credencial operacional Escalas | **Decisão pendente** | Modelo de identidade e migração aprovados; testes de sessão/revogação |
| A04 Setores vazios e confirmação | **Parcial: telas e avisos existentes; confirmação server-side pendente** | Snapshot + confirmação revision/digest e testes de concorrência |
| A05 Calendário tenant/filial | **Decisão/dados pendentes** | Identidade Icaraíma comprovada, backfill e regressões multi-tenant |
| A06 Modularização | **Gradual:** extração de `validateCoverage` (#48) integrada, sem alterar o contrato | Continuar módulos com testes de equivalência e diffs revisados |
| A07 Testes UI críticos | **Parcial:** testes de publicação (#47) presentes, CI/E2E existentes | Cobertura por componente crítico, teclado, mobile, acessibilidade e erros |
| A08 Benchmarks solver | **Parcial:** benchmark sintético independente (#49) integrado com baseline de regras compatíveis | Repetir cenários comparáveis, registrar p50/p95, RAM e cobertura; não presumir ganho de velocidade |
| A09 Backup/off-site | **Exemplo ajustado em M1; runtime não verificado** | Restauração isolada recente, timers e remoto aprovados |
| A10 Docs/índice/runbooks | **#42 integrado na main** | Manter links e procedimentos coerentes com a main após cada entrega |
| A11 Assets MediaPipe | **Inventário estático; medição browser pendente** | Waterfall, cache e compatibilidade com fallback |
| A12 Node/npm | **Preflight #41 integrado, CI do conjunto aprovada** | Conferir runtime real do host no release; não pressupor versão instalada |

## Consolidação e evidência de referência (20/11/2026)

- Recuperação do PR #50 integrada em `d00c3f3`; preservou os testes do PR #47 e restaurou proteções de M1/M3/M5.
- PRs #48 e #49 integrados em `ece0578` e `a4fc82d`; CI e benchmark sintético aprovados.
- A `main` consolidada em `762b2a38e075d4206f862e1a66163709ced7bbca` passou a CI `44802410612`, sem PR aberto e com as 17 branches auxiliares removidas.
- Uma checagem automática de escopo/deleções para PRs está proposta na próxima entrega; **não é substituta** de Ruleset ativo e de revisão humana dos diffs.
- Pendências operacionais e decisões A01–A05/A09/A11 permanecem conforme `docs/decisions/ESCALAS_DECISIONS.md` e issue #46.

**Não confundir:** documentação/preparação não é implantação nem certificação de produção. Nenhuma decisão condicionada se torna autorização implícita. Atualize esta tabela após cada merge, preservando IDs e provas.
