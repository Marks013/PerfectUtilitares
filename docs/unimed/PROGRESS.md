# Módulo Unimed — Progresso e retomada

## Estado em 31/07/2026

Branch local: `feat/unimed`  
Base de produção incorporada: commit `9abca9f` da `main`  
Produção: implantada em `https://perfectutilitares.duckdns.org/unimed`  
Última validação: 246 testes aprovados, 1 teste opcional ignorado, TypeScript,
Prisma, Knip, build e smoke autenticado de produção aprovados.

## Fases

| Fase | Estado |
|---|---|
| 0. Referência funcional e protótipo | Concluída; ampliar golden master |
| 1. Fundação do domínio e banco | Concluída |
| 2. Autorização e configurações | Concluída |
| 3. Importador transacional | Concluída; divergências reais classificadas e documentadas |
| 4. Pesquisa e motor de cálculo | Motor, API, busca e autopreenchimento concluídos |
| 5. Documentos, impressão e e-mail | DOCX em memória, duas vias e e-mail concluídos |
| 6. Robustez e persistência | Concluída para esta etapa |
| 7. Implantação | Concluída diretamente em produção por decisão do responsável |

## Entregue

- domínio Prisma separado para competências, importações, filiais,
  beneficiários, endereços, faturas, preços, faixas, regras, e-mail e modelos;
- migração validada do zero em PostgreSQL 17 com todas as oito migrações;
- dinheiro em `Decimal(14,2)` e cálculo `ROUND_HALF_UP`, inclusive o caso
  crítico `10,075 → 10,08`;
- percentuais separados com quatro casas;
- permissões `OPERATOR`, `MANAGER` e `ADMIN`, com defesa nas rotas, serviços e
  páginas;
- gatilhos PostgreSQL contra vínculos entre empresas e constraints contra
  sobreposição de vigências;
- importação automática de múltiplos CSVs e um XLSX, processados somente em
  memória;
- checksum, idempotência derivada do conteúdo, transação serializável e
  `advisory lock`;
- retenção de somente uma competência ativa e uma anterior;
- filiais ausentes desativadas e configurações vencidas removidas de forma
  controlada;
- validação de dígitos de CPF/CNPJ e matrícula usada somente quando for única;
- pesquisa de beneficiário limitada à empresa e competência ativa;
- APIs de cálculo, importação, configuração, pesquisa e e-mail;
- pesquisa por nome, CPF ou matrícula ligada ao formulário, com preços
  resolvidos somente por plano, faixa etária e data de referência exatos;
- envio real de nome e CPF após confirmação explícita;
- geração em memória dos modelos RN561 e termo inativo, com integridade SHA-256,
  remoção do vínculo de mala direta e resposta `private, no-store`;
- impressão HTML/CSS de duas vias em uma folha A4, sem gerar ou persistir PDF;
- tela de cálculo responsiva;
- tela de importação com progresso real, confirmação, limites, resumo e
  descarte das referências aos arquivos;
- tela de configurações com vigência, fechamento aberto/dia 25, percentuais,
  faixas, preços empresa/colaborador, adicionais e e-mail;
- navegação interna entre Cálculo, Importar bases e Configurações;
- resposta de configuração e pesquisa sem IDs ou metadados internos
  desnecessários;
- bind mounts fora de volumes Docker:
  `/home/ubuntu/perfectutilitares-data` e
  `/home/ubuntu/perfectutilitares-config`;
- logs Docker rotacionados, sem retenção de originais importados ou PDFs do
  módulo;
- script `web/scripts/prepare-host-storage.sh` validado por `sh -n`;
- servidor conferido somente em leitura: produção limpa, serviços saudáveis e
  cerca de 100 GB livres.

## Dados reais já verificados

- 562 beneficiários;
- 910 itens válidos de fatura;
- 776 endereços válidos;
- 389 linhas de totalização e 23 linhas vazias ignoradas;
- avisos observados: 16 itens de fatura pertencentes a 13 pessoas ausentes da
  base atual, 1 dependente sem vínculo determinístico e 499 endereços sem
  conciliação direta;
- `planCode`: 560 beneficiários com código único persistido, 1 código ambíguo
  mantido nulo e 1 beneficiário sem item conciliado mantido nulo.

Os endereços não conciliados são esperados porque a base de endereços é mais
ampla. As demais divergências não possuem associação segura nos arquivos atuais;
por isso permanecem como avisos, nunca são vinculadas por aproximação e não
impedem a publicação das linhas determinísticas. Detalhes em
`docs/unimed/RECONCILIATION.md`.

## Estado final

Cronograma técnico concluído. Produção contém a competência 07/2026 publicada,
configurações de preço fornecidas, documentos validados, remetente configurado,
destinatários editáveis, simulações autenticadas e envio SMTP ativo. A senha de
aplicativo existente no VBA foi reutilizada temporariamente por solicitação do
responsável. Na rotação, somente `UNIMED_SMTP_PASSWORD` precisa ser alterada no
`.env` do servidor, seguida da recriação do serviço `app`.

