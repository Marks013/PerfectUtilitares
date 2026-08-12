# ADR-004: Módulo privado de presença

## Status

Aceito.

## Contexto

PerfectUtilitares precisa oferecer confirmação de presença e lista compartilhada
de presentes sem expor o módulo na navegação principal. Convidados não devem criar
conta. Links precisam ser identificáveis, revogáveis e seguros. Aplicação opera em
uma instância Docker com Next.js, PostgreSQL e Prisma.

## Decisão

- Manter módulo no monólito modular existente.
- Usar slugs legíveis na rota e segredo de 256 bits no fragmento da URL.
- Trocar segredo por sessão opaca em cookie `HttpOnly`, `Secure` e `SameSite=Lax`.
- Armazenar somente hashes HMAC de convites e sessões.
- Exigir sessão Auth.js com papel `ADMIN` para gestão.
- Usar PostgreSQL como fonte única de verdade para RSVP, presentes e auditoria.
- Atualizar clientes por polling condicional com `ETag`; pausar em aba oculta.
- Reservar presente por atualização condicional e idempotente.
- Aplicar retenção configurável e sanitização de dados no Sentry.

## Alternativas rejeitadas

- Segurança por rota escondida: endereço pode ser descoberto.
- Token como query string ou segmento: pode aparecer em logs e monitoramento.
- WebSocket, Redis ou Pusher: custo operacional sem escala comprovada.
- Microserviço separado: aumenta deploy, observabilidade e consistência distribuída.
- Nome como credencial: previsível e impossível de revogar com segurança.

## Consequências

Positivas:

- Reutiliza segurança, banco, Docker e observabilidade atuais.
- Links permanecem bonitos sem transformar nomes em credenciais.
- Concorrência de presentes fica protegida pelo banco.
- Infraestrutura continua simples e sem licença paga.

Negativas:

- Polling não entrega atualização instantânea entre todos os navegadores.
- Sessões de convidados criam dados temporários que exigem limpeza.
- Auth.js beta continua sendo dependência do painel administrativo existente.

Mitigações:

- Intervalo de 15 segundos, `ETag` e pausa quando documento estiver oculto.
- Índices por expiração e rotina de retenção idempotente.
- Encapsular autorização administrativa nos guards existentes.

## Gatilhos para revisão

- Mais de uma instância da aplicação.
- Eventos com milhares de convidados simultâneos.
- Polling ultrapassar limites definidos de banco ou rede.
- Migração estável do Auth.js exigir alteração no contrato de sessão.
