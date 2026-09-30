# Suspensão temporária de Eventos

O módulo permanece preservado, com acesso desativado por padrão. A variável
`EVENTS_ENABLED` controla o módulo no aplicativo e no processador de PDFs.
Somente o valor exato `true` o habilita.

Com o módulo desativado:

- O menu Eventos não aparece para administradores.
- As páginas, APIs, links de convidados e webhook exclusivo de Eventos respondem
  HTTP 503, com código `EVENTS_DISABLED` e sem cache.
- O processador de PDFs não carrega os serviços de manutenção de Eventos e não
  agenda lembretes, novas tentativas de entrega ou limpeza dos dados de Eventos.
- Os documentos, cadastros e configurações existentes permanecem armazenados.
  As funções de PDF e os e-mails dos demais módulos continuam independentes.

A suspensão evita as consultas e tarefas periódicas do módulo. O código continua
na aplicação para permitir reativação. Algumas bibliotecas compartilhadas, como
o cliente de e-mail incluído no bundle do worker, permanecem carregadas; não há
promessa de consumo de memória zero nem remoção de dependências.

## Reativação

Defina `EVENTS_ENABLED=true` na configuração protegida usada pelo Docker Compose
e recrie os serviços `app` e `pdf-worker` pelo procedimento de implantação do
projeto. Reiniciar apenas os contêineres existentes não aplica novas variáveis.
Não é necessário alterar banco de dados ou reconstruir cadastros.

Antes de reativar, revise os eventos e entregas pendentes: os lembretes e novas
tentativas vencidos voltam a ser processados, e a política normal de retenção
volta a executar. Para suspender novamente, use `EVENTS_ENABLED=false` e recrie
os dois serviços. Não remova os dados para desativar o módulo.
