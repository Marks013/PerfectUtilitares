# Polimento da interface — AUX-UI-POLISH r1

Despacho `AUX-UI-POLISH:r1:batch151`, gate151, reserva152. Data: 2026-11-14. Checkout: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

## Plano anterior às edições de produto

1. Capturar administrador e filial com dados sintéticos, componentes reais e o CSS global real compilado junto dos CSS Modules. Conferir computador, 390 px e a área útil equivalente a zoom de 200%.
2. Reduzir repetição do contexto já visível e reunir navegação administrativa secundária; preservar tarefas, permissões e formulários.
3. Associar erro ao campo correspondente, tornar tabelas largas acessíveis por teclado e manter ações da pessoa visíveis junto de sua identificação. Corrigir dimensões locais que dificultem rolagem ou leitura, sem mudar os tokens globais.
4. Repetir capturas e verificações proporcionais; preservar scripts, logs, métricas e hashes. Não executar qualidade/build global ou serviços reais.

Alterações de código somente nos arquivos reservados. Sem F09/F10, mudanças em contratos, autorização ou hooks. Trabalho dos outros escritores será preservado. O produto continua com configuração 8h/9h e definições de turnos administrativas, atribuição operacional de turnos existentes e PDF/XLSX básicos permitidos.

## Resultado implementado

- O planejamento aberto mantém filial, período, revisão e estado de salvamento num único resumo visível. Trocar o contexto fica em uma abertura explícita; o seletor e as proteções de alterações não salvas continuam existentes. O resumo diz **Trocar período** quando só há uma filial disponível e **Trocar filial ou período** quando há várias. O componente de seleção mantém o resumo por padrão quando usado sozinho.
- O papel da filial deixa de aparecer duas vezes no topo. Relatórios administrativos ficam junto das outras conferências opcionais, conservando sua capacidade de acesso e a navegação própria.
- A navegação usa singular para um colaborador. A instrução detalhada de ordenação/rolagem da grade fica disponível em “Como consultar a grade”, perto da tabela, sem repetir esse parágrafo na chegada.
- `Field` associa ajuda e erro ao mesmo controle, preservando descrições preexistentes. O erro de matrícula duplicada aparece logo abaixo da matrícula, com identificação única e `aria-invalid`. A ajuda pede manter os zeros; não muda o valor nem sua validação. O formulário mantém o preenchimento ao navegar entre etapas e não recebe uma chave por revisão.
- Corrigido o transbordamento real causado pelo tamanho mínimo de conteúdo da tabela: o painel usa uma coluna de grade que pode encolher, e a seção de horários conserva largura mínima zero. A rolagem fica local, sem recortar a página inteira.
- A tabela de horários recebe uma região de rolagem com foco por teclado. **Revisar dia** fica junto da pessoa na coluna fixa; permanece visível mesmo ao rolar horizontalmente até o fim. A regra de habilitação e a edição do dia não mudam.
- Em telas estreitas, o resumo do contexto deixa de ocupar espaço fixo durante a rolagem, e a identificação fixa da tabela usa largura proporcional. Os detalhes de referência têm alvo de 44 px. As opções de seções e setores do PDF administrativo reutilizam os alvos/checkboxes do sistema.

Foram alterados sete arquivos existentes e criado um teste de associação acessível. Nenhum outro arquivo reservado de produto mudou em relação à captura inicial. Não houve alteração de autorização, hooks, contratos, backend, rotas, regras de geração ou dados persistidos.

## Verificação executada

