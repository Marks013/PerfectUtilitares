# Continuação da auditoria — 05/11/2026

## Resultado

As dez CVEs nativas pendentes do Solver na auditoria anterior foram eliminadas
da nova imagem. O scanner reconheceu tanto o sistema Wolfi quanto as
distribuições Python e retornou zero avisos em todas as severidades.
Não foram usadas exceções, filtros por CVE ou remoção manual de bibliotecas.

Código e imagens de app, worker PDF e Solver:
`39931d3c98a6f106e29e8485830b565e770721f5`.
O banco permaneceu na imagem anterior. Esta documentação posterior não exige
reconstrução das imagens, pois não altera seus arquivos de execução.

## Correções

Para reauditar estas imagens após um commit somente de documentação, execute
em `/home/ubuntu/PerfectUtilitares/web`, informando a revisão publicada:

```sh
npm run security:containers -- \
  web-app=39931d3c98a6f106e29e8485830b565e770721f5 \
  web-pdf-worker=39931d3c98a6f106e29e8485830b565e770721f5 \
  web-migrate=39931d3c98a6f106e29e8485830b565e770721f5 \
  web-escalas-solver=39931d3c98a6f106e29e8485830b565e770721f5
```

| Área | Correção entregue |
| --- | --- |
| Runtime do Solver | Debian substituído por Wolfi Base oficial, fixado por digest. CPython continua na linha 3.13; as dez distribuições Python permanecem nas mesmas versões. Bibliotecas nativas recebem as correções do mantenedor Wolfi. |
| Instalação Python | Builder e runtime compartilham o mesmo interpretador. O ambiente contém somente wheels oficiais PyPI com versões e SHA-256 fixados para Linux arm64/amd64; source builds são rejeitados. O pip não está importável no runtime. |
| Segurança de imagens | Solver incluído no scan padrão, ao lado de app, worker e migrator. Verificação de origem, versão, data e revisão OCI preservada. |
| Releases por componente | O scanner permite `imagem=<hash Git completo>` explícito. O hash deve existir no repositório; não se aceita automaticamente o rótulo da própria imagem. Sem parâmetro, continua exigindo HEAD. |
| Implantação | Todas as réplicas de app, worker e Solver devem estar ativas na revisão esperada. Solver deixou de ficar fora dessa confirmação. |
| Worker PDF sem Sentry | Falhas de heartbeat, retenção, limpeza de entradas e manutenção Presença geram logs locais JSON sanitizados. São quatro códigos fixos, sem erro bruto, caminhos, documentos ou identificadores. Limite de um registro por evento a cada cinco minutos; Sentry e tentativas continuam funcionando. |
| Estado de prontidão | Falha do primeiro heartbeat não anuncia “pronto”. A verificação de saúde continua responsável por confirmar recuperação. |
| Gráfico de cobertura | Títulos SVG passaram a receber uma única string. A regressão reproduziu o aviso do React e a descrição ausente; após o ajuste, texto acessível preservado e nenhum aviso. Layout, cores e dados não foram alterados. |
| Qualidade | Testes dos gates de imagem/Python/deploy entram em `test:ops`. Limiares de cobertura elevados sem excluir arquivos ou reduzir regras. |

Os limiares agora são, na ordem linhas/funções/statements/branches:

- Global: 65/59/63/56%.
- Bibliotecas: 87/90/85/77%.
- APIs: 78/84/72/58%.
- Componentes: 30/28/30/30%.

Isso protege a cobertura existente contra regressão; não significa que todos
os fluxos da interface estejam cobertos.

## Segurança e compatibilidade efetivas

- Runtime verificado: Python 3.13.18, OpenSSL 4.0.3, SQLite 3.54.1,
  zlib 1.3.2.1-motley. Imagem do Solver: 96.843.423 bytes.
- Mantidos OR-Tools 9.15.6755, NumPy 2.5.4, pandas 3.1.0, protobuf 6.33.6
  e os demais pins. `pip check`, imports nativos, CAs e timezone
  America/Sao_Paulo passaram durante o build.
- Trivy 0.74.0: Solver com zero UNKNOWN/LOW/MEDIUM/HIGH/CRITICAL.
  Gate real das quatro imagens: zero HIGH/CRITICAL e metadados OCI válidos.
  O resultado de todas as severidades do Solver não deve ser extrapolado
  para as outras imagens, cujo gate avalia HIGH/CRITICAL.
