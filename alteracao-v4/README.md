# PerfectUtilitares — Correções V4

Pacote preparado sobre o `main` no commit `4eedbe7`.

## O que esta versão corrige

1. **Preços por vigência e por competência**
   - o proporcional da competência do desligamento usa a tabela vigente nessa competência;
   - após o fechamento do dia 25, a mensalidade integral seguinte usa a tabela vigente no mês seguinte;
   - um desligamento em `25/08/2026`, por exemplo, pode usar a tabela de agosto nos 6 dias proporcionais e outra tabela na mensalidade de setembro;
   - o resultado informa o total de dias, como `6 + 30 = 36`.

2. **Histórico sem lacunas**
   - a migração fecha cada versão na véspera da próxima;
   - a tabela iniciada em `01/08/2026` faz a anterior terminar em `31/07/2026`;
   - futuros reajustes, como `01/08/2027`, passam a encerrar automaticamente a vigência anterior em `31/07/2027`.

3. **Dependentes entre duas competências**
   - tenta o vínculo informado na fatura atual;
   - tenta matrícula/filial na importação atual;
   - quando ainda não houver titular, reaproveita com segurança o vínculo único da competência anterior por CPF, matrícula ou nome/filial.

4. **Pesquisa de beneficiários**
   - mostra visualmente todos os dependentes retornados, um por linha;
   - remove apenas o truncamento visual, sem alterar a seleção usada no cálculo.

5. **Tela e PDF simplificados**
   - destaca `Estorno ao funcionário` e `Estorno à empresa`;
   - deixa proporcional, mensalidade seguinte e total de dias em uma memória de cálculo compacta;
   - usa a competência efetiva do cálculo na coluna `Referência`.

6. **E-mail SMTP Gmail**
   - substitui o envio pelo Resend por SMTP autenticado;
   - padrão: `smtp.gmail.com`, porta `465`, TLS e senha de aplicativo;
   - remetente, senha e assinatura ficam no `web/.env`, nunca no código;
   - mantém idempotência e auditoria de envio.

O pacote **não atualiza Node.js, npm ou Prisma**. Ele adiciona somente a dependência de aplicação `nodemailer@8.0.11`.

## Segurança antes de começar

A senha de aplicativo que apareceu na conversa deve ser considerada comprometida. Revogue-a no Google e gere uma nova. Não reutilize a senha publicada.

Faça backup do banco antes de executar a migração. Não use `docker compose down -v`.

## 1. Criar uma branch

```bash
cd /home/ubuntu/PerfectUtilitares
git switch main
git pull --ff-only origin main
git switch -c fix/unimed-v4-historico-smtp
```

## 2. Copiar o pacote

Extraia este ZIP, por exemplo, em:

```text
/home/ubuntu/PerfectUtilitares/alteracao-v4
```

## 3. Conferir e aplicar

```bash
cd /home/ubuntu/PerfectUtilitares

python3 alteracao-v4/aplicar_correcoes.py . --self-test
python3 alteracao-v4/aplicar_correcoes.py . --check
python3 alteracao-v4/aplicar_correcoes.py . --apply
```

O `--apply` é idempotente. Uma segunda execução deve informar zero alterações.

## 4. Configurar o Gmail com entrada oculta

Use uma **nova** senha de aplicativo:

```bash
python3 alteracao-v4/configurar_smtp.py . \
  --email dp@mercadoplanalto.com.br
```

O script:

- solicita a senha sem mostrá-la no terminal;
- grava em `/home/ubuntu/PerfectUtilitares/web/.env`;
- cria backup do `.env`;
- configura porta 465, TLS, remetente e assinatura.

Valide o Compose:

```bash
cd /home/ubuntu/PerfectUtilitares/web
docker compose config --quiet
```

Também confirme, na configuração do módulo Unimed, que o envio está habilitado e que os destinatários estão cadastrados. O SMTP define o remetente; os destinatários continuam vindo da configuração do sistema.

## 5. Validar o código

```bash
cd /home/ubuntu/PerfectUtilitares
bash alteracao-v4/validar_correcoes.sh .
```

Caso `nodemailer` ainda não exista em `node_modules`, o validador instala somente essa dependência local, sem atualizar npm e sem alterar o `package-lock.json`.

Para validar também as imagens Docker, opcionalmente:

```bash
DOCKER_BUILD=1 bash alteracao-v4/validar_correcoes.sh .
```

## 6. Implantar via Docker Compose

A V4 contém uma migração Prisma, portanto use o Compose completo para que o serviço `migrate` seja executado:

```bash
cd /home/ubuntu/PerfectUtilitares/web

docker compose up -d --build

docker compose ps
docker compose logs --tail=200 migrate app pdf-worker
```

O volume do PostgreSQL é preservado. Não acrescente `-v` e não exclua o diretório de dados.

## 7. Testes manuais essenciais

### Histórico

- `31/07/2026`: tabela anterior;
- `01/08/2026`: tabela nova;
- cálculo retroativo de julho após existir tabela de agosto: continua usando julho.

### Duas tabelas no mesmo cálculo

Para desligamento em `25/08/2026`:

- proporcional: 6 dias de `08/2026` pela tabela vigente em agosto;
- mensalidade seguinte: 30 dias de `09/2026` pela tabela vigente em setembro;
- total visual: 36 dias.

### Dependentes

Após implantar a V4, **importe e publique novamente a competência mais recente** para que os vínculos antigos sejam recalculados com a nova conciliação.

- titular presente na competência atual;
- dependente novo sem referência de titular na fatura;
- vínculo encontrado na competência anterior;
- todos os dependentes visíveis na pesquisa.

### E-mail

- envio com senha de aplicativo válida;
- erro explicativo com senha inválida;
- assinatura renderizada;
- evento não duplicado ao repetir a mesma solicitação.

## 8. Registrar no Git

```bash
cd /home/ubuntu/PerfectUtilitares

git status --short
git diff --check
git add web
git commit -m "fix(unimed): aplica histórico por competência, conciliação e SMTP"
git push -u origin fix/unimed-v4-historico-smtp
```

## Observações

- A migração corrige períodos existentes calculando a véspera da próxima vigência. Ela não inventa preços.
- Se não existir tabela para uma competência necessária, o sistema interrompe com mensagem específica em vez de reutilizar silenciosamente uma tabela incorreta.
- A mensalidade seguinte só é incluída quando o fechamento automático do dia 25 estiver vigente e a data de exclusão for dia 25 ou posterior.
