# Mapa funcional e técnico do PerfectUtilitares

**Escopo:** guia de localização para manutenção. Não representa teste de produção nem altera contratos.

| Área | Interface / rotas | Implementação principal | Proteções a preservar |
| --- | --- | --- | --- |
| Autenticação/administração | `web/src/app/(app)/admin/usuarios`, `web/src/app/api/admin` | `web/src/lib/users`, `web/src/lib/auth`, Prisma | Escopo empresa, convites, bloqueio, trilha |
| Jornada | `web/src/app/(app)/jornada`, `web/src/app/api/jornada` | `web/src/lib/jornada` | Regras por vigência e histórico |
| Escalas | `web/src/app/(app)/escala`, `web/src/app/api/escalas` | `web/src/components/escalas`, `web/src/lib/escalas`, `web/ops/escalas` | Semana domingo–sábado, folgas explícitas, afastamentos, jornada, publicação por revisão |
| Férias | `web/src/app/(app)/admin/ferias` | `web/src/lib/ferias` e worker | Paridade de arquivos, não reinterpretar documentos |
| Unimed | `web/src/app/(app)/unimed`, `web/src/app/api/unimed` | `web/src/lib/unimed` e worker | Segregação, documentos, idempotência |
| Reajuste salarial | `web/src/app/(app)/reajuste-salarial` | `web/src/lib/reajuste-salarial` | Regras de cálculo e autenticação |
| PDF | `web/src/app/(app)/pdf`, `web/src/app/api/pdf` | `web/src/lib/pdf`, `web/src/workers/pdf-worker.ts` | Uploads, execução isolada, recuperação de jobs |
| Fotos | `web/src/app/(app)/fotos` | `web/src/lib/fotos`, `web/public/mediapipe` | Processamento local, compatibilidade dos assets |
| Presença e presentes | `web/src/app/(app)/admin/presencas` e rotas públicas | `web/src/lib/presencas` | Link/convite, reserva concorrente, privacidade |

## Fluxo crítico de Escalas

Entrada e cadastro → validação de contrato → preparação de horários e folgas → otimizador Python CP-SAT → verificador TypeScript independente → aplicação com revisão esperada → conferência de cobertura → publicação por perfil autorizado.

O servidor **não deve confiar** no status de viabilidade devolvido pelo otimizador sem recalcular as regras. Uma referência `HOURS_ONLY` não se transforma em presenças diárias.

O modo operacional compartilhado e os perfis `VIEWER`, `PLANNER`, `APPROVER` possuem semânticas diferentes. O backend de permissões individuais existe, mas não há cadastro administrativo completo confirmado.

## Dados e implantação

- Modelo de dados: `web/prisma/schema.prisma`; migrações versionadas em `web/prisma/migrations`.
- Serviços/container: `web/docker-compose.yml`, `web/Dockerfile`, `web/ops/escalas/Dockerfile`.
- Qualidade/CI: `web/package.json`, `web/vitest.config.ts`, `.github/workflows/ci.yml` e `AGENTS.md`.
- Backups: scripts `web/ops/perfectutilitares-backup*` e runbook operacional.

Relatórios em `docs/reviews` e `docs/AUDITORIA-*` são **fotografias históricas**. Consulte a `main` atual e os checks do commit para ações operacionais; documentação não é prova de runtime.
