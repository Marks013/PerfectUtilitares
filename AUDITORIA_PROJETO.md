# Auditoria do Projeto

## Revisão incremental — 2026-11-24

A revisão inventariou a aplicação Web e priorizou achados reproduzíveis, sem alterar dados ou configurações de produção.

| Área | Achado e correção | Evidência |
| --- | --- | --- |
| Jornada — importação | A leitura multipart preserva o limite de 8 MiB para o corpo inteiro, inclusive sem `Content-Length`. Planilhas XLSX passam pela validação de arquivo compartilhada antes da abertura. Falhas de persistência retornam mensagem genérica, enquanto erros do leitor mantêm seu status HTTP. | [Sucesso da rota com CSV real](web/src/app/api/route-success-admin-jornada.test.ts) e [testes de leitura XLSX](web/src/lib/codigos/importer.test.ts). |
| Conta e hidratação | A recuperação de senha não confirma sucesso em respostas HTTP de erro. O formulário associa a validação ao campo, anuncia o resultado e mantém o alvo de envio de 44 px em dispositivo móvel. O seletor acompanha o tema do documento e funciona mesmo sem acesso de escrita ao armazenamento local. | [Dois cenários no Chromium](web/e2e/password-recovery.spec.ts), incluindo largura de 390 px. |
| Reajuste salarial | A pesquisa normaliza a consulta uma vez por filtragem, e a lista ordenada de cargos só é recalculada quando muda a relação de empregados. A seleção mantém a ordem e a comparação sem acentos. | [Testes do modelo do reajuste](web/src/components/reajuste-salarial/salary-revision-workspace-model.test.ts). |
| PDF | Os testes de classificação não exigem um executável POSIX de simulação, e o teste de exportação usa os separadores de caminho do sistema. O teste de subprocesso verifica apenas as variáveis relevantes, sem imprimir o ambiente herdado quando uma asserção falha. | [Análise de compressão](web/src/lib/pdf/compression-analyzer.test.ts) e [exportação Office](web/src/lib/pdf/office-export.test.ts). |

A verificação na base atual encontrou 81 rotas elegíveis com teste dedicado e cenário 2xx. TypeScript, lint, os testes focados e o Chromium passaram com Node 24. O teste de recuperação no navegador simula as respostas HTTP; não verifica entrega de e-mail. O gate integral do release não foi concluído.

Pendências para a próxima rodada, em ordem:

1. Na base `da95c5b`, as 11 rotas que aceitam formulários multipart já usam o leitor compartilhado. A revisão acrescentou a validação da estrutura XLSX à [validação em lote de Jornada](web/src/app/api/jornada/validar-lote/route.ts) antes de consultas e processamento, com cobertura de planilha válida e rejeição de arquivo inválido. A validação de conteúdo e o isolamento por empresa das demais rotas devem ser verificados por fluxo.
2. Validar fluxos autenticados, workers e integrações reais em ambiente isolado com banco e o runtime Node 24 do projeto. Executar a validação completa de release antes de qualquer deploy.
3. Medir tempos e responsividade em listas grandes e revisar acessibilidade com navegação por teclado e contraste em outros módulos. A revisão visual no navegador se concentrou na recuperação de senha; não comprova conformidade WCAG global nem desempenho em produção. Os apontamentos estáticos de Jornada, PDF e Eventos são cosméticos; a tipografia de impressão foi preservada.

Não houve deploy.

## Conciliação do servidor com o PR #69 — 2026-11-24

- Base da candidata: `6bcb456`. As 21 mudanças de código do servidor foram preservadas separadamente no snapshot local `1bd7b03`, sobre `7cccaa2`, sem copiar dados de operação.
- A fusão direta apresentou 13 conflitos. A candidata mantém o calendário, a proteção da cobertura de dezembro e o contrato do Solver do PR. Foram portadas separadamente duas melhorias do snapshot: a compensação de folga entre semanas com limites de cobertura e tempo, e o tratamento de um desfalque constante ao fixar objetivos de cobertura.
- O snapshot integral foi mantido para revisão. A candidata não substitui o checkout de produção e não é um comprovante de aprovação do gate de release.

## Histórico — 2026-05-07

