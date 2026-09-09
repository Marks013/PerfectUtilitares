# Encerramento da pendência A14

Base de código: `7c949743e55c4eaf5eca096a3201a2847452bd7a`.

## Alterações

- 42 classes genéricas antes redefinidas pelo tema foram substituídas por 24 classes explícitas em `web/src/app/styles/theme-utilities.css` e nos 30 arquivos consumidores. Os nomes Tailwind voltam a conservar seu significado original.
- Removidas as regras genéricas globais de cor, borda, raio e sombra de `motion-utilities.css`. Removidas as regras concorrentes de `foundation.css` e `dashboard-auth.css` que antes eram vencidas por `!important`.
- Os quatro `!important` de acessibilidade para redução de movimento permanecem deliberadamente. As novas classes do tema não usam `!important`.
- Cores de texto de sucesso, aviso e erro passam a usar tokens explícitos para os temas claro e escuro.
- Escape fecha a navegação também quando o foco permanece no botão que abriu o menu.
- Menus com muitos destinos permanecem recolhidos também no desktop; a navegação expandida fica reservada a telas a partir de 1280 px. Isso corrige o cabeçalho de 129,56 px observado na conta administrativa, preservando o acesso a todos os destinos.
- O script `web/ops/audit-backup.mjs` registra a revisão real do checkout e dos containers. Cada execução utiliza tags únicas para as imagens de recuperação; não sobrescreve as tags das liberações anteriores.

## Evidência independente

- Comparação estrutural dos 30 arquivos TS/TSX: nenhuma diferença de lógica além das substituições de classes esperadas.
- `node verification/theme-contract.mjs --record /tmp/perfect-css-a14-baseline.json` executado antes da migração.
- `node verification/theme-contract.mjs --compare /tmp/perfect-css-a14-baseline.json`: 359 trechos reais, 8.616 combinações e oito propriedades computadas em Chromium, sem diferenças. Abrange dois temas, quatro estados e três contextos de aplicação.
- A comparação de estilos compila o CSS com o pipeline Tailwind/PostCSS instalado. Não reconstrói a aplicação nem usa a suíte preexistente.
- `npx tsc --noEmit --pretty false`: aprovado após a migração inicial.
- A verificação de navegação e páginas autenticadas usa usuário e PostgreSQL descartáveis; não altera contas reais.
- `node verification/theme-browser.mjs`: aprovado em dez páginas, temas claro/escuro e larguras de 375, 1024 e 1440 px (60 combinações). Sem overflow horizontal, sem cabeçalhos acima de 120 px e sem erros de JavaScript; login real isolado, hover e fechamento do menu por Escape aprovados. PostgreSQL descartável e prévia encerrados.

## Liberação e recuperação

Esta continuação requer um rebuild integral adicional para publicar os arquivos alterados. O rebuild anterior da auditoria permanece registrado; não é contabilizado como parte desta continuação.

O backup anterior, as imagens de recuperação e os commits publicados continuam preservados. Nenhuma mudança de schema, credencial ou regra de negócio foi incluída na migração de CSS.

As recomendações arquiteturais sobre separar componentes grandes e rever a identidade dos acessos próprios de Unimed/Reajuste continuam sendo oportunidades de evolução. A auditoria não as classificou como falhas comprovadas que exijam reescrita ou alteração automática das permissões.
