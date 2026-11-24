# Operação segura: release, incidente e recuperação

**Objetivo:** procedimentos de conferência; comandos de produção dependem de autorização e do recibo de qualidade previsto em `AGENTS.md`.

## Antes de editar / integrar

1. Registrar `git rev-parse HEAD` e `git status --porcelain`; não descartar mudanças locais.
2. Conferir permissões, schemas, snapshots antigos e o que muda no resultado público.
3. Executar testes direcionados, CI do SHA final e revisão do diff. Um PR verde não certifica produção.
4. Confirmar checks obrigatórios em GitHub Rulesets: o simples indicador `protected=true` não basta.

## Antes de implantar

No checkout autorizado do servidor, conferir `AGENTS.md` e executar a qualidade integral **uma única vez**:

```sh
cd /home/ubuntu/PerfectUtilitares/web
npm run quality
```

O recibo local da qualidade vale 24 horas e é vinculado ao conteúdo exato. Comitar conteúdo idêntico e exigir checkout limpo antes de usar **um único** `npm run docker:deploy`, que já realiza build. Nunca repetir build cegamente ou reescrever histórico para contornar um gate.

Não copiar `.env`, dumps ou credenciais para a CI. Verificar volumes e schema antes de alterações de banco.

## Diagnóstico de Escalas

1. Registrar apenas SHA, filial/código autorizado, mês, modo, revisão, fase, status e métricas agregadas. Oculte matrículas, nomes e conteúdo privado.
2. Separar problema de regras, solver, timeout, importação, concorrência ou cobertura.
3. Verificar se há setores vazios em datas abertas e se a referência é `estimated` ou mínimo confirmado; uma estimativa não é obrigação operacional.
4. Conferir períodos domingo–sábado, folgas fixas expressas, feriados, histórico, vínculos parciais e turnos noturnos cruzando domingos.
5. Diante de proposta inválida, preservar a última revisão conferida. Não publicar ou aplicar resposta do solver sem verificador independente. `HOURS_ONLY` não gera folgas.
6. Referências só são válidas para o contexto e revisão em que foram geradas. No calendário de dezembro de 2026, as estimativas novas consideram três dias de trabalho na abertura de 1 a 5/12 (menos feriados aplicáveis para a equipe elegível). Para uma referência antiga, use **Recalcular apenas estimativas** na área Cobertura: revise os valores antes de salvar. O comando não altera mínimos cadastrados nem dias da grade.
7. Compare separadamente mínimos não atendidos, equipes inteiras de folga e desfalque estimado por faixa. Referência mantida e busca sem conclusão não equivalem a nova proposta nem provam inviabilidade. Em dezembro, a recuperação tenta primeiro as semanas com mais setores/dia vazios, sem relaxar as proteções ou ampliar os orçamentos de 12/23 s.

## Backups: verificação read-only

Conforme acesso autorizado ao servidor, consultar sem imprimir conteúdo confidencial:

```sh
systemctl list-timers --all | grep perfectutilitares-backup
systemctl status perfectutilitares-backup.timer perfectutilitares-backup-verify.timer
journalctl -u perfectutilitares-backup.service -u perfectutilitares-backup-verify.service -n 80 --no-pager
```

O script diário gera `pg_dump` custom, SHA256 e, se configurado, `rclone check`. O verificador trimestral restaura em banco de **verificação**. Não execute restauração em produção para testes; não ative remoto nem rotacione segredos sem política aprovada.

Registrar última execução válida, última restauração isolada, existência de cópia off-site e objetivos RPO/RTO definidos pelo proprietário. Caso desconhecidos, indicar **não verificado**, nunca "backup garantido".

## Incidente / rollback

- Interromper novas publicações **somente por procedimento operacional autorizado** e preservar logs sem PII.
- Registrar o SHA da aplicação e das imagens, revision do banco, resultado da última CI e último snapshot íntegro.
- Verificar a compatibilidade de dados novos com versão anterior. Reversão não pode usar leitor legado incapaz de interpretar schemas/calendários recentes.
- Validar login, permissões, geração, exportação, Unimed, PDF, presença e jobs após qualquer rollback autorizado.
