# Deploy com Nginx Proxy Manager

Este projeto publica o container internamente na porta `3000`, mas no host usa `APP_PORT`.
O padrao e `3002` para evitar conflito com outros projetos em `3000` e `3001`.

## `.env`

Para usar um dominio real no Nginx Proxy Manager:

```env
APP_PORT="3002"
AUTH_URL="https://seudominio.com.br"
APP_URL="https://seudominio.com.br"
AUTH_TRUST_HOST="true"
```

Se quiser outra porta local, ajuste apenas:

```env
APP_PORT="3003"
```

## Nginx Proxy Manager

Crie um Proxy Host apontando para:

- Forward Hostname/IP: IP do servidor ou nome do servico Docker acessivel pelo NPM
- Forward Port: valor de `APP_PORT`, por padrao `3002`
- Scheme: `http`
- Websockets Support: ativo
- SSL: emitir certificado Let's Encrypt para o dominio

O container continua usando `PORT=3000` internamente; nao altere isso no Compose.
