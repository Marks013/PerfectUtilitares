# Auditoria técnica — 4 de novembro de 2026

Coleta iniciada em 4 de novembro; validação final e preparação de publicação
continuadas em 5 de novembro de 2026.

## Escopo e referência

A inspeção foi feita no servidor, a partir da revisão de produção `f49b565`.
O inventário encontrou 45 páginas e 75 arquivos de rotas no App Router. O
gate do projeto verifica 73 rotas da API, todas com teste dedicado e cenário
2xx declarado. Isso não equivale a um teste manual de todos os fluxos.

Na coleta, app, worker de PDF, PostgreSQL e solver estavam saudáveis. O
disco estava em 50%, o banco tinha 28 MB e a amostra de CPU dos contêineres
ficou abaixo de 1%. A amostra não representa o pico. Não foram feitos testes
de carga em produção ou coleta de arquivos pessoais. A varredura final das
imagens cobre vulnerabilidades altas e críticas. A retenção de jobs PDF não forneceu dados suficientes para estimar
a latência de produção, e o banco não possui `pg_stat_statements` habilitado.

## Achados e correções

| Área | Achado | Correção |
| --- | --- | --- |
| Jornada: validação em lote | A API pública podia iniciar o parser multipart sem limitar os bytes se faltasse `Content-Length`. Um XLSX pequeno também podia expandir XML excessivo. | Limite aplicado durante a leitura, antes do parser e do banco. XML limitado a 16 MiB por entrada; até 25 mil linhas reais e 250 mil células, com coordenadas Excel validadas. |
| Jornada: códigos e histórico | A importação administrativa tinha a mesma lacuna de limite multipart. Toda leitura do histórico esperava um expurgo. | Importação limitada durante a leitura. Histórico consulta apenas os últimos 30 dias, sem cache compartilhado; expurgo após a resposta, deduplicado por processo e com intervalo de uma hora. |
| Unimed e Reajuste Salarial | Rotas autenticadas aceitavam ler o multipart inteiro antes de conferir os limites de arquivo. Reajuste já exigia tamanho declarado. | Limites de corpo também no stream; autenticação, limites por arquivo e retorno 411 do Reajuste preservados. |
| Escalas | O diagnóstico de cobertura revarria demandas para cada data/setor. | Agrupamento em uma passagem. Na mediana de três repetições com 10.080 demandas sintéticas, 472,3 ms → 47,2 ms. O hash do resultado completo foi idêntico. O Solver não foi alterado. |
| Unimed: reconciliação | Busca de matrículas ambíguas e referências de titular revarria listas completas. | Índices locais, mantendo vínculos, ordem e motivos. Sem alterações em módulo offline. |
| PDF: ZIP | Todos os PDFs abriam streams de uma vez. A compactação ZIP nível 6 gastava CPU em PDFs já comprimidos. | Arquivos abertos conforme consumo, nível 1, cancelamento da fila ao fechar a resposta e erro de finalização tratado. O teste real preserva os bytes e resolve nomes duplicados. |
| Fotos | Resultado parcial era exibido como se todas as fotos tivessem sido processadas. | Contagem real do servidor e aviso de fotos que ficaram fora do ZIP. |
| Deploy | O script não aguardava a saúde nem verificava a revisão dos serviços; podia podar cache compartilhado sem opt-in. | Aguarda serviços, confere revisão ativa de app e worker e só poda cache com `ENABLE_BUILDKIT_GC=1`. `SKIP_BUILDKIT_GC=1` continua vetando. |
| Dependências | Next.js estava em 16.4.3. | Atualizado para [16.4.5, correção de segurança do fornecedor](https://github.com/vercel/next.js/releases/tag/v16.4.5). O lock mudou apenas Next.js, `@next/env` e binários SWC associados. |
| Imagens: bibliotecas e instaladores | O scan final identificou três avisos altos no Expat 2.9.0 e cinco em componentes vendorizados pelo pip, ausentes no inventário de distribuições Python. | Exigir Expat >= 2.10.0-r0 no ramo estável Alpine 3.24. Remover o pip dos dois venvs após a instalação por meio de seu próprio desinstalador; ele não é necessário em execução. Nenhum alerta foi silenciado. |

No microteste de Deflate do ZIP, sobre um PDF sintético de 1,05 MB, a mediana
caiu de 25,10 para 19,97 ms, com cerca de 1% a mais de bytes no arquivo
compactado. Isso não mede o tempo de download nem prevê ganho idêntico para
todos os lotes.

Férias, Conta/Admin/convites, autenticação, Presença e SEO foram inventariados
e verificados pelos testes de contrato e da aplicação, sem mudanças de
comportamento nesta etapa. Presença estava desativada na produção durante a
auditoria. Não foram gerados convites ou alteradas contas, grades e dados reais.

## Pendências e limites

- Os 8 avisos moderados npm do app e os 4 do worker foram corrigidos.
  `npm audit --audit-level=low` retornou zero no app, worker e migrator.
  A atualização [Sentry 11.11.0](https://github.com/getsentry/sentry-javascript/pull/26014)
  incorpora Glob 14 corrigido. O override de Minimatch 11.0.4 ficou limitado
  ao `readdir-glob`, com teste real de glob/ignore e ZIP; não houve downgrade.
- O runtime Python passa a usar venv de OCR independente dos pacotes APK,
  com 21 versões e hashes fixados em `runtime-requirements.txt`. Pillow
  13.0.0, cryptography 50.0.2 e setuptools 84.2.1 substituem as versões com
  avisos. O venv Office também recebe Pillow 13.0.0 e cryptography 50.0.2.
  OCRmyPDF 16.11.1 e pikepdf 10.1.0 foram mantidos. Os pins foram conferidos
  nos metadados oficiais PyPI, no resolvedor pip e na base OSV, sem alertas
  para esse conjunto na consulta. Isso não substitui scanner das bibliotecas
  nativas e das imagens completas.
- O CI passa a rejeitar avisos npm moderados e a consultar os três locks
  Python no OSV. O comando `npm run security:python` conferiu 38 versões
  distintas, sem avisos conhecidos; erros ou respostas incompletas da consulta
  não são tratados como aprovação.
- A autenticação continua em `next-auth@5.0.0-beta.32`. O dist-tag estável de
  outra linha não justifica downgrade. Verificar login, sessão e revogação
  antes de qualquer troca de linha.
- Health checks ativos não substituem observabilidade. Sem telemetria de
  duração por etapa e de porcentagem de originais preservados, não há base
  para anunciar melhora global de latência ou capacidade.
  O DSN Sentry estava vazio na produção. O expurgo da Jornada registra também
  aviso fixo no log, sem dados ou erro bruto, para não depender desse serviço.
- Nenhuma migração de produção, alteração de segredos, limpeza de cache
  compartilhado ou modificação em grades e dados reais integra esta entrega.

## Validação consolidada

- 304 arquivos de teste: 2.292 testes aprovados e 3 ignorados.
- Prisma validado, TypeScript, lint, guardas operacionais, análise de código
  morto, limite de módulos e gate de rotas aprovados. Limiares não foram
  reduzidos.
- Cobertura global: linhas 66,18%; statements 64,18%; funções 60,10%;
  branches 57,40%. Linhas por área: bibliotecas 87,79%; APIs 78,11%;
  componentes 30,86%. A cobertura de interface ainda é uma ressalva.
- Quatro falhas iniciais foram reproduzidas em testes e fontes já presentes na
  revisão publicada, antes desta auditoria. Foram corrigidas somente as
  expectativas: nomes A–Z antes de cargos, fixture normalizada pelo schema e
  linhas contíguas do XLSX sem separador artificial. Os asserts continuam
  conferindo dados, ordem, filtro, merges e conteúdo literal sem fórmulas.
- Revisão independente das correções de segurança, ZIP, histórico e deploy:
  nenhum bloqueio restante identificado. A leitura não substitui pentest.
- Navegador: 68 cenários aprovados e 5 ignorados por dependerem de dados
  opcionais. Inclui importação, geração e aplicação de propostas, cancelamento,
  downloads PDF/XLSX e os demais fluxos cobertos pela suíte. Seletores antigos
  foram alinhados ao assistente atual, sem remover asserts nem ampliar prazos.
- Compose validado com acesso aos arquivos protegidos. A liberação usa uma
  construção conjunta de app e worker. A confirmação do OCR, das conversões
  Office e da compactação real ocorre na imagem final; a saúde isolada dos
  serviços não é tratada como comprovação dessas funções.
- Na imagem publicada da primeira etapa, OCR real em português/inglês nas
  otimizações 2 e 3, reamostragem JBIG2 com geometria preservada e 30 testes
  reais de conversão Office foram aprovados. A consulta OSV de 39 versões
  efetivamente instaladas não acusou avisos, mas não identificava os vendors
  do pip; o scanner da imagem detectou essa lacuna, corrigida na etapa final.

## Evidências da atualização de runtime

- App e worker publicados em `2ef432e`, na mesma revisão. Ambos passaram
  no Trivy com zero vulnerabilidades altas ou críticas, incluindo os pacotes
  nativos; Expat 2.10.0-r0 e ausência do pip foram confirmados pelo build.
- Na imagem final, OCR nas otimizações 2/3 e quatro testes CLI reais de
  Office passaram novamente, sem repetir a suíte completa da aplicação.
- No navegador, dois PDFs sintéticos somavam 7.251.216 bytes. A compactação
  equilibrada, 150 DPI e tons de cinza gerou 544.642 bytes de PDFs em
  11,8 segundos; o ZIP tinha 479.890 bytes. Texto/OCR e páginas preservados,
  parâmetros aplicados conferidos nos metadados e exclusão do próprio job
  confirmada com HTTP 204. Isso não prevê o ganho em todo arquivo possível.
- O Solver também continha o pip com os mesmos vendors vulneráveis. Sua
  imagem passa a remover o instalador após os checks, atualizar os pacotes
  do Debian estável e exigir apt >= 3.0.4. As regras e o algoritmo não mudam.
- O scan inicial do Solver identificou 53 registros altos: cinco dos vendors
  pip, dois de apt/libapt com correção e 46 registros nativos correspondentes
  a dez CVEs únicos ainda abertos no Debian 13/trixie. O
  [tracker oficial do Debian](https://security-tracker.debian.org/tracker/data/json),
  atualizado em 05/11/2026, confirma ausência de versão corrigida para esses
  dez IDs no ramo estável. `no-dsa` não significa corrigido ou não afetado.
  Não foram criadas exceções no scanner, nem trocado o sistema operacional
  ou removidas bibliotecas essenciais para forçar um resultado zero.
- IDs pendentes do fornecedor: CVE-2026-76642, CVE-2026-78408,
  CVE-2026-78409, CVE-2026-78410, CVE-2026-54369, CVE-2025-69720,
  CVE-2026-119373, CVE-2026-16742, CVE-2026-9538 e CVE-2026-76844.
