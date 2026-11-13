# F10 catalog safety fix

Despacho: F10-CATALOG-SAFETY-FIX:r1:batch68-1  
Liberação: plano 68, hash 055ada0b8ed25c1e2d2c9f3de88efd6266df0b1325b433af41efd52f6f347333  
HEAD de referência: 999cc30b9c7b251ab134cc522157ebab758458a3

## Alterações

- web/src/lib/escalas/shift-catalog/catalog.ts: EscalaActor agora vem de ../access. No HEAD, types.ts não declara esse tipo; access.ts o exporta. A importação equivalente em export.ts também foi corrigida.
- catalog.ts: SYNC verifica permissão e revisão na prévia. Dentro da transação, bloqueia as linhas EscalaWorkspace em ordem crescente de ID, compara a revisão atual e relê o snapshot exato antes de montar candidatos ou alocar códigos. Só então bloqueia o contador do tenant e grava o catálogo. Divergência retorna TURNO_REVISION_CONFLICT. A ordem workspace → contador é igual em todas as sincronizações e não inverte a atualização CAS de saveEscala.
- catalog.test.ts: regressão com barreira controla uma atualização CAS entre a leitura inicial e a transação; a sincronização deve detectar revisão 4 e não gravar códigos. Inclui casos de propriedade do manifesto para usuário, sessão da conta, sessão operacional e tenant.
- TurnoExportManifest agora guarda IDs do usuário e da sessão da conta ou sessão operacional que criou o manifesto. A leitura exige o mesmo tenant e o mesmo conjunto de identidades. Nenhum token, senha ou credencial é persistido.
- domain.ts e domain.test.ts: TXT2 emite uma linha por código global, em ordem crescente. TXT1 mantém a matrícula original. export.ts recusa matrícula com delimitadores, controles ou separadores de linha, com erro que orienta corrigir o cadastro na origem.
- prisma/schema.prisma e a migração 20261113041144_escala_shift_catalog/migration.sql incluem as colunas proprietárias nullable. A migração não foi aplicada.

## Verificação

- Contrato congelado, sem alterações: SHA-256 b744d2370a41a947ad1238bfcbef36382a2b8be7061b098ed442dcabf7aeca44.
- git diff --check no schema: passou.
- Verificação UTF-8 e espaços finais nos arquivos de código, teste e migração: passou.
- Testes, typecheck, build e migração não foram executados, conforme a liberação. O parser TypeScript não está instalado no checkout (typescript ausente); não instalei dependências.
- Context Mode foi validado com ctx_execute. A leitura e edição do repositório remoto usaram SSH direto, pois o sandbox Context Mode não acessa esse checkout.
- Nenhum serviço ou processo de fundo foi iniciado.

## Próxima verificação

F08 deve executar prisma generate antes do typecheck/build: o cliente atualmente gerado não contém os novos campos proprietários. O teste de concorrência documenta a intercalação e o CAS, mas ainda não foi executado contra PostgreSQL; a validação real dos bloqueios aguarda a suíte liberada. Nenhuma mudança foi feita em swap.ts, contrato, rotas, UI ou arquivos Python.

## SHA-256 dos arquivos do lote

- catalog.ts: 5dc43268790316b2f9f5d687f3f2caf3df55adbde910d8aaa919fa9badca80ee
- catalog.test.ts: dd763f7d4853996c3f825d1f7d3dd2513cc3e9e087c18eba471df0c1f5205073
- domain.ts: b82cfbd5dd76dd50d40612b9c9c3b256a9b17ab49af092a5caccdfa6f9162123
- domain.test.ts: d213e7f3ce93c3064792bf454f82f46bd2f48b84376b5831405a31405e4f9a8c
- export.ts: 78130f43d325b47f8f4bfdd0a0712e52770ace534ef5c2988735d7a3b3346668
- export.test.ts: 7e1cbb4aa35dd3f4b1560553491182b004a857fb65f460c7bb98cd0514e36bb5
- schema.prisma: 74dd0b4d0977fcd22d93ec3d21ae630c7d93332b371b0b8aae6a55dd4f8059d5
- migration.sql: 55cea010edb3b8f04098adb5fb05f09427bdc8cb6c35f6f284a7bb7c2b2b4f75
