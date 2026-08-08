# Módulo Unimed — Plano de implementação

> Status em 08/08/2026: cronograma concluído e revalidado em produção. O
> checklist abaixo é o registro retrospectivo da entrega, não uma lista de
> promessas pendentes. Credenciais SMTP são geridas fora do Git por variáveis
> protegidas; o estado final auditado está em `PROGRESS.md`.

## Visão geral

Implementação incremental do módulo Unimed no PerfectUtilitares, com proteção
da produção e validação paralela contra a planilha atual.

## Pré-requisitos

- Etapa 0 aprovada: protótipo, regras, golden master e permissões.
- Repositório limpo e branch criada a partir da `main`.
- Persistência e permissões dos bind mounts conferidas.
- Testes atuais do PerfectUtilitares aprovados antes da primeira alteração.

## Resumo das fases

1. Referência funcional e protótipo.
2. Fundação do domínio e banco.
3. Autorização e configurações.
4. Importador transacional.
5. Pesquisa e motor de cálculo.
6. Documentos, impressão e e-mail.
7. Robustez operacional e persistência.
8. Validação paralela e implantação.

## Fase 0: Referência funcional e protótipo

### Objetivo

Congelar o comportamento esperado antes de criar a branch.

### Tarefas

- [x] Registrar hash e inventário da versão atual.
- [x] Consolidar regras, módulos, fórmulas e gatilhos.
- [x] Montar o primeiro caso anonimizável e a matriz de resultados esperados.
- [x] Criar protótipo navegável.
- [x] Aprovar protótipo navegável.
- [x] Conferir documentos, impressão e e-mail.
- [x] Aprovar a liberação para criar a branch.

### Critério de sucesso

Golden master e protótipo aprovados pelo responsável pela planilha.

## Fase 1: Fundação do domínio e banco

### Objetivo

Criar limites do módulo, modelos Prisma e migrações incrementais.

### Tarefas

- [x] Criar branch `feat/unimed`.
- [x] Criar diretórios do domínio, componentes e rotas.
- [x] Definir modelos e índices Prisma.
- [x] Criar migração reversível.
- [x] Criar schemas Zod e tipos comuns.
- [x] Criar seed das configurações iniciais.

### Critério de sucesso

Prisma valida, migração aplica em banco descartável e testes atuais continuam
aprovados.

## Fase 2: Autorização e configurações

### Objetivo

Integrar o módulo ao núcleo com autorização server-side e configurações
versionadas.

### Tarefas

- [x] Adicionar acesso ao módulo e ações por papel.
- [x] Criar tela e APIs de configurações.
- [x] Implementar competência, fechamento, preços, reajustes, motivos,
  filiais, destinatários e documentos.
- [x] Validar vigências sem sobreposição.

### Critério de sucesso

Administrador, gestor e operador veem e executam somente ações permitidas.

## Fase 3: Importador transacional

### Objetivo

Substituir a geração manual dos bancos Access.

### Tarefas

- [x] Definir contratos e aliases de CSV/XLSX.
- [x] Validar tipo, tamanho, conteúdo, duplicidade e competência.
- [x] Normalizar beneficiários, endereços, faturas e itens.
- [x] Publicar atomicamente e manter ativa + anterior.
- [x] Excluir arquivos transitórios em sucesso ou falha.
- [x] Criar relatório de validação sem reter o arquivo original.

### Critério de sucesso

Arquivos mensais válidos geram a mesma base lógica da planilha; erro em
qualquer fonte não altera a base ativa.

## Fase 4: Pesquisa e motor de cálculo

### Objetivo

Reproduzir a aba `ATUAL` de forma determinística.

### Tarefas

- [x] Pesquisa por CPF/cadastro.
- [x] Titular e até seis dependentes.
- [x] Classificação de aditivo.
- [x] Faixa etária, preço, filial e vigência.
- [x] Fatura, pró-rata, devolução e cobrança em folha.
- [x] Fechamento não fechado e automático dia 25.
- [x] Motivos e seleção de documento.
- [x] Testes do golden master centavo a centavo.

### Critério de sucesso

Todos os casos aprovados coincidem com a planilha em valores intermediários e
finais.

## Fase 5: Documentos, impressão e e-mail

### Objetivo

Remover dependência operacional de Word e Excel.

### Tarefas

- [x] Criar duas vias imprimíveis do cálculo.
- [x] Implementar RN561.
- [x] Implementar termo inativo.
- [x] Tratar seis dependentes no cálculo e quatro campos no RN561.
- [x] Enviar somente nome e CPF após confirmação.
- [x] Apagar PDF e arquivos temporários após entrega.

### Critério de sucesso

Impressões conferidas visualmente e e-mail sem anexo idêntico ao fluxo atual.

## Fase 6: Robustez operacional e persistência

### Objetivo

Tornar a operação segura, limitada e previsível.

### Tarefas

- [x] Usar bind mounts absolutos fora do repositório.
- [x] Criar preflight de marcador, dono, permissão e espaço.
- [x] Proibir volumes Docker permanentes.
- [x] Implementar trava de importação e idempotência.
- [x] Limitar upload, memória e concorrência.
- [x] Remover órfãos transitórios com mais de 24 horas.
- [x] Garantir logs sem PII e retenção já limitada pelo Compose.

### Critério de sucesso

Recriar contêineres e executar `docker compose down` não remove dados ou
configurações; montagem inválida impede a inicialização.

## Fase 7: Validação paralela e implantação

### Objetivo

Liberar produção sem interromper o processo atual.

### Tarefas

- [x] Executar qualidade, build e testes de segurança.
- [x] Comparar cálculos reais anonimizados com Excel.
- [x] Fazer snapshot pré-migração.
- [x] Aplicar migração e seed.
- [x] Implantar com healthcheck e rollback documentado.
- [x] Manter Excel como contingência durante a transição.

### Critério de sucesso

Aplicação saudável, cálculos aprovados, três usuários habilitados e rollback
testado sem perda de dados.

## Pós-implementação

- [x] Atualizar documentação operacional.
- [x] Revisar modularização e dependências.
- [x] Verificar desempenho e concorrência.
- [x] Registrar limitações conhecidas.
