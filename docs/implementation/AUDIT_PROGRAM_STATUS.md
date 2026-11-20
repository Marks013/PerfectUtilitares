# Programa de correções A01–A12: rastreabilidade

**Plano-fonte:** `PLANO_CORRECOES_PERFECTUTILITARES_2026-11-20.md`, fornecido pelo responsável. **Baseline inicial:** `2657f4a6894d01df58db9e3353f3ff7421047fc1`.

| Achado | Estado verificável neste programa | Evidência necessária para encerrar |
| --- | --- | --- |
| A01 Checks obrigatórios na main | **Bloqueado: admin GitHub** | Ruleset ativo e prova de PR vermelho/pending recusado |
| A02 Gestão de acessos por filial | **Não autorizado anteriormente** | Nova decisão explícita; caso autorizado, API/UI e isolamento testados |
| A03 Credencial operacional Escalas | **Decisão pendente** | Modelo de identidade e migração aprovados; testes de sessão/revogação |
| A04 Setores vazios e confirmação | **Parcial: telas e avisos existentes; confirmação server-side pendente** | Snapshot + confirmação revision/digest e testes de concorrência |
| A05 Calendário tenant/filial | **Decisão/dados pendentes** | Identidade Icaraíma comprovada, backfill e regressões multi-tenant |
| A06 Modularização | **Gradual, não concluída** | PRs por função pura e comparação de contratos |
| A07 Testes UI críticos | **CI/E2E existente; reforço por fluxo pendente** | Cobertura real medida, testes por acessibilidade e erros |
| A08 Benchmarks solver | **Infraestrutura existente; baseline medido pendente** | p50/p95, RAM, cobertura por cenário no mesmo hardware |
| A09 Backup/off-site | **Exemplo ajustado em M1; runtime não verificado** | Restauração isolada recente, timers e remoto aprovados |
| A10 Docs/índice/runbooks | **Esta entrega** | Links e procedimentos conferidos contra main |
| A11 Assets MediaPipe | **Inventário estático; medição browser pendente** | Waterfall, cache e compatibilidade com fallback |
| A12 Node/npm | **PR M1, sujeito à CI e integração** | Preflight e build Docker no mesmo commit |

**Não confundir:** documentação/preparação não é implantação nem certificação de produção. Nenhuma decisão condicionada se torna autorização implícita. Atualize esta tabela após cada merge, preservando IDs e provas.
