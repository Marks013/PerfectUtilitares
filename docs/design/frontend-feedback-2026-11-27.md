# Frontend — contraste, feedback e hierarquia

Data: 27/11/2026. Base: `f78c691edbeaf16283f534bcacd8db1b4b7d5e66`.

## Escopo

Correções solicitadas: contraste de ações destrutivas, feedback do login, consistência dos diálogos e refinamento da hierarquia visual. Não altera regras de autorização, autenticação, endpoints, dados, salvamento de colaboradores ou produção.

## Contratos compartilhados

### Cores e ações destrutivas

`foundation.css` permanece como fonte dos valores de tema. `theme-utilities.css` associa o fundo `--app-danger` ao texto `--app-action-text`; o hover usa `--app-danger-hover` somente em controles habilitados. Os utilitários de texto de erro (`--app-danger-text`) não são modificados. O par semântico vale também para chamadas legadas que ainda possuem a classe Tailwind `text-white`; a regra semântica está fora das camadas Tailwind. Novas chamadas não devem adicionar essa classe conflitante.

Contraste calculado e conferido com estilos computados em um cenário CSS isolado:

| Tema | Normal | Hover |
| --- | ---: | ---: |
| Escuro | 7,02:1 | 5,15:1 |
| Claro | 6,29:1 | 8,02:1 |

### Login

`LoginForm` mantém a Server Action existente. A validação de presença/formato é local e não substitui a autenticação. `noValidate` evita balões nativos; rótulos, erros e campos são associados por `aria-describedby`/`aria-invalid`. O primeiro campo inválido recebe foco. Erros de credenciais permanecem genéricos e o resumo recebe foco após a resposta do servidor.

`useFormStatus` informa o envio, desabilita os campos e o botão enquanto pendente e mantém espaço para ambos os rótulos do botão. Um bloqueio síncrono evita submissões consecutivas antes da atualização visual. Senhas não são gravadas em armazenamento, URLs ou logs; os atributos de autocomplete e a colagem permanecem disponíveis.

### Confirmações

`ConfirmAction` reutiliza Radix e o `AlertDialog` do projeto. Captura título, consequência e operação juntos ao abrir, evitando que uma atualização da consulta altere silenciosamente o escopo confirmado. A exclusão pessoal continua pessoal; a global informa explicitamente que afeta todos os usuários e não apenas a página exibida.

A confirmação impede reenvio enquanto pendente. Em erro, mantém o diálogo aberto e foca a mensagem, permitindo tentar novamente ou cancelar. Só fecha após sucesso ou cancelamento explícito. Durante a operação não permite fechar por Escape. Radix mantém isolamento modal, foco inicial em Cancelar e retorno ao disparador; se a exclusão desabilitar esse disparador, há uma região de retorno de foco.

`alert-dialog.module.css` é o proprietário da geometria compartilhada: limites pela viewport dinâmica e áreas seguras, quebra de conteúdo longo e rolagem interna do diálogo inteiro. Não se adiciona limite de altura à página ou aos formulários.

### Escalas

`controls.tsx` mantém `panelClass` como entrada canônica. A variante `panel-hierarchy.module.css` reduz o peso visual dos disclosures recolhidos e remove bordas/espaçamento lateral redundantes de painéis internos em telas estreitas. Não há reordenação CSS, mudança de permissões, remoção de ações nem limite de altura para formulários. Esta alteração compacta a hierarquia existente; não reorganiza as etapas ou os blocos administrativos no DOM.

## Verificação realizada nesta alteração

Ambiente local: Node 22.16.0, TypeScript 5.8.3 e Chromium 144.0.7559.96, diferentes da toolchain oficial do projeto.

- Cinco verificações estáticas de contrato: falharam na base e passaram com as alterações.
- Sete testes nativos de Node sobre as funções reais de validação do login, transpiladas localmente: passaram.
- Transpilação/verificação de sintaxe dos 12 arquivos TypeScript/TSX da alteração: sem erros. Não equivale a `npm run typecheck`.
- Nove verificações de CSS em Chromium: quatro combinações de contraste, quatro cenários de diálogo e uma comparação de densidade mobile. Janelas: 1280×720, 375×320 e 320×256; também houve cenário com fonte raiz ampliada para 32 px. São cenários isolados, não execução da aplicação nem prova de zoom nativo de 200%.

Foram adicionadas regressões Vitest e quatro cenários Playwright para campos inválidos, falha genérica, envio pendente e recuperação de diálogo destrutivo. O teste destrutivo intercepta todos os DELETE de conta: não exclui a conta de testes.

## Verificação ainda exigida para integração

Não foram executados localmente: a suíte Vitest do repositório, lint, typecheck completo, build, o auditor estrito do plugin ou os novos fluxos Playwright da aplicação. O ambiente não contém as dependências do projeto, e o clone por rede não ficou disponível. Não substituir esses resultados pelos testes do CI da revisão anterior.

Executar o CI da nova revisão, incluindo `npm run quality:code`, build e `npm run test:e2e:isolated`, antes da integração/liberação. Conferir visualmente os fluxos reais, foco por teclado, temas, telas estreitas e zoom. Nenhum deploy faz parte desta alteração.