Data: 2026-05-07
Atualizacao: paridade revisada com legado; PDF de historico, ajustes de foto, regras de almoco, interjornada/sabado combinado e deteccao facial automatica implantados no web.

## Escopo validado

- Legado ValidadorJornada: projeto .NET/WPF em `ValidadorJornada`.
- Legado EditorFotos3x4: no workspace atual nao ha fontes C++ (`.cpp/.h`); o projeto auditavel e Python com componente C# `FastImageOps`.
- Novo sistema Web: Next.js/TypeScript/Prisma em `web`.

## Validacoes executadas

| Area | Comando | Resultado |
| --- | --- | --- |
| ValidadorJornada .NET | `dotnet test ValidadorJornada/tests/ValidadorJornada.Tests/ValidadorJornada.Tests.csproj --verbosity minimal` | 85 testes aprovados |
| EditorFotos3x4 Python | `python -m compileall -q EditorFotos3x4/src` | OK |
| EditorFotos3x4 FastImageOps | `dotnet build EditorFotos3x4/src/cs_components/FastImageOps/FastImageOps.csproj --verbosity minimal` | OK, 0 erros |
| Web Prisma | `npm run prisma:validate` | OK |
| Web TypeScript | `npm run typecheck` | OK |
| Web testes | `npm test` | 39 testes aprovados |
| Web build | `npm run build` | OK |
| Web dependencias | `npm audit --json` | 0 vulnerabilidades |
| Web arvore npm | `npm ls --all --json` | 0 problemas |
| .NET vulnerabilidades | `dotnet list ... package --vulnerable --include-transitive` | Sem pacotes vulneraveis reportados |
| Python ambiente | `python -m pip check` | Sem conflitos instalados |
| Docker local | `docker --version` | Docker CLI nao instalado nesta maquina |

## Matriz de requisitos

| Requisito | Status | Evidencia |
| --- | --- | --- |
| Autenticacao | OK | `web/src/auth.ts` |
| Dashboard | OK | `web/src/app/(app)/dashboard/page.tsx` |
| Jornada: validacao manual | OK | `web/src/app/api/jornada/validar/route.ts`, `web/src/lib/jornada/validator.ts` |
| Jornada: interjornada e sabado combinado automatico | OK | `web/src/lib/jornada/validator.ts`, `web/src/components/jornada-validation-form.tsx` |
| Jornada: regras | OK | `web/src/app/api/jornada/regras/route.ts` |
| Jornada: historico | OK | `web/src/app/api/jornada/historico/route.ts` |
| Jornada: exportacao PDF de historico | OK | `web/src/app/api/jornada/historico/exportar/route.ts`, `web/src/lib/jornada/pdf.ts` |
| Jornada: codigo importado no resultado/historico | OK | `web/src/components/jornada-validation-form.tsx`, `web/src/app/api/jornada/validar/route.ts` |
| Jornada: almoco minimo 1h e periodos maximos 4h | OK | `web/src/lib/jornada/validator.ts`, `web/src/lib/jornada/validator.test.ts` |
| Jornada: cadastro/importacao Banco Horario XLSX/CSV/JSON | OK | `web/src/lib/codigos/importer.ts`, `web/src/app/api/jornada/codigos/import/route.ts` |
| Remover validacao por lote Excel DP | OK | Nao ha modelo `JornadaBatch`; XLSX ficou restrito a `CodigoJornada` |
| Banco Horario compartilhado entre tenants | OK | `CodigoJornada` nao possui `tenantId` em `web/prisma/schema.prisma` |
| Fotos 3x4 individual | OK | `web/src/components/photo-3x4-workspace.tsx`, `web/src/app/api/fotos/processar/route.ts` |
| Fotos 3x4 deteccao facial automatica | OK | `web/src/components/photo-3x4-workspace.tsx`, `web/src/lib/photos/face-crop.ts`, assets MediaPipe em `web/public/mediapipe/face_detection` |
| Fotos 3x4 contraste/brilho/borda | OK | `web/src/lib/photos/schema.ts`, `web/src/lib/photos/processor.ts` |
| Fotos 3x4 lote ZIP | OK | `web/src/app/api/fotos/lote/route.ts`, `web/src/lib/photos/processor.ts` |
| Corte/redimensionamento | OK | `react-easy-crop` + `sharp` |
| Permissao por modulo por usuario | OK | `canAccessJornada`, `canAccessFotos` |
| Admin controla usuarios | OK | `web/src/components/users-manager.tsx`, APIs `/api/admin/users` |
| Admin cria tenants e convites Resend | OK | `web/src/app/api/admin/tenants/route.ts`, `web/src/app/api/admin/invitations/route.ts` |
| Usuario exclui propria conta | OK | `web/src/app/api/account/route.ts`, `/conta` |
| Admin criado por `.env` | OK | `web/scripts/ensure-env.mjs`, `web/prisma/seed.ts` |
| Sentry | OK | `web/next.config.ts`, `sentry.*.config.ts`, API de teste |
| GET/POST/API robustos | Parcial OK | Guards de auth, modulo, rate limit, content-type, tamanho, same-origin |
| Docker/Compose | Parcial OK | Config pronto, mas nao executado localmente por falta de Docker |

