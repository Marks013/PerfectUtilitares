# Folgas fixas individuais

A interface usa os controles existentes em `controls.tsx` e os tokens de
`escalas.module.css`. O popup do select é nativo, como nos formulários irmãos.
Idioma pt-BR, calendário civil do projeto. Não há mudança de tipografia, tema ou
fluxo de gravação. O botão Salvar do editor continua sendo o único commit do cadastro.

Cada controle tem seleção de dia e checkbox independente. O dia desabilitado é
persistido sem efeito sobre a escala. A ausência do novo metadado mostra o cadastro
legado sem reescrevê-lo. A geração não altera estes campos. HOURS_ONLY mantém a
consulta existente e não oferece redistribuição escondida.

Erros de configuração ficam no editor; conflitos operacionais preservam os dados
e são explicados. Dias de fechamento da filial não acionam checkboxes individuais.
Seleções duplicadas habilitadas são impedidas. Todos os campos têm labels nativos,
texto de ajuda associado e foco dos controles canônicos.

Verificação necessária: testes de componente e do contrato; persistência via
serviço existente; interação de teclado, viewport estreito e E2E no gate completo.
Inspeção estática não substitui essa verificação em navegador.