| Verificação | Resultado e alcance |
| --- | --- |
| Vitest focado | **9 arquivos, 66 testes aprovados**. Associação de ajuda/erro; navegação; seleção de planejamento; papéis; contexto de acesso; prazos/cancelamento; cliente operacional; recuperação; views da escala. |
| Biome | **7 arquivos TS/TSX aprovados**, incluindo o teste novo; avisos tratados como falha, sem correção automática. |
| TypeScript | Fatia de componentes alterados, teste e suas dependências; sem emissão/incremental, configuração reproduzível `tsconfig.slice.json`. Aprovado. Sem tipos globais. |
| Diff | `git diff --check` no escopo sem problemas. O diff geral inclui alterações anteriores preservadas; o manifesto compara os hashes desta rodada com a captura inicial. |
| Navegador sintético | **12 combinações após ajuste:** administrador/filial × 1280/390/640 px × claro/escuro. Sem erros de página. Capturas e relatórios por combinação. |
| Teclado e ações | Abertura/fechamento do seletor por Enter, filial única fixa, rolagem horizontal por seta quando há transbordamento, foco visível, ação da pessoa no fim da rolagem e abertura/cancelamento de edição. |
| Formulário | Matrícula duplicada associada à ajuda e ao erro; envio bloqueado; nome mantido ao sair da etapa e voltar. Não há novo reset de formulário. |
| Papéis e arquivos | Filial sem regras administrativas/relatórios gerenciais; botões PDF e XLSX básicos presentes. Navegação administrativa de relatórios funcional na fixture e opções com altura mínima de 44 px. Não foram baixados arquivos reais. |

O cenário sintético usa 23 pessoas, duas páginas, nome longo, matrículas com zeros, dois setores, uma revisão salva e um mês completo. O modelo da página é substituído por fixture; os componentes e suas interações locais são reais. A fixture não executa persistência, autenticação ou geração reais. A troca de acesso continua coberta pelos testes existentes selecionados; esta rodada não substitui a validação integrada de sessão.

### Medidas observadas

Em 390 px, a página antes do ajuste chegava a **641 px** de largura. Depois, a largura do documento ficou em **390 px**, com **322 px** visíveis na região da grade e conteúdo de **1892 px** rolável localmente. Em 640 px, o documento caiu de **645 px** para **640 px**. No computador, manteve **1280 px**. Os resultados foram iguais para administrador e filial.

**640 px é largura equivalente de layout para uma janela de 1280 px a 200%; não é zoom real do navegador.** A altura equivalente usada foi 450 px. Zoom real de 200%, leitores de tela, Safari/Firefox, toque físico e a composição completa do aplicativo continuam sem validação nesta rodada.

Os pares semânticos medidos sobre a superfície real passaram: texto secundário **9,39:1** no escuro e **7,32:1** no claro; texto principal **15,71:1 / 15,99:1**; texto do botão principal **7,59:1 / 5,47:1**; foco/superfície **6,66:1 / 5,23:1**. São amostras dos tokens usados nos controles, não uma auditoria de todos os pixels ou estados do aplicativo. Os tokens globais foram preservados.

## Evidências e reprodução

Diretório: [outputs/escalas-ui-polish](../outputs/escalas-ui-polish/).

- [manifest.json](../outputs/escalas-ui-polish/manifest.json): hashes dos arquivos de produto e de todas as evidências; comparação com a captura inicial e resultados dos comandos. Zero divergências entre fontes da captura final e fontes entregues.
- [before.json](../outputs/escalas-ui-polish/before.json), [before-replay.json](../outputs/escalas-ui-polish/before-replay.json), [after.json](../outputs/escalas-ui-polish/after.json), [after-light.json](../outputs/escalas-ui-polish/after-light.json): cenário, medidas, foco, contrastes, erros e bloqueios de rede.
- [Antes — filial em 390 px](../outputs/escalas-ui-polish/before-branch-mobile-roster.png) e [depois](../outputs/escalas-ui-polish/after-branch-mobile-roster.png).
- [Antes — tabela](../outputs/escalas-ui-polish/before-branch-mobile-table.png), [depois — tabela](../outputs/escalas-ui-polish/after-branch-mobile-table.png) e [ação no fim da rolagem](../outputs/escalas-ui-polish/after-branch-mobile-hours.png).
- [Erro junto da matrícula, tema claro](../outputs/escalas-ui-polish/after-light-branch-mobile-field-error.png), [geração administrativa](../outputs/escalas-ui-polish/after-admin-desktop-generate.png) e [opções do relatório](../outputs/escalas-ui-polish/after-admin-mobile-reports.png).
- [vitest.log](../outputs/escalas-ui-polish/vitest.log), [lint.log](../outputs/escalas-ui-polish/lint.log), [types.log](../outputs/escalas-ui-polish/types.log), [checks.json](../outputs/escalas-ui-polish/checks.json).

