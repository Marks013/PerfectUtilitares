# Módulo Unimed — Plano de implementação

> Status em 31/07/2026: cronograma concluído e validado em produção, incluindo
> envio SMTP pelo Gmail. A senha de aplicativo existente na planilha foi
> reutilizada temporariamente com autorização; a futura rotação exige alterar
> somente `UNIMED_SMTP_PASSWORD`. O estado final auditado está em `PROGRESS.md`.

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
- [ ] Aprovar protótipo navegável.
- [ ] Conferir documentos, impressão e e-mail.
- [ ] Aprovar a liberação para criar a branch.

### Critério de sucesso

Golden master e protótipo aprovados pelo responsável pela planilha.

## Fase 1: Fundação do domínio e banco

### Objetivo

Criar limites do módulo, modelos Prisma e migrações incrementais.

### Tarefas

- [ ] Criar branch `feat/unimed`.
- [ ] Criar diretórios do domínio, componentes e rotas.
- [ ] Definir modelos e índices Prisma.
- [ ] Criar migração reversível.
- [ ] Criar schemas Zod e tipos comuns.
- [ ] Criar seed das configurações iniciais.

### Critério de sucesso

Prisma valida, migração aplica em banco descartável e testes atuais continuam
aprovados.

## Fase 2: Autorização e configurações

### Objetivo

Integrar o módulo ao núcleo com autorização server-side e configurações
versionadas.

### Tarefas

- [ ] Adicionar acesso ao módulo e ações por papel.
- [ ] Criar tela e APIs de configurações.
- [ ] Implementar competência, fechamento, preços, reajustes, motivos,
  filiais, destinatários e documentos.
- [ ] Validar vigências sem sobreposição.

### Critério de sucesso

Administrador, gestor e operador veem e executam somente ações permitidas.

## Fase 3: Importador transacional

### Objetivo

Substituir a geração manual dos bancos Access.

### Tarefas

- [ ] Definir contratos e aliases de CSV/XLSX.
- [ ] Validar tipo, tamanho, conteúdo, duplicidade e competência.
- [ ] Normalizar beneficiários, endereços, faturas e itens.
- [ ] Publicar atomicamente e manter ativa + anterior.
- [ ] Excluir arquivos transitórios em sucesso ou falha.
- [ ] Criar relatório de validação sem reter o arquivo original.

### Critério de sucesso

Arquivos mensais válidos geram a mesma base lógica da planilha; erro em
qualquer fonte não altera a base ativa.

## Fase 4: Pesquisa e motor de cálculo

### Objetivo

Reproduzir a aba `ATUAL` de forma determinística.

### Tarefas

- [ ] Pesquisa por CPF/cadastro.
- [ ] Titular e até seis dependentes.
- [ ] Classificação de aditivo.
- [ ] Faixa etária, preço, filial e vigência.
- [ ] Fatura, pró-rata, devolução e cobrança em folha.
- [ ] Fechamento não fechado e automático dia 25.
- [ ] Motivos e seleção de documento.
- [ ] Testes do golden master centavo a centavo.

### Critério de sucesso

Todos os casos aprovados coincidem com a planilha em valores intermediários e
finais.

## Fase 5: Documentos, impressão e e-mail

### Objetivo

Remover dependência operacional de Word e Excel.

### Tarefas

- [ ] Criar duas vias imprimíveis do cálculo.
- [ ] Implementar RN561.
- [ ] Implementar termo inativo.
- [ ] Tratar seis dependentes no cálculo e quatro campos no RN561.
- [ ] Enviar somente nome e CPF após confirmação.
- [ ] Apagar PDF e arquivos temporários após entrega.

### Critério de sucesso

Impressões conferidas visualmente e e-mail sem anexo idêntico ao fluxo atual.

## Fase 6: Robustez operacional e persistência

### Objetivo

Tornar a operação segura, limitada e previsível.

### Tarefas

- [ ] Usar bind mounts absolutos fora do repositório.
- [ ] Criar preflight de marcador, dono, permissão e espaço.
- [ ] Proibir volumes Docker permanentes.
- [ ] Implementar trava de importação e idempotência.
- [ ] Limitar upload, memória e concorrência.
- [ ] Remover órfãos transitórios com mais de 24 horas.
- [ ] Garantir logs sem PII e retenção já limitada pelo Compose.

### Critério de sucesso

Recriar contêineres e executar `docker compose down` não remove dados ou
configurações; montagem inválida impede a inicialização.

## Fase 7: Validação paralela e implantação

### Objetivo

Liberar produção sem interromper o processo atual.

### Tarefas

- [ ] Executar qualidade, build e testes de segurança.
- [ ] Comparar cálculos reais anonimizados com Excel.
- [ ] Fazer snapshot pré-migração.
- [ ] Aplicar migração e seed.
- [ ] Implantar com healthcheck e rollback documentado.
- [ ] Manter Excel como contingência durante a transição.

### Critério de sucesso

Aplicação saudável, cálculos aprovados, três usuários habilitados e rollback
testado sem perda de dados.

## Pós-implementação

- [ ] Atualizar documentação operacional.
- [ ] Revisar modularização e dependências.
- [ ] Verificar desempenho e concorrência.
- [ ] Registrar limitações conhecidas.
