# Auditoria de Paridade com Legado

Data: 2026-05-07

## Escopo

- `ValidadorJornada`: .NET/WPF legado.
- `EditorFotos3x4`: Python/C# legado.
- `web`: Next.js/TypeScript/Prisma.

## Decisoes Mantidas

- A validacao por lote Excel DP permanece fora do sistema Web.
- XLSX continua permitido apenas para importar `Banco Horario.xlsx` em `CodigoJornada`.
- O classificador Haar do legado fica copiado como asset de compatibilidade, mas a deteccao ativa no navegador usa MediaPipe.

## Paridade Validador de Jornada

| Funcao/Regra legado | Status Web | Evidencia |
| --- | --- | --- |
| Validar 2 ou 4 horarios | OK | `web/src/lib/jornada/validator.ts` |
| Autoformatar `0800` para `08:00` | OK | `web/src/lib/jornada/input-format.ts` |
| Memoria de autoformatacao | OK | `web/src/components/jornada-validation-form.tsx` |
| Memoria de interjornada | OK | `web/src/components/jornada-validation-form.tsx` |
| Interjornada minima 11h | OK | `web/src/lib/jornada/validator.ts` |
| Jornada 8h abre sabado 4h automaticamente | OK | `web/src/components/jornada-validation-form.tsx` |
| Sabado combinado 44h/220h | OK | `web/src/lib/jornada/validator.ts` |
| Cargas mensais semanal/6*30 | OK | `web/src/lib/jornada/default-rules.ts` |
| Intervalo almoco minimo 1h | OK | `web/src/lib/jornada/validator.ts` |
| Primeiro/segundo periodo maximo 4h | OK | `web/src/lib/jornada/validator.ts` |
| Erros por periodo e periodo total | OK | `web/src/lib/jornada/validator.ts` |
| Codigo importado aparece na validacao | OK | `web/src/components/jornada-validation-form.tsx` |
| Historico na tela principal | OK | `web/src/components/jornada-validation-form.tsx` |
| Historico completo com filtros | OK | `web/src/app/(app)/jornada/historico/page.tsx` |
| Exportacao PDF de jornadas selecionadas | OK | `web/src/app/api/jornada/historico/exportar/route.ts` |
| Regras editaveis | OK | `web/src/components/jornada-rules-manager.tsx` |
| Importacao Codigo Jornada XLSX/CSV/JSON | OK | `web/src/app/api/jornada/codigos/import/route.ts` |

## Paridade Editor Fotos 3x4

| Funcao legado | Status Web | Evidencia |
| --- | --- | --- |
| Upload individual | OK | `web/src/components/photo-3x4-workspace.tsx` |
| Upload em lote | OK | `web/src/components/photo-3x4-workspace.tsx` |
| Corte 3x4 | OK | `react-easy-crop`, `web/src/lib/photos/processor.ts` |
| Auto crop face | OK | `web/src/components/photo-3x4-workspace.tsx` |
| Redimensionamento | OK | `web/src/lib/photos/processor.ts` |
| Qualidade | OK | `web/src/lib/photos/schema.ts` |
| Contraste | OK | `web/src/lib/photos/processor.ts` |
| Brilho | OK | `web/src/lib/photos/processor.ts` |
| Borda | OK | `web/src/lib/photos/processor.ts` |
| Download individual | OK | `web/src/components/photo-3x4-workspace.tsx` |
| ZIP em lote | OK | `web/src/app/api/fotos/lote/route.ts` |
| Conversao para JPEG/PNG/WEBP | OK | `web/src/lib/photos/schema.ts` |

## Paridade de Permissoes Web

| Regra | Status | Evidencia |
| --- | --- | --- |
| Admin acesso total | OK | `web/src/lib/api/security.ts` |
| Usuario pode ter Jornada/Fotos habilitado separadamente | OK | `web/prisma/schema.prisma` |
| Historico restrito ao usuario comum; admin ve todos | OK | `web/src/app/(app)/jornada/historico/page.tsx`, `web/src/app/api/jornada/historico/route.ts` |
| Exportacao PDF respeita usuario/admin | OK | `web/src/app/api/jornada/historico/exportar/route.ts` |

## Validacao

- `npm run typecheck`: OK
- `npm test`: 39 testes aprovados
- `npm run prisma:validate`: OK
- `npm run build`: OK
- `npm audit --audit-level=moderate`: 0 vulnerabilidades
- `npm ls --all --json`: 0 problemas apos limpeza dos opcionais WASM gerados pelo build
