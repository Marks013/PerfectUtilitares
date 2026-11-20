# M1 | Baseline, ferramenta e proteção de integração

Data: 20/11/2026. Baseline: 2657f4a6894d01df58db9e3353f3ff7421047fc1.
Plano-fonte: PLANO_CORRECOES_PERFECTUTILITARES_2026-11-20.md, marcos M0/M1.

## O que este PR resolve

- **A12:** identifica Node/npm incompatíveis antes da instalação npm no pacote web, sem instalar ou trocar software no host. A versão recomendada de Node está em web/.nvmrc.
- **A09a:** substitui a variável obsoleta BACKUP_KEEP_COUNT do exemplo pelas variáveis realmente lidas pelo backup: BACKUP_DAILY_KEEP_DAYS=7 e BACKUP_MAX_AGE_DAYS=30. O script de produção e o arquivo local de configuração não foram alterados.
- **M0:** registra o estado conhecido e as decisões que faltam. Não afirma execução no servidor.

## A01 | Proteção da main depende de administrador

Consulta da API GitHub em 20/11/2026: main.protected=true, mas required_status_checks.enforcement_level=off e contexts=[]; o endpoint de rulesets retornou lista vazia.
Esta conexão GitHub não permite alterar as regras de proteção do repositório. Configuração no GitHub Settings > Rules > Rulesets é uma atividade administrativa separada, não concluída por este PR.

Antes de marcar A01 concluído, configurar regras efetivas para main, exigir revisão por PR atualizado e estes checks existentes no CI:

1. Code, dependencies and PostgreSQL
2. Solver and independent verifier
3. Docker images
4. Production build and browser flows

A verificação Planning calendar parity é condicional à lista de caminhos. Não torná-la um check obrigatório universal sem primeiro ampliar seu gatilho, senão PRs não relacionados podem ficar permanentemente pendentes.
Demonstrar com PR sintético: pending/failure impedem merge e success permite merge autorizado; restringir bypass e force-push. Testar com responsável antes de alterar uma branch em uso.

## A12 | Como desenvolver

Na raiz web/:

    nvm use
    npm run check:toolchain
    npm ci

O preinstall do pacote web verifica Node >=24.19.0 <25 e npm >=11 <13. Erros explicam a incompatibilidade; nunca instalam Node/npm.
O script de preflight não depende de node_modules; o teste integrado à test:ops verifica versões e a recusa de ambientes antigos.

## A09a | Retenção e restauração

O programa de backup mantém todos os snapshots durante 7 dias e o último de cada semana ISO até 30 dias, pelos valores padrão atuais. BACKUP_RCLONE_REMOTE permanece opcional. Nenhum backup foi removido ou enviado.
Os testes de contrato comparam cada variável do exemplo à inicialização no script; não executam backup nem contêm segredos.
No servidor autorizado, verificar timers ativos, logs recentes, integridade dos arquivos, rclone remoto e restauração em banco isolado. Não usar um banco de produção para testes.

## Estado pendente, sem alegar conclusão

- A01: regras obrigatórias dependem de acesso administrativo e demonstração de merge bloqueado.
- A08a: benchmarks sintéticos em Docker/hardware reproduzível, com métricas p50/p95, memória e faltas reais mensuradas.
- A09b: off-site, RPO/RTO e prova recente de restauração dependem de aprovação/observação operacional.
- A02: concessões por filial não serão implementadas sem autorização explícita, conforme decisão anterior.
- A03/A04/A05: alterações de contrato, segredo, cobertura e calendário exigem etapas separadas; não estão neste PR.

## Liberação

Confirmar CI completa e conteúdo do commit antes do merge. Deploy requer procedimento local de AGENTS.md: quality integral, recibo válido e checkout limpo. A CI não certifica a versão do servidor.
