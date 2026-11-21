# Mapa delimitado de preparação para congelamento

`AUX-RELEASE-READINESS-MAP r1` · despacho `AUX-RELEASE-READINESS-MAP:r1:batch285` · gate285/reserva286 · 14/11/2026. Checkout `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

**Estado: preparação parcial documentada; pacote completo ainda não congelado e produção não liberada.** Não foi identificado novo bloqueador demonstrável de implementação no recorte examinado. Permanecem gates concretos de evidência, persistência, ambiente e reconciliação. Isso não certifica toda a fonte nem substitui as revisões em andamento.

## Base e alcance deste mapa

- HEAD local confirmado: `8651e77b108cd3026d50707dea60c03963c9faaf`; branch `codex/escalas-permissoes-isoladas`.
- Central informou main/produção em ec1bf2d e integração/implantação suspensas. O objeto ec1bf2d não foi resolvido no clone por rev-parse; não houve fetch, merge, rebase ou comparação de fonte com esse commit. Seu estado produtivo é informação da coordenação, não observação remota desta tarefa.
- package.json e package-lock.json são idênticos ao HEAD local. Lockfile v3, dependências raiz coerentes, 41 dependências e 19 devDependencies; npm 11.19.0 declarado, engines Node >=24.19.0 <25/npm >=11 <13. Nenhuma alteração de dependência é exigida por esse delta observado. Não foram instaladas ferramentas nem verificado o runtime do host.
- Inventário **somente de nomes** nos diretórios lib/escalas, api/escalas e components/escalas observou 82 arquivos rastreados alterados e 83 não rastreados. São contagens locais transitórias, não autoria, auditoria ou manifest completo. A saída registra os caminhos para a reconciliação posterior.
- Hashes desta entrega abrangem apenas o recorte estável de acesso/bootstrap/configuração e documentos selecionados. E2E ativo não foi lido, listado, compilado ou congelado. Também não foram lidos os arquivos ativos de importação da UI nem reaberto SQL/triggers. Nenhum código de Solver foi reavaliado; o ownership exclusivo de F03 no servidor permanece fora deste mapa.

`web/src/app/escala` não existe neste checkout. Não foi procurado/lido outro entrypoint fora da reserva; a afirmação sobre a página completa depende da montagem/revisão/E2E responsáveis. Não tratar o inventário parcial como hash da candidata final.

## Ativação e administrador: plano versus código

As decisões em `usuarios-permissoes.md:216–225` e `plano-integrado.md:158–190`, no diretório autorizado do canônico, exigem uma candidata de compatibilidade ADMIN_ONLY validada/preservada antes de SCOPED, manutenção de ADMIN e piso de retorno que já conheça a trava. Esses arquivos foram apenas lidos.

| Requisito | Evidência local de implementação | Gate ainda pendente |
| --- | --- | --- |
| Fechar não administradores em ADMIN_ONLY | `permissions.ts:66–83` aceita apenas modos conhecidos, mantém ADMIN ativo e nega os demais em ADMIN_ONLY. `access.ts:23–37` relê política/conta, verifica tenant/status/versão e usa ADMIN_ONLY quando não há registro. Os testes existentes access.test.ts:22 e permissions.test.ts:48 cobrem o recorte com dependências simuladas; não foram reexecutados. | Provar em banco/runtime reais que todos os papéis legados, cookies e rotas respeitam esse modo. Modo LEGACY/desconhecido é negado antes da exceção de ADMIN; conferir política ausente ou em modo suportado antes do rollout, sem supor conteúdo atual do banco. |
| Conta geral tem precedência, sem união de cookies | `access.server.ts:9–25` usa a conta primeiro e só considera sessão operacional depois de 401. `account-access-view.server.ts:12–13` projeta ADMIN integral; é projeção visual, não prova autônoma de autorização atual. | Autenticação inicial de conta vem de requireSession/auth; o provedor web/src/auth.ts está fora desta reserva. Smoke administrativo real e coexistência de cookies continuam necessários. |
| Nome não cria administrador ou acesso automático | `operator-session-issuer.ts:18–50` procura tenant/operador já cadastrado, ativo, com versão/grants e política SCOPED. `operator-session-policy.ts:42–57` recusa vínculo legado, revogação, expiração e versões divergentes. POST /access/session recebe somente username para admissão operacional. | Migração real e testes de emissão/revogação/limites por tenant e filial; entrada por nome não é autenticação forte. Não ativar SCOPED antes dos guards e aprovações validados. |
| Troca de modo administrativa e revogação | Rota `/api/escalas/access/admin` existe; `operator-admin-service.ts:24–37` usa lock, access.manage e CAS de expectedVersion, cria/atualiza a política, incrementa versão e revoga sessões do tenant na mesma transação. Há teste de transporte/serviço em operator-admin-service.test.ts:50–54. | PostgreSQL/locks/rollback e comando de recuperação exercitado sem depender da tela. Produzir runbook por alvo/versão exatos, com verificação posterior. A mudança não seleciona imagem, faz deploy ou prova rollback. |
| Bootstrap preserva conta existente | Leitura adicional de prisma/seed.ts autorizada pela revisão288: linhas 5,152–156 chamam de fato `ensureBootstrapAdmin`; `system/seed-admin.ts:46–69` retorna conta existente por e-mail sem atualizar senha, papel ou tenant e só cria ADMIN se ausente. Chamador e helper são idênticos ao HEAD local. Rotação é ação explícita em scripts/rotate-admin-password.ts, não rotina desta entrega. | Provar com ADMIN existente no ambiente reservado. E-mail ocupado por não-ADMIN não é promovido; exige decisão própria, não elevação implícita. O seed completo também faz upsert de tenant e dados de outros módulos, portanto não deve ser executado como simples verificação de senha/admin contra base compartilhada. |

O caminho autenticado existente para fechar acesso é GET da administração para ler a versão, seguido de POST com action SET_ACCESS_MODE, mode ADMIN_ONLY e expectedVersion correspondente. O serviço revoga as sessões e incrementa a versão. Registrar no runbook futuro a requisição autenticada/origem e as negativas verificadas, sem gravar cookie/segredo. Nenhuma chamada foi feita aqui.

## Piso de rollback/compatibilidade

O mecanismo ADMIN_ONLY existe no código atual; **imagem de compatibilidade preservada e retorno ensaiado não estão demonstrados por este mapa**. As decisões salvas exigem recusar senha compartilhada antiga, cookie legado, login nominal e contas gerais VIEWER/PLANNER/APPROVER, inclusive com cookies coexistentes, mantendo somente ADMIN. Exigem também revisão/digest de imagem e prova em todas as rotas antes da ativação.

Os arquivos/documentos lidos não apresentam evidência suficiente para vincular esse piso a uma imagem disponível/testada do pacote final. Nenhum registry, Docker ou host foi consultado; não se afirma que uma imagem inexista fora desta reserva. A API de modo e os testes unitários são parte do mecanismo, não o artefato de recuperação solicitado.

Não declarar retorno a ec1bf2d seguro: seu código não foi comparado neste clone e não há prova aqui de que ele conheça a trava nova. O plano rejeita explicitamente a volta a versões antigas desprotegidas. A instrução correta continua sendo persistir ADMIN_ONLY, incrementar/revogar e retornar somente ao piso validado, preservando schema/histórico. Não usar restauração ampla de banco para desfazer UI. As duas candidatas deliberadas — compatibilidade e final — mantêm seus gates/imagens próprios; reaproveitar uma mesma imagem como ambas exigiria decisão explícita posterior, não inferência deste mapa.

## Configurações: somente nomes e dependências observadas

Não há nova variável de ambiente para alternar ADMIN_ONLY/SCOPED nos caminhos examinados; o controle é persistido por tenant. Nenhum valor de configuração produtiva foi inspecionado, e não se concluiu ausência de variável no host.

| Nome ou requisito | Papel no delta/caminho examinado |
| --- | --- |
| UNIMED_ACCESS_COOKIE_SECRET | Nome já usado no HEAD; permanece na assinatura do cookie e passa a sustentar também as provas assinadas de proposta em proposal-proof.ts:8–11. Exige configuração segura com pelo menos 32 caracteres nesses caminhos. Não é uma dependência npm nova nem prova de que o segredo falte em produção. |
| DEFAULT_TENANT_SLUG | Nome preexistente usado para resolver o tenant da entrada operacional. Conferir que corresponde ao tenant pretendido antes de cadastrar/ativar operadores; o código tem fallback interno, não uma autorização de empresa escolhida pelo cliente. |
| UNIMED_ACCESS_SESSION_TTL_MINUTES | Nome preexistente: intervalo aceito de 15–1440 minutos; fora dele o código usa 480. A ativação precisa conferir expiração/revogação, sem alterar valores por conveniência. |
| NODE_ENV, AUTH_SECRET, APP_URL/AUTH_URL | Pré-requisitos existentes do runtime/autenticação/origem/HTTPS. Não foram examinados seus valores nem o provedor completo de autenticação. |
| ADMIN_EMAIL, ADMIN_PASSWORD, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, DEFAULT_TENANT_NAME; ROTATE_ADMIN_PASSWORD/ADMIN_ENV_FILE | Nomes existentes conferidos no chamador de bootstrap e na rotação. Não rotacionar para validar ou implantar este pacote; preservar ADMIN existente. Não foram lidos os valores. |
| DATABASE_URL, SOURCE_REVISION, E2E_* e worker/imagens | Dependências do gate de ambiente já descritas em escalas-final-validation-environment.md. Só a coordenação pode reservar destino/configuração e reconciliar imagens. Não usar flags de teste para insinuar permissão de criação de banco ou acesso a produção. |

No comparativo de module-session.ts com HEAD, não houve adição de nome de variável. proposal-proof.ts é novo, mas reutiliza o nome de segredo existente. Isso não constitui inventário global de configurações do produto.

`package.json:30–39` encadeia prebuild/setup:env e postbuild; `scripts/ensure-env.mjs:194–202` pode gerar backup, reescrever .env e ajustar permissões. Há também geração de cliente, assets/workers e limpeza de WASM opcional. Esses efeitos precisam ser previstos em checkout exclusivo/configuração de teste, preservando segredos e escritores. Nenhum desses scripts foi executado. quality:code continua parcial; quality inclui PG/E2E isolados; build não substitui testes posteriores.

## Gates restantes e pacote a entregar ao Central

| Requisito | Evidência local reaproveitada | Pendência para publicação |
| --- | --- | --- |
| Fonte de backend/importação | Correções e provas locais já entregues nesta conversa, incluindo bloqueio de paginação e encontro cliente→rota. A correção de fronteira da UI está com outro escritor. | Finalização/revisão dos reparos, regressões reais com as respostas completas e vinculação aos hashes finais. Este mapa não relê essa UI nem presume conclusão. |
| Foco dos turnos | Parecer focal anterior desta conversa aprovou SWUI01 no seu corte sintético, com 20 verificações e capturas. Não foi repetido nem certificado como identidade do corte atual. | Reconciliar os hashes finais após alterações de textos; smoke na montagem autenticada. |
| Pacote de persistência | escalas-access-migration-package.md registra composição e equivalência offline de 24 instruções, históricos preservados e comentários sem alteração estrutural. No complemento da revisão288, a coordenação informou aprovação independente do pacote local, em escalas-access-migration-review.md; esse parecer não foi reaberto nesta reserva. | Instalação limpa, upgrade com dados legados, FKs/checks/imutabilidade, locks/CAS/revogação, recuperação por restauração real e desempenho Linux. Aprovação local não é execução no PostgreSQL. Não reauditei SQL/triggers. |
| Ambiente | escalas-final-validation-environment.md descreve requisitos/efeitos do runner. Banco existente permanece indisponível segundo a coordenação; usuário escolheu aguardar. | Reserva verificável de ambiente não produtivo. Criar descartável, container ou serviço continua sem autorização. |
| Quality/build/E2E | Evidências focais anteriores comprovam seus recortes, não o gate integrado. package/lock não acrescentam dependências. | Encerrar E2E em edição; quality completo e build por candidata, smoke autenticado posterior, sem declarar skips como cobertura. Nenhum check foi repetido nesta tarefa. |
| Piso de retorno | Código de fechamento/modo/revogação existe; requisito salvo é explícito. | Imagem/digest/runbook de compatibilidade e ensaio real ADMIN_ONLY/admin/cookies/papéis antes de SCOPED. |
| Reconciliação | Base local e metadados confirmados; Central informou ec1bf2d e hold. | Após escritores/revisores terminarem: manifest integral, diff rastreado **e arquivos novos**, base e referências exatas, verificação/lacunas. Central avalia conflitos e preserva canônico/F03; só então solicitar commit/push/deploy, conforme autorização condicionada à validação. |

Não há congelamento ou pedido de publicação nesta entrega. O futuro pacote deve separar fontes finais, evidências de seus cortes, configurações apenas por nome e limitações reais, incluindo smoke do administrador e rollback ainda não comprovados. Não sobrescrever canônico nem transportar .env, credenciais, dados reais ou estado de produção.

## Evidência e liberação

`outputs/escalas-release-readiness/readiness.json` registra HEAD/branch, comparação package/lock, inventário de caminhos e hashes **parciais**; manifest.json identifica este documento e artefatos. Os E2E ativos e arquivos da UI em reparo ficam explicitamente fora do hash de fontes. O objeto Central não resolvido também não é tratado como ancestral ou alvo de diff verificado.

Context Mode efetivo: ctx_execute para comparação de metadados/nomes de configuração e inventário delimitado, ctx_batch_execute para decisões salvas e caminhos de modo/bootstrap. Sem fallback ou escrita por Context Mode; escrita nativa só neste documento/saída autorizada. Nenhum setup/test/build/Prisma, banco, Docker, instalação, serviço, acesso remoto, commit/push/deploy ou contato lateral/subagente. Nenhum descartável foi criado; nada exige Complete. Recursos de leitura da reserva286 liberados ao concluir, preservando os demais escritores e gates ativos.
