# Observabilidade

Cada requisição dinâmica recebe `x-request-id`; erros do servidor são gravados em
JSON nos logs Docker rotacionados. O log local contém somente horário, rota-modelo,
identificador técnico e classe do erro: mensagens, parâmetros, CPF, nome, cookies,
IP e corpo não são armazenados.

Sentry é opcional. Para ativá-lo, defina um `NEXT_PUBLIC_SENTRY_DSN` HTTPS e taxas
entre `0` e `1`. `SENTRY_ORG`, `SENTRY_PROJECT` e `SENTRY_AUTH_TOKEN` servem apenas
para upload de artefatos no build; o token nunca deve entrar na imagem ou no
navegador. Eventos removem usuário, IP, cookies, autorização, URL, query, corpo,
breadcrumbs e dados extras antes do envio. Replay mascara texto/inputs e bloqueia
mídia.

Valide antes do deploy:

```sh
sudo /usr/local/sbin/validate-perfectutilitares-observability \
  /home/ubuntu/PerfectUtilitares/web/.env
```

Com DSN vazio, nenhuma credencial externa é necessária e os logs locais continuam
ativos. O projeto remove `X-Powered-By`; cabeçalhos adicionados pelo proxy reverso
devem ser ocultados na própria configuração do proxy.
