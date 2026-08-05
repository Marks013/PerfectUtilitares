# Backup, restauração e hardening

## Contêineres

As imagens-base estão fixadas por digest. Atualize o digest somente após revisar a
imagem oficial, reconstruir e validar o ambiente. Os serviços usam filesystem raiz
somente leitura, capacidades removidas, `no-new-privileges`, `tmpfs` limitados e
logs Docker rotacionados. Dados persistentes continuam em diretórios do host.

O healthcheck da aplicação valida uma consulta `SELECT 1` e a resposta HTTP. O
worker valida heartbeat, banco e a presença de Node, LibreOffice, qpdf e Poppler.

## Backups

O timer diário mantém, por padrão, os 14 backups mais recentes em
`/home/ubuntu/perfectutilitares-backups`. Cada backup contém dump PostgreSQL em
formato custom, configurações, modelos Unimed e checksums. PDFs temporários não
são copiados.

Edite `/etc/perfectutilitares-backup.conf` para mudar retenção. Para uma segunda
cópia, configure um remote do rclone fora do repositório e preencha apenas
`BACKUP_RCLONE_REMOTE`; nenhuma credencial deve ser gravada no projeto.

Verificação manual:

```sh
sudo /usr/local/sbin/perfectutilitares-backup-verify latest
```

Restauração exige confirmação explícita e mantém app/worker parados caso o banco
falhe. Para restaurar também configurações e modelos:

```sh
sudo /usr/local/sbin/perfectutilitares-restore --confirm \
  /home/ubuntu/perfectutilitares-backups/AAAAMMDDTHHMMSSZ \
  --include-host-files
```

O timer trimestral verifica integridade e legibilidade. Uma restauração completa
deve ser exercitada trimestralmente em host controlado antes de qualquer uso em
produção.