- `npm audit --audit-level=low`: zero no app, worker e migrator.
- `npm run security:python`: 38 versões distintas sem avisos OSV.
- O algoritmo, regras de escala, contratos HTTP, segredo do Solver e dados
  salvos não foram alterados. Não foram copiadas bibliotecas Debian para Wolfi.

A versão Wolfi do Python inclui backports do mantenedor. O digest da base,
o pin do Python e os hashes dos wheels estão fixados. O índice APK permanece
corrente para receber correções: isso não torna o build inteiro bit-reprodutível.
A atualização futura deve repetir o scan e os checks de runtime.

## Verificação proporcional à alteração

1. `npm run quality:code`: Prisma, TypeScript, lint, 28 testes operacionais,
   305 arquivos Vitest com 2.297 testes aprovados e três ignorados, knip,
   limites de módulos e 73/73 rotas com cenário funcional 2xx.
2. Cobertura: linhas 66,18%, funções 60,10%, statements 64,18%, branches
   57,40%. Novos limiares aprovados. O ajuste posterior dos dois títulos SVG
   passou em regressão direcionada, lint e no build de produção.
3. Uma construção conjunta de app, worker, migrator e Solver. O build Next
   concluiu compilação e TypeScript. Compose validado com os arquivos
   protegidos, sem imprimir ou alterar seu conteúdo.
4. Cinco regressões existentes executadas dentro do Solver publicado:
   distribuição de fins de semana, cobertura estimada, folgas bloqueadas,
   reprodutibilidade e afastamentos. Todas passaram em 1,815 s.
5. Serviço HTTP de produção: rejeição sem autenticação, geração real com
   cinco dias de trabalho e duas folgas, proteção contra repetição,
   cancelamento antecipado e durante o cálculo, confirmação terminal e
   nova geração após liberar a vaga. Geração inicial: 719 ms;
   cancelamento e término: 619 ms. São amostras, não percentis de produção.
6. Navegador real no fluxo PDF de produção: dois PDFs sintéticos, total
   7.251.216 bytes; saída 544.640 bytes; ZIP 479.894 bytes; 12.289 ms.
   Aplicação de 150 DPI/tons de cinza, preservação de texto/OCR e integridade
   conferidas. Apenas o job sintético foi removido, com HTTP 204.
7. App, worker, Solver e banco saudáveis; revisões dos três serviços
   publicados conferidas. Imagens anteriores preservadas para recuperação.

Não foi repetido `npm run quality` com a suíte E2E isolada, seguindo a
orientação para evitar testes isolados/extensos. O gate de código foi executado
uma vez; os checks posteriores se limitaram aos componentes afetados e ao
fluxo real em produção. Não houve migração, seed, alteração de credenciais,
reprocessamento de grades reais ou limpeza de cache compartilhado.

## Limites que permanecem explícitos

- Sentry externo continua dependendo de um DSN válido da conta do usuário.
  Nenhuma conta, conexão ou credencial foi inventada. Os logs locais entregues
  cobrem as falhas de manutenção identificadas, mas não substituem entrega
  externa de eventos nem métricas por fase de todas as operações.
- `next-auth@5.0.0-beta.32` continua sendo a beta atual, não deprecated;
  o dist-tag estável aponta para 4.24.15. Não foi feito downgrade de linha
  sem defeito comprovado ou migração equivalente dos contratos de autenticação.
- Cobertura de interface segue parcial. Os novos limiares bloqueiam sua
  regressão, mas esta entrega não promete validação de todos os estados
  possíveis, carga de produção, p95 ou ganho de desempenho em qualquer PDF.

## Fontes primárias da decisão

- [Imagem Wolfi Base](https://github.com/chainguard-images/images/tree/main/images/wolfi-base).
- [Pacote Python 3.13 Wolfi](https://github.com/wolfi-dev/os/blob/main/python-3.13.yaml).
- [SQLite Wolfi](https://github.com/wolfi-dev/os/blob/main/sqlite.yaml)
  e [zlib Wolfi](https://github.com/wolfi-dev/os/blob/main/zlib.yaml).
- [Wheels oficiais OR-Tools 9.15.6755](https://pypi.org/project/ortools/9.15.6755/).
- [Registro oficial next-auth](https://registry.npmjs.org/next-auth).
- [Auditoria anterior](AUDITORIA-2026-11-04.md), preservada como registro histórico.
