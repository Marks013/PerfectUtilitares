# Confiabilidade de recuperação de acesso, PDF e XLSX

Data: 7 de novembro de 2026. Alterações independentes da etapa de Escalas já entregue.

## Recuperação e autenticação

- Ausência ou configuração inválida do provedor retorna indisponibilidade antes de consultar a conta ou criar convites. A interface não afirma que uma mensagem foi enviada.
- Contas conhecidas e desconhecidas seguem consulta e enfileiramento equivalentes; o tempo do provedor não participa da resposta HTTP. Isso reduz o canal de enumeração, mas não significa tempo matematicamente constante de banco ou rede.
- O login executa bcrypt também para conta ausente/inativa. Limites por IP e conta têm janelas finitas; os limites de recuperação são separados e não bloqueiam o login.
- O envio reutiliza o pg-boss e o processo existente, com concorrência própria de um pedido. Não há biblioteca, serviço ou migração novos.
- A fila não contém e-mail, senha nem token de recuperação em claro. O token HMAC usa chave exclusiva; o banco mantém somente o hash do token. Prazo e identidade não são renovados em retries.
- Respostas ambíguas do provedor preservam o mesmo token e a chave de idempotência. Rejeição definitiva não é repetida. O envio possui prazo real de 20 segundos e não registra resposta bruta, destinatário ou link.
- O consumidor é registrado antes da prontidão e usa o encerramento gracioso da fila compartilhada. Os parâmetros da fila de PDF foram preservados.

Referências: [OWASP — recuperação de senha](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [Resend — idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys).

### Chave exclusiva do consumidor

O Compose monta somente no worker o arquivo `/home/ubuntu/perfectutilitares-config/recovery/delivery.secret`, como `/run/secrets/password_recovery_secret`. A chave de sessões `AUTH_SECRET` não foi adicionada ao worker. O arquivo contém 32 bytes aleatórios em base64url canônico, com proprietário 1001:1001 e permissão 0400, dentro de diretório protegido. Nenhum valor faz parte do repositório ou relatório.

Para instalar em outro servidor, criar uma chave exclusiva antes do deploy, sem imprimir seu valor. Exemplo idempotente que não sobrescreve arquivo existente:

```sh
sudo /usr/bin/node --input-type=module <<'NODE'
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
const directory = '/home/ubuntu/perfectutilitares-config/recovery';
try { fs.mkdirSync(directory, { mode: 0o700 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const metadata = fs.lstatSync(directory);
if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Unsafe secret directory');
const file = directory + '/delivery.secret';
try {
  fs.writeFileSync(file, randomBytes(32).toString('base64url') + '\n', { flag: 'wx', mode: 0o400 });
  fs.chownSync(file, 1001, 1001);
} catch (error) { if (error.code !== 'EEXIST') throw error; }
NODE
```

Preservar a chave durante a validade dos pedidos. Rotação exige encerrar/descartar pedidos antigos de forma explícita; não recriar tokens de pedidos já usados. Recuperar esse arquivo somente por procedimento protegido. A produção continua sem `RESEND_API_KEY`; portanto, a recuperação por e-mail permanece honestamente indisponível até configuração real pelo responsável. Não foram enviados e-mails nem alteradas senhas como teste.

## PDF

A espera por capacidade de compactação agora é cancelável. A vaga é transferida diretamente em ordem FIFO, sem ultrapassagem nem liberação duplicada. Uma verificação adicional impede iniciar o trabalho quando o cancelamento ocorre entre aquisição e execução.

Erros de entrada, limites, incompatibilidade de revisão e validações de integridade são terminais. Timeouts, falta transitória de recursos e falhas desconhecidas continuam elegíveis para retry. Falta de ferramenta de Office é identificada somente por ENOENT; EAGAIN/EMFILE não são classificados como instalação ausente.

## XLSX Unimed

A leitura da planilha saiu da thread principal, preservando o contrato da primeira aba e os parsers existentes. A rotina compartilha com Férias dois slots globais PostgreSQL. O worker recebe apenas os bytes, sem ambiente de credenciais, com heap de 128+32 MiB, prazo de 30 segundos e saída expandida máxima de 32 MiB. Permanecem os limites de upload de 10 MiB, 100 mil linhas e as verificações estruturais do ZIP.

A expansão em memória não é o tamanho compactado do upload. Arquivos que ultrapassarem o orçamento recebem orientação para retirar conteúdo não utilizado; não se recomenda publicar partes separadas de uma base integral. O término do worker é aguardado antes da liberação da vaga. Nenhuma publicação parcial é feita quando o processamento falha.

Falhas distinguem arquivo inválido (400), orçamento de memória/tamanho (413), infraestrutura/capacidade (503), prazo excedido (504) e cancelamento (499). O worker foi integrado ao build, tracing, imagem e análise de código não utilizado.

## Verificação e limites do escopo

Regressões focadas cobrem cancelamento/retry de PDF, leitura de XLSX real, capacidade/timeout/memória e fluxo funcional das duas rotas modificadas. O harness existente foi adaptado à nova chave e ao bundle XLSX, sem executar uma implantação isolada. A consulta npm audit desta etapa retornou zero vulnerabilidades. A verificação final de qualidade, build, imagens e smokes da versão implantada fica registrada no relatório de entrega.

Nenhuma migração, seed, redefinição de senha, importação/publicação real de Unimed, limpeza de cache compartilhado ou alteração em Sentry foi realizada nesta etapa.