## Achados

### Resolvido - Interjornada e modo sabado combinado

O legado possui validacao entre duas jornadas e regra especial de sabado:

- `ValidadorJornada/src/ValidadorJornada/Core/Services/JornadaValidator.cs:42`
- `ValidadorJornada/src/ValidadorJornada/Core/Services/JornadaValidator.cs:198`

O web agora aceita `modo=interjornada` e `modo=sabado-combinado`, retorna duas jornadas, calcula interjornada minima de 11h e aplica a regra 8h + 4h:

- `web/src/lib/jornada/validator.ts:50`
- `web/src/app/api/jornada/validar/route.ts`
- `web/src/components/jornada-validation-form.tsx`

### Resolvido - Deteccao facial automatica no editor web

O legado de fotos possui modulo de deteccao facial:

- `EditorFotos3x4/src/modules/face_detection.py:88`
- `EditorFotos3x4/src/modules/haarcascade_frontalface_default.xml`

O web agora possui botao de deteccao facial automatica. O motor no navegador usa MediaPipe, e o ajuste de crop segue a mesma ideia do legado: caixa do rosto, margem e encaixe 3x4. O classificador Haar do legado tambem e copiado como asset de compatibilidade:

- `web/src/components/photo-3x4-workspace.tsx:8`
- `web/src/lib/photos/face-crop.ts`
- `web/scripts/sync-mediapipe.mjs`

Impacto: gap funcional fechado no web. A implementacao nao depende de OpenCV nativo no container Docker.

### P2 - Nao ha fonte C++ auditavel no workspace

Foram procurados arquivos `.cpp`, `.h`, `.hpp`, `.vcxproj` e similares. O projeto `EditorFotos3x4` presente contem Python e C#, nao C++.

Impacto: nao e possivel declarar auditoria de codigo C++ a partir deste workspace. O que foi auditado foi o editor existente: Python + `FastImageOps` C#.

### P3 - Testes Python do EditorFotos3x4 nao executaram por falta de pytest

`python -m pytest EditorFotos3x4/tests -q` falhou porque `pytest` nao esta instalado no ambiente global. A sintaxe Python passou com `compileall`, e o componente C# compilou.

Impacto: cobertura automatizada do editor legado ficou parcial no ambiente atual.

### P3 - Docker nao foi executado localmente

`docker --version` falhou porque Docker CLI nao esta instalado nesta maquina.

Impacto: `Dockerfile` e `docker-compose.yml` foram auditados por arquivo e o build web passou, mas o build real de imagem/container precisa ser feito no servidor Ubuntu ou em uma maquina com Docker.

### P3 - API de teste do Sentry nao tem rate limit proprio

`web/src/app/api/monitoring/sentry-test/route.ts:15` exige admin e same-origin, mas nao aplica `enforceRateLimit`.

Impacto: baixo, pois e rota administrativa; ainda assim vale padronizar para reduzir spam acidental de eventos.

## Conclusao

O sistema web esta coerente com a arvore funcional solicitada e passou nas validacoes automatizadas. Os maiores gaps aparecem apenas quando a exigencia e "100% equivalente ao legado": interjornada/modo sabado combinado no validador e deteccao facial automatica no editor de fotos.
