# Evolução do Solver e da experiência de Escalas — 30/10/2026

Status: concluído e implantado. Código da aplicação: `4f2454a9813487cc043210621cc12a8f4c38cbb6`.

## 1. Solver: cobertura dominical sem transferir déficit entre setores

Foi acrescentado o objetivo `SUNDAY_COVERAGE`, após a cobertura total. A busca pode liberar setores completos, até 36 pessoas, ao longo de todas as semanas. As guardas conservam o déficit semanal e dominical de cada setor e o equilíbrio dominical da referência viável. A integração TypeScript aceita os dez objetivos ativos e mantém a validação independente das atribuições.

O prazo continua em 12 segundos, sem novas bibliotecas. Ausências, bloqueios e regras de descanso não foram flexibilizados.

Comparação real no servidor, com os mesmos relógios e referências de demanda. Unidade: pessoas-minuto de cobertura estimada não atendida; menor é melhor. Janela de cálculo: 26/10 a 06/12/2026, incluindo as semanas de fronteira do mês visível de novembro.

| Filial | Déficit total anterior | Déficit total salvo | Domingo anterior | Domingo salvo | Redução dominical |
| --- | ---: | ---: | ---: | ---: | ---: |
| 07 | 178928 | 165378 | 42092 | 35404 | 15,9% |
| 08 | 89442 | 86072 | 22359 | 14951 | 33,1% |
| 11 | 164330 | 161518 | 26095 | 23331 | 10,6% |

Nenhum setor piorou no agregado semanal ou dominical dessa comparação. As versões salvas são 07/revisão 17, 08/revisão 21 e 11/revisão 16, todas rascunhos válidos. Permanecem 5712, 3192 e 3612 atribuições, respectivamente; os 120 dias de ausência da 11 foram preservados. O histórico anterior não foi removido.

Os resultados são `FEASIBLE`, não prova de ótimo global. Alguns objetivos secundários não foram tentados dentro do prazo; a telemetria os identifica. Os números são observações de execuções reais, não uma garantia estatística para outras equipes ou períodos. A proteção agregada não significa que cada faixa individual permaneceu idêntica.

## 2. Fluxo guiado e aviso curto

A criação usa filial e mês. O trabalho segue três etapas: importar equipe; escolher jornada e gerar; revisar e exportar. A aplicação da importação encaminha para a jornada. Ajustes avançados, afastamentos opcionais, edição e recuperação continuam disponíveis. A exportação fica junto da escala revisada.

A jornada selecionada continua sendo a referência central: 42 horas em cinco dias correspondem a 8h24 diárias, sem incluir intervalos não computados. Referências individuais curtas, horários originais e restrições explícitas permanecem preservados.

Quando há grade calculada, déficit estimado e resultado atual, aparece somente o aviso “Há desfalques estimados.” e a ação “Ver setores e horários”. A ação abre a revisão de cobertura. Não há esse aviso para grade obsoleta, cobertura pendente ou arquivo contendo apenas ausências. O aviso usa a validação existente, sem recalcular diagnósticos durante a renderização.

UI/UX Pro Max orientou as etapas, os rótulos e o feedback. A identidade visual e os controles acessíveis existentes foram mantidos.

## 3. Limite opcional de 4h30 por bloco

O controle “Limitar cada bloco a 4h30” está disponível na etapa de geração. A decisão final, autorizada pelo usuário após a comparação de cobertura, é deixá-lo **desligado por padrão**. Escolhas explícitas são preservadas; registros antigos sem o campo também usam o padrão desligado. Não há duas execuções extras do Solver a cada geração para escolher esse padrão.

Quando ativado, redistribui propostas automáticas com dois períodos de trabalho separados por intervalo real. Preserva a carga total, a entrada e a saída propostas e a duração do intervalo. Exemplo de 42 horas: 200 + 304 minutos passam a 234 + 270 minutos, mantendo 504 minutos diários. Em 44 horas, 240 + 288 podem passar a 258 + 270, mantendo 528 minutos.

