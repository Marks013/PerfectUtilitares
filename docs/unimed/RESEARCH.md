# Módulo Unimed — Pesquisa técnica

## Visão geral

O módulo Unimed substituirá a planilha `CALCULO UNIMED.xlsm` no
PerfectUtilitares. Ele deverá importar as bases mensais CSV/XLSX, localizar
titulares e dependentes, reproduzir o cálculo atual centavo a centavo, imprimir
duas vias do cálculo, gerar os documentos RN561 ou termo inativo e enviar por
e-mail somente nome e CPF.

## Problema

O processo atual depende de versões compatíveis de Excel, Access e Word, de
atualização manual de três bases e de macros VBA. Três pessoas usam o processo
em computadores diferentes. O objetivo é centralizar dados e regras, reduzir
manutenção manual e manter uma única base corrente.

## Casos de uso

- Administrador configura competência, fechamento, preços, reajustes,
  filiais, motivos, destinatários e modelos.
- Administrador importa os arquivos mensais e publica a nova competência
  somente depois que todas as validações passam.
- Operador pesquisa um colaborador por CPF/cadastro, confere titular,
  dependentes, endereço e itens de fatura e executa o cálculo.
- Operador imprime duas vias da área equivalente à aba `ATUAL`.
- Operador gera RN561 para os motivos 1 e 2, termo inativo para o motivo 8 e
  nenhum termo automático para os motivos 3 a 7.
- Operador confirma o envio e o sistema envia apenas nome e CPF aos
  destinatários configurados.

## Abordagem técnica

### Opções avaliadas

1. Aplicação independente: aumenta isolamento, mas duplica login, banco,
   componentes, proxy, deploy e manutenção.
2. Módulo isolado no PerfectUtilitares: reutiliza autenticação, permissões,
   PostgreSQL, Prisma, importadores, e-mail, PDF, testes e operação.

### Decisão

Construir um monólito modular em `web/src/lib/unimed`,
`web/src/components/unimed`, `web/src/app/(app)/unimed` e
`web/src/app/api/unimed`. O módulo não importará regras de Jornada, Fotos ou
PDF e compartilhará somente serviços de plataforma.

### Tecnologias

- Next.js, React e TypeScript existentes.
- Prisma e PostgreSQL existentes.
- Zod nas fronteiras de API e importação.
- `csv-parse` e `read-excel-file` já instalados.
- HTML/CSS de impressão e serviço PDF existente.
- Resend existente para e-mail.
- Vitest para regras, importadores e APIs.

## Dados

- competência e lotes de importação;
- filiais e empresas;
- titulares, dependentes e endereços;
- faturas e itens;
- faixas etárias e preços versionados por vigência;
- configurações de fechamento;
- motivos de exclusão;
- configurações de documentos e e-mail.

Valores financeiros serão `Decimal`, nunca `Float`. A publicação de uma carga
será transacional, idempotente e substituirá a base corrente somente após
validação completa. Serão mantidas apenas as competências ativa e anterior.
Arquivos originais e PDFs serão transitórios.

## Interface

O módulo terá navegação própria:

1. Visão geral;
2. Cálculo;
3. Importações;
4. Beneficiários;
5. Configurações.

A tela de cálculo preservará a ordem mental da aba `ATUAL`: colaborador,
motivo/data/fechamento, beneficiários, resumo financeiro e ações. A impressão
reproduzirá visualmente a área `A1:O17`, sujeita à conferência com o nome legado
`A1:N17`.

## Integrações

- `User`, `Tenant`, sessão e papéis do núcleo;
- menu e autorização por módulo;
- Prisma e PostgreSQL;
- Resend;
- serviço de geração de PDF;
- bind mounts do host;
- Docker Compose e proxy já existentes.

## Riscos

- diferenças de arredondamento: golden master centavo a centavo;
- cabeçalhos variáveis nos arquivos: aliases explícitos e erros por linha;
- publicação parcial: staging transacional e ponteiro de competência ativa;
- concorrência: chave de idempotência e bloqueio de publicação;
- dados pessoais: autorização server-side, mascaramento e ausência de PII em
  logs;
- perda de dados por Docker: somente bind mounts absolutos com preflight.

## Questões de validação da Etapa 0

- aprovação visual do protótipo;
- confirmação da área de impressão;
- aprovação dos casos anonimizados;
- confirmação de como limitar seis dependentes a quatro campos no RN561;
- confirmação dos aliases encontrados nos arquivos mensais;
- definição inicial dos três usuários e seus papéis;
- decisão futura entre rota `/unimed` e subdomínio, sem bloquear o código.

## Referências internas

- `PLANO_EXECUCAO_APP_UNIMED.md`;
- `RELATORIO_TECNICO_CALCULO_UNIMED.md`;
- `CALCULO UNIMED 01-08-2026.xlsm`;
- modelos RN561 e termo inativo;
- código e infraestrutura atuais do PerfectUtilitares.