## Verificações executadas

- `npm run quality` sobre a base atual da produção: Prisma válido, TypeScript
  válido e 248 testes aprovados,
  com 1 teste opcional dos modelos reais ignorado quando a variável de ambiente
  não está configurada;
- teste separado com `UNIMED_REAL_TEMPLATE_DIR`: os 7 testes de documentos,
  inclusive os dois modelos DOCX reais, foram aprovados sem gravar artefatos;
- `npm run quality:dead-code`: aprovado;
- `npm run build`: aprovado, incluindo `/unimed`,
  `/unimed/importar` e `/unimed/configuracoes`;
- migrações: onze aplicadas e sincronizadas no PostgreSQL 17 de produção;
- `docker compose --env-file .env.production.example config --quiet`:
  configuração válida;
- `sh -n web/scripts/prepare-host-storage.sh`: sintaxe válida.
- Docker: `app`, `db` e `pdf-worker` saudáveis; modelos DOCX montados somente
  leitura e hashes conferidos dentro do contêiner;
- smoke autenticado: login, `/unimed`, configuração, pesquisa e cálculo
  retornaram HTTP 200;
- backup recuperável anterior ao deploy em arquivos fixos `latest`, sem
  crescimento infinito.

## Cuidados para continuar

- não salvar banco, modelos ou configurações importantes em volume nomeado do
  Docker;
- não persistir arquivos importados, PDFs ou dados temporários;
- manter todos os valores financeiros com duas casas;
- não inventar preços, destinatários ou regras ausentes;
- preservar as alterações locais ainda não commitadas na branch `feat/unimed`.

## Atualização final de 31/07/2026

- Corrigida a importação para distinguir arquivos de beneficiários, fatura e
  endereços, com mensagens específicas e sem mascarar falhas de infraestrutura.
- Motivos 1, 2 e 8 exigem e geram o DOCX correspondente; o e-mail permanece
  independente e nunca leva esse documento como anexo.
- Assunto fixo `Solicitação de Coparticipação`, com sequência diária automática
  para evitar agrupamento no Gmail; corpo, Calibri, destaques e assinatura
  reproduzem a macro atual. Destinatários permanecem editáveis.
- Histórico de configuração não é mais excluído durante atualizações.
- Vigência 01/07/2024 a 31/07/2025 cadastrada com as dez faixas fornecidas,
  titular R$ 54,21 e funeral R$ 5,42.
- Vigência 01/08/2026 a 31/07/2027 cadastrada com as dez faixas fornecidas,
  titular R$ 61,26, funeral R$ 6,12 e reajuste anual de 13%.
- Migração `20260731190000_unimed_email_daily_sequence` aplicada.
- Produção validada com login real, configuração HTTP 200, cálculo de referência
  idêntico ao golden master da planilha, entradas inválidas HTTP 400, clique de
  e-mail sem confirmação HTTP 400, importação incompleta HTTP 400 sem criar lote,
  hashes dos dois modelos e tabelas de preço conferidos.
- `app`, `db` e `pdf-worker` saudáveis, sem erros recentes. Backups fixos `latest`
  de fonte e PostgreSQL foram atualizados antes da implantação.
- Primeira importação real de 07/2026 concluída: 562 beneficiários, 910 itens de
  coparticipação, 384 endereços vinculados, 9 lojas e 364 matrículas pesquisáveis.
- Repetição do mesmo conjunto confirmou idempotência, sem duplicar lote ou dados.
- CPF é a correlação prioritária. O banco de endereços apenas complementa
  endereço e matrícula de pesquisa; nunca define plano, preço ou cálculo.
- Os 499 registros existentes somente no banco de endereços são informativos e
  representam pessoas sem plano Unimed nas bases atuais.
- Códigos reais de plano `1013` e `10041` vinculados às duas tabelas de preço.
- Corrigido bloqueio transacional Prisma `P2010` convertendo o retorno PostgreSQL
  `void` para texto, tanto na importação quanto nas configurações.
- Geração ponta a ponta em produção aprovada para motivos 1, 2 e 8; documentos
  temporários removidos imediatamente.
- Simulação com beneficiário real aprovou pesquisa por matrícula, resolução de
  preço e cálculo centavo a centavo para a vigência de 01/08/2026.
- Gmail SMTP validado no servidor por autenticação TLS e envio controlado, sem
  dados pessoais, para a própria conta remetente; servidor aceitou a mensagem.
- Container de produção recriado e saudável, com configuração SMTP presente e
  autenticação e envio controlado novamente validados dentro da imagem executada.
- Cobertura adicionada para transporte SMTP, corpo sem anexo e rejeição parcial
  de destinatários. `nodemailer` foi incluído explicitamente na imagem standalone.