`capture.cjs`, `preview.tsx` e `fixture-model.tsx` são a reprodução isolada. O runner compila **o `globals.css` real e seus imports com o PostCSS/Tailwind já instalado**, acrescentando os CSS Modules reais compilados pelo esbuild. Não há substituição por tokens mínimos. `before.bundle.js`, `before.modules.css` e `before.globals.css` conservam a versão anterior renderizada; `before replay` usa esses ativos congelados sem reconstruir o produto antigo a partir das fontes já alteradas. Os ativos `after.*` conservam o estado novo.

Para repetir, criar pasta própria com `task-temp.ps1 -Action New`, usar o Node resolvido por `load_workspace_dependencies` e executar, sequencialmente: `capture.cjs <pasta-própria> before replay`, `capture.cjs <pasta-própria> after`, `capture.cjs <pasta-própria> after light`. `check.cjs` executa as verificações focadas; `manifest.cjs` confere e registra hashes. O Chrome instalado é usado headless; não se instala navegador nem pacote. A rede é interceptada, sem servidor/DB real; respostas de aprovação são sintéticas. Cada execução fecha o navegador no `finally`.

A borda externa de 16 px e a largura máxima da fixture apenas representam a área de conteúdo. O shell Next completo e o carregamento de fontes pelo aplicativo não são reproduzidos; a fonte é a declarada pelo CSS, com os fallbacks do navegador. Logo, esta evidência é uma verificação visual e de interação com CSS real em fixture isolada, **não E2E autenticado ou prova visual final de produção**.

## Arquivos entregues e SHA256

Caminhos relativos a `web/src/components/escalas/`:

| Arquivo | SHA256 |
| --- | --- |
| `escalas.module.css` | `6295ded6d15e81babcf070d204503861ba3ea390310178979e012ba8a353068e` |
| `escalas-workspace.tsx` | `d58ffa21293f1ba4e3ec83aeae567e7ef2e49adeafab409eb0abd399093ac4c4` |
| `controls.tsx` | `d188682c62c426a2f28e75041162fbfadbeace62450651e66924838bfb08d776` |
| `plan-selector.tsx` | `90c9b1f3297e54a99c688e46f8f11783f0671c658a6779cf0a51e05fab872e5c` |
| `approved-forms.tsx` | `cf080394d913ce10a9a9913dee9ab82bb0559cdc4149e4ac942d4ff63d0eb8db` |
| `roster.tsx` | `2253d878894bc4b46f5fe30b59ae8d31cb030254957e7b3d8829ad781ce1d2f8` |
| `operational-reports.tsx` | `738ab41064a295c8c116ddf6c54645db18cd2ef93e00a4d934634bee0dc815f6` |
| `ui-polish.test.tsx` | `76f26d198265e3153101c13507f8a7e225b6583284b44df72974346d72970951` |

## Limites e liberação

As orientações de interface foram aplicadas à clareza de hierarquia, erro local, foco, alvos, leitura e preservação do sistema existente; não se criou outra identidade visual. Context Mode funcionou nesta tarefa com `ctx_batch_execute` para coleta/indexação e `ctx_execute` para análise de medidas, testes e hashes; o histórico de continuidade já tinha sido consultado nesta sessão. Não foram usados navegador conectado, subagentes ou mensagens laterais. Todas as edições foram feitas por patch nativo.

Não houve instalação, quality/build global, Solver, banco, migração, produção, commit, push ou deploy. Os testes e tipos integrados permanecem com o Maestro. Os processos nativos desta verificação terminaram; o navegador foi fechado. Evidências persistidas fora dos temporários próprios. Após a conclusão desses temporários, esta reserva pode ser liberada integralmente, sem acompanhamento contínuo.
