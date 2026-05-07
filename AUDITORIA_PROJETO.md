# Auditoria do Projeto

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
