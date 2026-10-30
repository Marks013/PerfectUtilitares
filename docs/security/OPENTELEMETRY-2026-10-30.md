# Eliminação da dependência OpenTelemetry obsoleta

Data: 30/10/2026. Execução diretamente no servidor. Estado: gate completo aprovado; construção e implantação em andamento.

## Diagnóstico

Sentry 10.78.0 exigia `@opentelemetry/sdk-trace-base@2.12.0`, marcado no registro npm como obsoleto. O pacote foi substituído no projeto upstream. A resolução correta não é omitir avisos, remover monitoramento ou substituir um peer interno por um alias incompatível.

Sentry 11.10.0 estável remove essa dependência. Os engines publicados aceitam o Node 24 utilizado; o SDK Next aceita Next 16. A migração altera configurações de privacidade e profiling, que precisam ser tratadas junto com os lockfiles.

## Plano e critérios

1. Reproduzir o aviso por um teste que falhe nos lockfiles antigos.
2. Migrar `@sentry/nextjs`, `@sentry/node` e `@sentry/profiling-node` para 11.10.0; alinhar o runtime PDF. Usar instalação oficial, sem overrides da API OpenTelemetry.
3. Substituir `sendDefaultPii` pela política compartilhada `dataCollection`. Desativar coleta de usuário, cookies, cabeçalhos, corpos HTTP, query strings, dados de consultas, filas, GraphQL, IA e variáveis de stack. Manter o scrubber de eventos. Aplicar a mesma política ao worker PDF.
4. Migrar profiling para `profileSessionSampleRate` e `profileLifecycle: "trace"`, preservando a variável de ambiente existente. A amostragem passa a ocorrer por sessão; não é matematicamente idêntica à antiga amostragem por transação.
5. Executar regressões focadas, o gate completo uma vez, auditorias dos três runtimes e uma construção de produção. Validar Compose sem expor arquivos protegidos.
6. Preservar imagens de recuperação; validar o artefato compilado, implantar sem reconstrução e verificar saúde e fluxos no navegador. Registrar revisão implantada, commit e push. Não acompanhar CI remoto.

## Evidências já obtidas

- Antes da migração, dois testes falharam especificamente pela presença de `sdk-trace-base` nos lockfiles web e PDF. O migrador já estava livre desse pacote.
- Após a migração, `npm ci` completou sem avisos de depreciação. Nenhum pacote dos três lockfiles contém marcador `deprecated`; os antigos SDKs `sdk-trace-base/node/web` não estão presentes.
- `npm ls --all` terminou sem problemas de dependências ou peers. Auditorias web, PDF e migrador: zero vulnerabilidades em todas as severidades.
- Os 25 testes focados passaram. O teste do SDK real usa transporte em memória e um processo sem credenciais de produção: captura uma exceção e spans reais, carrega a integração nativa de profiling e confirma que o contexto sensível sintético não chega ao transporte. Nenhum evento foi enviado a um serviço externo.
- TypeScript e lint focado aprovados. Novos testes também verificam o scrubber, a política de privacidade, DSN seguro e amostragem limitada entre zero e um.
- Nenhuma configuração de segredo, banco, grade, autorização ou schema foi modificada. Nenhuma nova dependência direta foi adicionada.
- `npm run quality` executado uma vez, com saída zero. Prisma, TypeScript, lint, testes operacionais, Knip, gates de tamanho e rotas passaram. Foram verificados 381 módulos e 73/73 rotas com cenário funcional 2xx.
- Vitest: 295 arquivos aprovados; 2.187 testes aprovados e 3 condicionais pulados. Cobertura: linhas 65,31%, statements 63,37%, funções 59,42%, branches 56,20%; gates preservados e aprovados.
- Navegador em ambiente com banco, fila e solver isolados: 67 E2E aprovados e 5 condicionais pulados, em 16,5 minutos. Os pulos de fixtures privadas não são considerados testes executados. Compose protegido também foi validado sem expor configuração.

## Fontes oficiais

- [Migração Sentry 10 para 11, na versão utilizada](https://github.com/getsentry/sentry-javascript/blob/11.10.0/MIGRATION.md#upgrading-from-10x-to-11x)
- [Release Sentry 11.10.0](https://github.com/getsentry/sentry-javascript/releases/tag/11.10.0)
- [Consolidação dos pacotes de tracing OpenTelemetry](https://github.com/open-telemetry/opentelemetry-js/blob/main/packages/opentelemetry-sdk-trace-base/README.md)
- [Metadados oficiais Sentry Next 11.10.0](https://registry.npmjs.org/@sentry/nextjs/11.10.0)
- [Metadados oficiais Sentry Node 11.10.0](https://registry.npmjs.org/@sentry/node/11.10.0)

## Fechamento

Pendente neste checkpoint: construção, E2E do artefato, implantação e sincronização Git. Este documento será atualizado com a evidência real da liberação, sem considerar testes pulados como executados.
