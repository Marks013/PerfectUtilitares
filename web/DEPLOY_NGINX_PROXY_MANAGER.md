# Deploy com Nginx Proxy Manager

Este projeto publica o container internamente na porta `3000`. No host, a
porta definida por `APP_PORT` fica vinculada somente a `127.0.0.1` por
seguranca. O padrao e `3002` para evitar conflito com outros projetos em
`3000` e `3001`.

## `.env`

Para usar um dominio real no Nginx Proxy Manager:

```env
APP_PORT="3002"
APP_BIND_ADDRESS="127.0.0.1"
AUTH_URL="https://seudominio.com.br"
APP_URL="https://seudominio.com.br"
AUTH_TRUST_HOST="true"
```

Se quiser outra porta local, ajuste apenas:

```env
APP_PORT="3003"
```

## Nginx Proxy Manager

Se o Nginx Proxy Manager estiver instalado diretamente no mesmo servidor,
crie um Proxy Host apontando para:

- Forward Hostname/IP: `127.0.0.1`
- Forward Port: valor de `APP_PORT`, por padrao `3002`
- Scheme: `http`
- Websockets Support: ativo
- SSL: emitir certificado Let's Encrypt para o dominio

O container continua usando `PORT=3000` internamente; nao altere isso no Compose.
Nao publique `APP_BIND_ADDRESS=0.0.0.0` na internet: o limite de uso por IP
pressupoe que somente o proxy reverso consiga acessar o app.

## Nginx Proxy Manager em Docker

Se o Nginx Proxy Manager tambem estiver em Docker, suba o projeto com a rede de proxy:

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
```

No Proxy Host, aponte para:

- Forward Hostname/IP: `perfectutilitares`
- Forward Port: `3000`
- Scheme: `http`

O arquivo `docker-compose.proxy.yml` conecta apenas o app na rede externa do NPM. O banco permanece privado na rede interna do projeto.

## Dados persistentes do banco

O PostgreSQL usa uma pasta do servidor por padrao:

```env
POSTGRES_DATA_DIR="../storage/postgres"
```

Como o compose roda dentro de `web`, essa pasta fica em `/home/ubuntu/PerfectUtilitares/storage/postgres`. Assim, remover containers com `docker rm` nao apaga o banco.
