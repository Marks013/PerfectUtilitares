# Matriz de alterações V4

| Requisito | Implementação | Validação |
|---|---|---|
| Proporcional e mensalidade seguinte com tabelas diferentes | API resolve configuração na data de exclusão e novamente no primeiro dia do mês seguinte | Testes do motor e da rota de cálculo |
| Exemplo 6 dias + 30 dias | `totalRefundDays` soma dias proporcionais e dias da competência seguinte | Teste com desligamento em 25/08/2026 |
| Tabela antiga até 31/07/2026 | Seed corrigido e migração SQL baseada na próxima vigência | `price-history.test.ts` |
| Reajustes futuros | Salvamento histórico já fecha a versão anterior; migração elimina lacunas existentes | Regra sem datas fixas no motor |
| Dependente sem titular na fatura atual | Reconciliação por matrícula atual e vínculo único da competência anterior | `reconcile.test.ts` |
| Manter somente duas competências | Publicação consulta somente a imediatamente anterior e retenção existente continua ativa | Testes de conciliação e fluxo de publicação |
| Mostrar todos os dependentes | Remove `truncate` e renderiza lista completa | Verificação visual e TypeScript |
| PDF menos confuso | Dois resultados principais destacados e memória compacta | `unimed-print-summary.test.tsx` |
| Referência do PDF | Usa competência efetiva do cálculo em `MM/AAAA` | Teste do resumo de impressão |
| SMTP Gmail | Nodemailer, TLS, porta 465 e senha de aplicativo por ambiente | Testes de HTML e classificação de erros |
| Segredos fora do código | `SMTP_PASSWORD` somente em `web/.env` | Script de configuração com entrada oculta |
| Docker Compose | Variáveis SMTP no serviço `app` e migração via serviço `migrate` | `docker compose config --quiet` e build opcional |
| Sem atualização de ferramentas | Node, npm e Prisma permanecem nas versões atuais | `package.json` altera somente a dependência Nodemailer |
