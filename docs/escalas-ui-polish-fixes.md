# Correção de foco e cabeçalho — AUX-UI-POLISH-FIX r1

Data: 14/11/2026. Origem humana: pedido “Corrija”, turno `01a1d851-659f-7460-a27a-c5d6c6165454`, reconciliado pela coordenação. Correção dos achados UP01/UP02 de `docs/escalas-ui-polish-review.md`; esse relatório e o manifesto anterior permanecem históricos, sem reescrita.

**Resultado da verificação focada: aprovado. UP01 e UP02 corrigidos.** Somente `web/src/components/escalas/roster.tsx` recebeu mudança de produto nesta tarefa. `roster-editor.tsx`, `ui-polish.test.tsx` e o CSS compartilhado foram preservados; as frentes concorrentes de backend e turnos não foram modificadas.

## Correções

- A abertura por célula da grade ou “Revisar dia” guarda o botão disparador. Cancelar e concluir a edição devolvem o foco depois da atualização do DOM. A confirmação e a persistência do rascunho mantêm seus caminhos anteriores.
- O retorno verifica se a grade está conectada, visível e fora de região hidden/inert. Disparador removido, oculto ou desabilitado usa o título focável da própria grade. Se o contexto inteiro estiver oculto ou tiver sido desmontado, não tenta focar o contexto antigo; o quadro agendado é cancelado ao desmontar.
- O foco torna a pessoa visível sem perder a posição horizontal da região rolável. A primeira verificação após a mudança encontrou alteração dessa rolagem no fim da tabela; o ajuste seguinte passou em todas as combinações.
- O cabeçalho “Colaborador / função” reutiliza a classe existente hoursIdentity, com fundo opaco e empilhamento local adequados ao cabeçalho. Continua alinhado com a coluna fixa ao rolar. Não houve edição de `escalas.module.css`, preservando a leitura concorrente do responsável05.

## Reprodução antes/depois

Foi criado um verificador isolado e reproduzível em `outputs/escalas-ui-polish-fixes/check.cjs`, com `fixture.tsx` própria que monta o componente Roster real, o contexto visual e o modelo sintético da entrega anterior. O teste compila o CSS global e os CSS Modules reais. Usa Chrome headless via Playwright existente, sem instalar dependências, servidor ou aplicação Next.

Todas as requisições da página são interceptadas: o endereço virtual é atendido em memória e outras origens são bloqueadas. Não há chamadas de API, autenticação, Prisma ou banco. Os processos de navegador encerram em finally.

- **Antes:** os quatro cenários reproduziram falta de retorno de foco ao cancelar no início/fim da rolagem, confirmar, remover o disparador e editar pela grade; o cabeçalho não era sticky. `before.json` registra `passed:false`. O modo before encerra com saída 0 para preservar todas as observações, não para declarar aprovação.
- **Depois:** quatro cenários — 390 e 1280 px, claro e escuro — passaram em todas as **11 verificações por cenário**: cancelar no início e no fim, conservar rolagem nos dois extremos, concluir, disparador desabilitado, disparador removido, retorno à célula diária, cabeçalho fixo, ausência de transbordamento da página e ausência de retorno a contexto oculto. Sem erros de página ou requisições inesperadas.
- O cenário de disparador removido usa mudança real da visualização para remover a tabela de horários enquanto o editor permanece aberto. A desabilitação do botão e a ocultação/inert da grade são mutações controladas da fixture para exercitar as defesas; não são troca de conta/autorização real.
- Foram abertas as capturas finais de 390 px, nos dois temas. O título da identificação aparece corretamente no extremo direito da rolagem, sobre a identificação fixa. Os pares before/after e os resultados JSON estão preservados na nova pasta de evidência.

## Outras verificações

- Biome lint somente de `roster.tsx`, com avisos tratados como falha: saída 0, sem correção automática.
- TypeScript delimitado a `roster.tsx` e seu fechamento de dependências, sem emissão/incremental: saída 0, configuração preservada em `outputs/escalas-ui-polish-fixes/tsconfig.slice.json`.
- `git diff --check -- web/src/components/escalas/roster.tsx`: saída 0.
- As 66 verificações anteriores não foram repetidas. O verificador novo é a regressão real dos problemas encontrados; não foi acrescentado teste estático que apenas espelha a implementação.
- Conferência do manifesto anterior: somente roster.tsx mudou entre os 14 sourceHashes, conforme o reparo. Todos os 92 artefatos antigos permaneceram idênticos.

## Comandos e integridade

Crie sua própria pasta com `C:/Users/samue/.codex/hooks/task-temp.ps1 -Action New -Workspace C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`. Use o caminho retornado como OWN_TEMP. A compilação descartável fica somente nela; capturas/resultados são entregáveis na pasta de evidência desta correção. Para repetir sem sobrescrever os resultados congelados, preserve antes essa pasta ou reserve uma nova cópia de evidência.

Com Node embarcado, a partir da raiz do checkout:

```text
node.exe outputs/escalas-ui-polish-fixes/check.cjs OWN_TEMP after
```

A partir de `web/`:

```text
node.exe node_modules/@biomejs/biome/bin/biome lint --diagnostic-level=warn --error-on-warnings src/components/escalas/roster.tsx
node.exe node_modules/typescript/bin/tsc --noEmit --project ../outputs/escalas-ui-polish-fixes/tsconfig.slice.json
```

O executável usado foi `C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/bin/node.exe`. Resultados e comandos resumidos: `outputs/escalas-ui-polish-fixes/checks.json`.

| Evidência | SHA-256 |
| --- | --- |
| `web/src/components/escalas/roster.tsx` corrigido | `c202b0da74ca07b02664b488c1eb781f51506c4ffc854685058ecfd81187efb2` |
| `web/src/components/escalas/escalas.module.css` preservado | `6295ded6d15e81babcf070d204503861ba3ea390310178979e012ba8a353068e` |
| `outputs/escalas-ui-polish-fixes/check.cjs` | `1d3be223737372302c723145bab9ba08ca0e1499d50848b47f93d473c1453220` |
| `outputs/escalas-ui-polish-fixes/before.json` | `08e9484a1ad6d2c39e51d64751b91f8dd51c2c83a7d6bd32a58e21a084999547` |
| `outputs/escalas-ui-polish-fixes/after.json` | `4e4f40c6f6ed97bc3eb74a5e39f791196d6554961831cebc0d066613ee353d33` |
| `outputs/escalas-ui-polish-fixes/checks.json` | `813e2c4b7146bf0262dfd25881e515105730bdce2e1ba06301b40239e4922c52` |

## Limites e liberação

A fixture não é E2E autenticado ou persistência real. Não valida troca de identidade no servidor, banco, arquivos, 200% de zoom real ou o shell/fontes do Next. Não houve quality/build global, implantação, migração, instalação ou alteração de contrato. UP01/UP02 foram resolvidos neste escopo; a aprovação focada não substitui os gates de integração/produção.

Context Mode foi utilizado para análise de resultados e integridade; edição por patch nativo. A orientação de acabamento foi lida antes da alteração. Nenhum subagente ou mensagem lateral foi usado. Navegadores e executores terminaram; a pasta temporária própria foi concluída após preservar as evidências. Recursos desta correção liberados para a coordenação.
