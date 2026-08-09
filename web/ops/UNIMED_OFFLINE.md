# Unimed: planilha mestre, múltiplos computadores e modo offline

## Fonte de verdade

O PostgreSQL do PerfectUtilitares é a fonte oficial. A planilha `CALCULO UNIMED.xlsm`
é uma entrada de importação, não um segundo banco. O importador lê as abas `Unimed`,
`Fatura` e `Endereço`, valida tudo antes da publicação e nunca executa VBA, macros,
consultas do Access ou conexões externas do arquivo.

Uma publicação cria uma nova competência de forma atômica. Se houver linha inválida,
a base anterior permanece ativa e o relatório informa as rejeições. Os formatos
legados separados continuam aceitos durante a transição.

## Uso normal

1. Abra **Unimed > Importar bases** em um computador conectado.
2. Selecione o `.xlsm` mestre e informe a competência correta.
3. Revise contagens e rejeições; publique somente após a confirmação.
4. Nos demais computadores, abra o módulo conectado uma vez e use
   **Offline atualizado** para renovar o pacote local.

Não é necessário copiar a planilha para cada computador. Todos recebem os dados já
validados do servidor.

## Escopo offline

- pesquisa de titular e dependentes;
- busca na competência mais recente com fallback automático para a anterior,
  mantendo paridade com a pesquisa online;
- preços, adicionais e fechamento vigentes;
- cálculo com as mesmas regras determinísticas do servidor;
- fila idempotente de solicitação de e-mail, enviada ao reconectar.

Documentos RN561 e termo de inativo exigem conexão, porque sua geração usa o modelo
verificado e o conversor PDF central. A interface informa essa limitação; não cria
arquivo local incompleto.

## Segurança e expiração

- cada navegador possui um identificador próprio;
- o pacote fica criptografado no IndexedDB com chave não exportável;
- a validade offline é de 7 dias;
- APIs nunca são armazenadas pelo service worker;
- bloquear o módulo remove pacote, chave, fila e cache local;
- administradores podem revogar computadores em **Configurações > Dispositivos
  offline**. A revogação impede renovação; a cópia existente deixa de funcionar ao
  expirar ou ao próximo contato com o servidor.

Como o navegador precisa descriptografar os dados durante o uso, a proteção do
perfil do Windows e do disco do computador continua obrigatória.

## Modelos de documento

Produção usa somente os arquivos montados em `/data/unimed-templates`. O carregador
confere tamanho, estrutura, campos de mesclagem e SHA-256 antes de gerar qualquer
documento, além de remover vínculos de mala direta do resultado. Alterações de
modelo devem passar pelo script de construção com caminho de origem explícito e
pelos testes de renderização antes da substituição controlada no volume.

## Recuperação

Se o status indicar pacote expirado ou indisponível, conecte o computador, entre
novamente no módulo e pressione o indicador de sincronização. Se o equipamento foi
revogado, um administrador deve autorizar um novo perfil de navegador; revogações
não são revertidas silenciosamente.
