# Aprimoramento global do planejamento de supermercados

Estado: concluído e publicado. Código em produção: e8676a16903281990a0021e4b607ea074cc3ec98. Base inicial: 957be62. Trabalho diretamente no servidor.

## Etapas e critérios

- [x] Inspecionar implementação, dados reais e causas dos avisos citados.
- [x] Garantir o modelo 5×2 com máximo de cinco dias consecutivos no solver e na validação independente, incluindo contexto anterior e posterior disponível.
- [x] Identificar legado incompatível e atualizar explicitamente as grades de teste autorizadas, preservando registros originais e restrições individuais.
- [x] Explicar a regra real de quatro horas; oferecer flexibilização restrita, explícita e desligada por padrão somente em simulação.
- [x] Simplificar turnos e separar horário importado de proposto, sem equivalências falsas nem novos turnos artificiais.
- [x] Separar pessoas excluídas com motivo e orientação, sem contá-las na cobertura ou na escala gráfica.
- [x] Unificar presença por minuto civil, sem contar pausas, folgas, afastamentos, horários desconhecidos ou período fora do vínculo.
- [x] Consolidar desfalques por setor, data e faixa, distinguindo mínimo informado de estimativa, sem substituição automática entre cargos.
- [x] Entregar gráfico acessível por horário, data e setor, com consulta das pessoas efetivamente presentes.
- [x] Separar folgas, horários e ambas as visões na tela, PDF e XLSX; unificar legenda F/T/ENC/NP/AF/FV/X.
- [x] Corrigir a causa e classificação dos avisos de afastamento e vínculo, com contexto acionável e sem gerar dívida de horas.
- [x] Verificar semanas completas, ausências parciais/integrais, admissão/desligamento, fronteiras, CSV real, navegador responsivo e arquivos exportados.
- [x] Executar quality e build finais, validar Compose protegido, revisar diff, fazer commit autorizado e implantar com smoke real.

## Evidência inicial dos casos informados

Os dois registros citados possuem afastamento registrado de 03/11/2026 a 02/12/2026. Não possuem admissão ou desligamento informado no período. O aviso genérico de vínculo parcial está incorreto na classificação; as ausências devem ser mantidas e explicadas como tratamento correto, sem exigir cinco dias de trabalho ou horas integrais naquelas semanas. Uma das pessoas não tem horário informado; isso não comprova enquadramento sem controle de horário.

As grades salvas são de teste e o usuário autorizou sua atualização. A autorização não permite inventar vínculos, autorizações, demanda, afastamentos ou relaxar bloqueios individuais.

## Evidências de validação já obtidas

- Suíte completa de código: 275 arquivos, 2.046 testes aprovados e três condicionais ignorados. Os gates não foram reduzidos.
- Otimizador Python atual, em contêiner isolado com fontes somente para leitura: 80 testes aprovados.
- CSV FPRE136 original de 100.561 bytes, sem alterações ou arquivo preparado: sete filiais e 650 colaboradores processados. Todas as filiais produziram solução viável e validação independente sem erro, máximo de cinco dias consecutivos, nenhuma exclusão automática e referências importadas preservadas.
- Grades reais salvas: filiais 07 e 11 e a grade inicial de teste 08 produziram propostas viáveis com máximo de cinco dias, preservando afastamentos, bloqueios e fontes. A grade antiga 08 foi restaurada explicitamente à cobertura automática conforme autorização de alteração das grades de teste. A revisão original permanece preservada.
- Os dois casos de afastamento foram conferidos novamente com o algoritmo novo: um registro informativo de 03/11 a 02/12, 30 dias preservados, sem classificação indevida de vínculo parcial e sem cobrança de horas integrais nessas semanas.
- Os três formatos de conteúdo (folgas, horários e ambos) produziram bytes PDF e XLSX reais para as grades viáveis. Os testes abrem os documentos e conferem planilhas, texto, horários e células.

Os testes de navegador identificaram ajustes de identificação dos novos controles e separação das visões. Foram corrigidos sem diminuir cenários ou substituir o servidor por respostas simuladas. A execução geral e a repetição somente dos fluxos afetados serão registradas na conclusão.

## Limitações de dados, não autorizações presumidas

A continuidade externa ao horizonte só pode ser verificada quando houver histórico real ou planejamento adjacente conhecido. Não são fabricadas folgas anteriores. Pessoas sem horário continuam no planejamento diário como NP, mas não são contadas na cobertura por horário. ENC depende de condição explicitamente informada, não do cargo nem da falta de horário. Estimativas não comprovam demanda operacional e cargos diferentes não são tratados automaticamente como substitutos.

## Fechamento da validação pré-publicação

- Build de produção e compilação do worker concluídos sem erro, em uma única execução de cada comando.
- Os dez cenários de escalas executados contra o build de produção foram aprovados após ajustes focados das expectativas e seletores: equipe, geração, edição, desfazer, troca, recuperação, exclusões, gráfico, flexibilização explícita da pausa, importação real FPRE136/FPHI105 e exportações. Não foram substituídas as respostas do gerador por mocks.
- A contagem do gráfico foi verificada com uma tabela independente de identidades em onze instantes exatos dos horários 09:36–14:00/16:00–20:00, 09:40–13:30/15:30–20:04 e 10:16–15:00/16:30–20:10. Não foi usada a função do produto para calcular o resultado esperado desse teste.
- Os PDFs reais foram abertos com leitor independente e tiveram limites de página conferidos; as planilhas reais foram abertas e suas células e códigos AF conferidos. Folgas, horários e ambas as visões foram testadas nas exportações PDF e XLSX.
- Na execução geral de navegador, 54 cenários passaram inicialmente e cinco foram ignorados por condições do ambiente. As três falhas de contratos da interface foram corrigidas e aprovadas nas execuções focadas; os cenários privados de CSV também foram executados no build de produção.
- Typecheck, lint, análise de código não utilizado e tamanho dos módulos aprovados. Gate de rotas: 72/72 com arquivo dedicado e cenário funcional 2xx. Nenhum limite de qualidade foi reduzido.
- Compose validado com acesso privilegiado aos arquivos protegidos. Imagens da versão 957be62 preservadas com tags rollback-model-20261029-957be62 antes da publicação. Nenhum cache compartilhado será removido.

Os CSVs privados foram enviados diretamente para memória do processo e descritores memfd durante os testes de navegador. Não foram adicionados ao repositório nem transformados em fixtures públicas. A única correção dos testes de arquivo foi atualizar o código antigo de afastamento A para AF, de acordo com a semântica solicitada, mantendo a verificação independente das datas reais.

## Publicação e verificação final

- Aplicação e worker na revisão e8676a1, saudáveis; banco e solver saudáveis, migração concluída. Fontes do solver conferidas por SHA-256.
- Três grades acessíveis recalculadas com controle de revisão: filial 07 revisão 7, filial 08 revisão 13 e filial 11 revisão 8. Os 120 registros de afastamento da filial 11 foram preservados, assim como fontes e restrições individuais. Dois registros fora do acesso da conta utilizada não foram alterados.
- Acesso público às APIs bloqueado com 401; acesso autenticado 200; cookie de sessão Secure e HttpOnly. Zero erros de navegador ou respostas 5xx no smoke.
- Seis exportações reais novamente abertas em produção: PDF e XLSX de folgas, horários e ambos. Tela conferida em 375, 768 e 1280 px sem transbordamento. O gráfico recebeu e teve verificado um ajuste final de legibilidade no celular.
- Nenhum cache compartilhado removido, nenhuma credencial modificada, nenhum push realizado nesta etapa.