Desativar permite reconstruir a proposta da referência importada, conservando a estratégia de entrada/saída. Horários manuais, dias bloqueados e ausências não são sobrescritos; um bloqueio incompatível recebe orientação contextual. Não é inventada uma pausa para um período único nem reescrita uma distribuição manual com mais períodos. A restauração depende de existir a referência importada. Essa opção de planejamento não altera a regra separada de pausa curta nem concede autorização jurídica.

No teste real da 07, ativar o teto deslocou intervalos e alterou o cenário: o déficit total passou de 165378 para 190034 e cinco setores pioraram, embora o dominical caísse de 35404 para 31958. O máximo dos blocos foi 270 minutos e a proposta passou pela validação independente, mas **não foi salva**. As mesmas demandas anteriores foram usadas na comparação, para não atribuir ganho a uma mudança de estimativa. A revisão 17 com melhor cobertura foi mantida. Esse resultado fundamentou o padrão desligado; não prova que o teto seja desfavorável em toda filial.

## 4. PDF e XLSX

Foram ajustados pesos visuais, faixas setoriais discretas, grades, destaque suave de domingos, largura de colunas, altura adaptativa de cabeçalhos e medição do texto em negrito. Os dados, as ordenações e os códigos operacionais foram preservados.

Amostras reais da 08/revisão 20 foram geradas nos três modos. O PDF combinado passou de 16 para 15 páginas; 7805 itens de texto foram conferidos sem saída das margens nas amostras. A largura total das colunas de horários XLSX caiu de 165 para 140 e a de desfalques de 237 para 160. Não foi observada sobreposição nas páginas inspecionadas. A validação XLSX foi estrutural e por leitura, não pelo Excel Desktop.

O navegador também baixou os arquivos reais da revisão 21: PDF válido com 15 páginas e XLSX válido com quatro abas. As amostras e capturas contendo dados operacionais ficam fora do Git, em `/home/ubuntu/perfectutilitares-reports/escalas-polish-20261030`, com diretório 0700 e arquivos 0600.

## 5. Verificação e implantação

- 21 regressões CP-SAT focadas passaram no runtime do container de produção, sem ambiente isolado.
- Contrato do cliente: 14 testes; exportações: 25 testes; fluxo guiado inicial: 52 testes, todos aprovados.
- Rodadas finais afetadas: 52 testes de preparação/geração e 46 de interface, preferência e aviso passaram. Não se somam essas rodadas como testes únicos, pois alguns arquivos se repetem.
- TypeScript, Biome focado e `git diff --check` passaram.
- Prévia autenticada com FPRE136 real: HTTP 200 e 81 registros aceitos na filial 08. A prévia não foi reaplicada sobre a revisão recém-gerada durante esse smoke.
- Navegador autenticado: 375, 768 e 1280 px sem transbordamento da página; 42h/8h24, controle final desligado e ação do aviso conferidos. Nenhum erro de JavaScript ou HTTP 5xx nos fluxos afetados.
- Compose validado com a configuração protegida. App, banco, Solver e worker PDF saudáveis. Banco e worker não foram recriados; não houve migração, seed, alteração de segredo ou publicação de escala.
- Imagem final da aplicação: `sha256:89d4978ec9fed83251ea39341b4f019e9bfb5cdeb6e10c2f96f9d0561ae345dc`.
- Imagem do Solver: `sha256:348fe2019427e43309bb24cf8dc15cee13984e942d6df67547e5b74129be4a7c`; seus quatro módulos foram comparados por SHA-256 com os arquivos do servidor.

Foram usados somente testes afetados e validações práticas, conforme solicitado. Não foram executados ambiente E2E isolado, suíte global de qualidade ou acompanhamento do CI. Os builds adicionais ocorreram quando novos ajustes foram solicitados durante a execução; este relatório, por si só, não exige rebuild.

Recuperação preservada: imagens `web-app:rollback-guided-cb2114894289` e `web-escalas-solver:rollback-guided-ded66e469a55`, além das revisões anteriores das escalas. As duas imagens formam o par anterior compatível; não se deve voltar somente o cliente antigo mantendo a nova fase do Solver.

Desfalques estimados não equivalem a demanda operacional confirmada ou a garantia de atendimento. Ainda existem limitações reais de equipe, horários, funções, intervalos e férias; não foram mascaradas reduzindo referências para melhorar indicadores.
