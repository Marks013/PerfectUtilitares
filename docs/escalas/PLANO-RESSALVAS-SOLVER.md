# Plano de fechamento das ressalvas do solver de Escalas

Estado: execução parcial validada. Segurança, controle de operação, cancelamento e ordenação foram implementados. O usuário autorizou commit, implantação e push, com o servidor como fonte única. A candidata de novos objetivos reprovou o aceite de equilíbrio/cobertura e não será carregada em produção. Detalhes e pendências em FECHAMENTO-RESSALVAS-2026-10-30.md. Os critérios abaixo não foram reduzidos para considerar essa candidata aprovada.

Base conferida diretamente no servidor: Git limpo em f56d74f44a58d43955e001ba8836c3d0abeb6822; código da aplicação publicado em 2b1ea269309b344c3dc2afebf9af840898846447. Local de execução futura: /home/ubuntu/PerfectUtilitares; aplicação em web/. Preservar alterações concorrentes.

## 1. Resultado esperado e limites

Fechar quatro ressalvas: regressão do equilíbrio de domingos, qualidade e descrição da otimização limitada por tempo, autenticação entre aplicação e solver e cancelamento real do processamento.

Não confundir uma solução válida com um ótimo global comprovado. Provar ótimo em todas as entradas dentro de 12 segundos não é um requisito tecnicamente entregável. A correção completa dessa ressalva é melhorar a busca, preservar a melhor proposta válida, medir qualidade e informar corretamente o que foi ou não provado. Nunca trocar o nome FEASIBLE por OPTIMAL para fazer um indicador passar.

Não adicionar configurações iniciais, decisões jurídicas ou novos controles de algoritmo para o usuário. Preservar ausências, bloqueios, jornada selecionada, fronteiras publicadas, regras de descanso, aprendizes excluídos e o modelo conjunto de lideranças. Cobertura estimada continua identificada como estimativa.

## 2. Diagnóstico atual, com localização

- web/ops/escalas/solver.py:298–302 e 344–379: compara oportunidades e histórico por grupos, mas soma amplitudes de sábado e domingo em WEEKEND_BALANCE. Melhorar sábado pode compensar piora de domingo. A filial 07 teve regressão observada nesse subindicador.
- web/ops/escalas/optimization.py:53–77: reserva tempo aos objetivos, mas os recortes secundários maiores liberam uma única semana por objetivo. Isso pode limitar trocas entre dois domingos de semanas diferentes. É uma hipótese a medir, não uma causa já provada.
- web/ops/escalas/server.py:32–45: /solve não autentica o chamador e executa solve diretamente. Um semáforo limita uma execução, mas não há registro de operação nem controle de cancelamento.
- web/src/lib/escalas/solver-client.ts:39–53: usa apenas AbortSignal.timeout(20_000); não recebe o cancelamento do chamador e converte qualquer falha de transporte em SOLVER_UNAVAILABLE.
- web/docker-compose.yml:185–201: solver sem porta pública, em escalas-internal, com 1 CPU e 1536 MB. O benchmark anterior usou limite de 2 CPUs; os novos ensaios principais devem reproduzir os limites reais de produção.

## 3. Ordem de execução e pontos de controle

Executar: linha de base e regressões; proteção interna; ciclo de vida/cancelamento; objetivos e qualidade; ensaios integrados; liberação. Segurança precede a abertura de qualquer endpoint de controle. Não liberar uma etapa parcialmente integrada em produção.

### Etapa A — Congelar evidência e testes antes de alterar o comportamento

1. Confirmar Git, revisão dos contêineres, limites reais de CPU/memória e comandos nativos de qualidade/publicação.
2. Reutilizar FPRE136 e FPHI105 originais. Executar em banco isolado, sem gravar nomes, matrículas, CID ou payloads em evidências. Não usar grades de produção para benchmark.
3. Registrar o vetor de métricas da versão 2b1ea26: descoberto, domingos, sábados, distribuição/rodízio de folgas, alterações de pessoas, estabilidade, preferências, tempo de construção, busca, verificação e resposta completa.
4. Criar regressão que demonstre melhora de sábado acompanhada de piora de domingo no objetivo somado. Criar outro caso que necessite troca entre duas semanas para melhorar domingos.
5. Criar testes que falhem no código atual: chamada interna sem credencial executa; cancelamento mantém solver ocupado; aborto do cliente vira erro genérico.

Saída: testes reproduzíveis com falha esperada e linha de base agregada, sem mudanças em dados reais. Os 28 resultados anteriores são referência histórica, não nova prova de desempenho.

### Etapa B — Autenticação interna sem exposição de credenciais

1. Usar segredo aleatório exclusivo do serviço, com pelo menos 32 bytes de entropia. Não reutilizar ADMIN_PASSWORD, segredo de cookie operacional ou AUTH_SECRET.
2. Provisionar fora do repositório, em arquivo protegido. Montar somente leitura no app e no solver; verificar leitura com os UIDs reais. Não presumir que uid/mode de Compose local alteram permissões do arquivo de origem.
3. Ler o segredo no servidor e enviar em header interno. Não incluir em corpo de modelo, URL, argumentos de processo, browser, logs, mensagens de erro ou imagem Docker.
4. Validar autorização antes de ler o corpo, reservar a vaga ou construir o modelo. Rejeitar header ausente, duplicado, excessivo ou inválido, com comparação de tamanho/forma controlados e compare_digest. Falhar fechado quando a configuração estiver ausente/inválida.
5. Proteger solve, cancelamento e consultas de operação. /health pode continuar sem autenticação somente com resposta mínima, sem nomes, modelos ou informação de operações.
6. Manter rede privada e limites de corpo, leitura, threads e operações. O segredo não substitui isolamento de rede; o desenho não pretende proteger contra root do host ou comprometimento do próprio app.
7. Documentar rotação coordenada, reinício e recuperação. Não manter um modo permanente que aceite solicitações sem segredo para compatibilidade. Não alterar credenciais no planejamento ou em testes.

Aceite: sem segredo/segredo errado nunca chega a solve nem ocupa a vaga; segredo válido resolve um modelo real; nenhum vazamento em logs/erros. Compose válido com acesso aos arquivos protegidos e serviço saudável usando os usuários efetivos.

### Etapa C — Cancelamento ponta a ponta e isolamento de operações

Arquitetura: manter o contrato síncrono de proposta e acrescentar identidade/ciclo de vida da operação. Não introduzir fila, Redis ou biblioteca de jobs. Usar um registro mínimo de controle, não um armazenamento de modelos pessoais.

1. Criar operação autenticada antes de iniciar a busca. Vincular UUID imprevisível a tenant, identidade da sessão/usuário, planejamento, revisão e validade. Não confiar em tenant, filial ou proprietário enviados pelo browser.
2. Preferir registro mínimo transacional no banco existente para sobreviver a reinício do app e permitir autorização consistente. Guardar apenas identidade, estado e prazos, nunca o CSV ou resultado completo. Prever migração aditiva, índices de operação/expiração e remoção limitada de registros expirados.
3. Permitir cancelamento explícito pela aplicação, com mesmas verificações de sessão, origem, empresa, filial e proprietário. Planejamento compartilhado não implica permissão para cancelar processamento de outra sessão. Operações desconhecidas não devem revelar dados de terceiros.
4. Estados independentes do CP-SAT: CREATED, RUNNING, CANCEL_REQUESTED, CANCELLED, COMPLETED, FAILED e TIMED_OUT. Definir transições atômicas. CANCELLED não é status matemático do CP-SAT e não deve ser tratado como INFEASIBLE.
5. Cancelamento antes do início impede o cálculo. Cancelamento repetido é idempotente. Resolver a corrida entre cancelamento e conclusão por transição atômica: só um estado terminal vence.
6. Enviar requestId e capacidade de cancelamento interna vinculada àquela operação. O Python mantém registro limitado por TTL, sem payload pessoal. Cancelar operação A jamais interrompe B. A rota de controle não disputa o semáforo da busca.
7. Propagar AbortSignal pela rota, serviço e solver-client. Associar aborto de conexão à operação, mas não depender somente dele: manter ação explícita de cancelamento e prazo total no servidor. Proxies podem não propagar a desconexão imediatamente.
8. Executar cada cálculo em processo filho próprio, criado e acompanhado pelo serviço. Durante CP-SAT, usar evento cooperativo e stop_search no solver ativo. Durante construção/serialização, consultar o evento em pontos limitados e impedir o início de outra fase.
9. Se o filho não finalizar no período de graça, encerrar somente esse processo comprovadamente pertencente à operação, aguardar seu término e liberar recursos. Nunca matar o serviço inteiro ou processos encontrados pelo nome/porta. Limitar threads e preservar o contêiner.
10. Liberar a vaga somente depois de confirmar a saída do filho. Tratar exceção, desconexão, timeout, SIGTERM e falha na entrega da resposta. Cancelamento tem precedência sobre qualquer aplicação posterior do resultado.
11. Preservar a grade salva. Resposta tardia, revisão antiga ou operação cancelada não altera proposta, horário nem indicador atual. Não reaplicar automaticamente após uma tentativa nova.
12. Interface: Pronto, Preparando, Calculando, Finalizando, Cancelando, Cancelado, Concluído ou Falha. Mostrar somente fases realmente observadas. Usar indicador indeterminado quando não houver avanço mensurável, sem porcentagem fictícia.

Mensagens de referência: “Cancelando o cálculo. Sua escala salva será mantida.”; “Cálculo cancelado. Você pode tentar novamente.”; “O serviço está ocupado. Aguarde o cálculo atual terminar.” Falha de autenticação interna deve orientar o operador, sem pedir configuração técnica ao usuário final.

Aceite: meta inicial de cancelamento confirmado e vaga livre em até 2 segundos, nos limites reais do contêiner, após o serviço receber a solicitação. Confirmar em construção, busca inicial, fase secundária e retorno. Cancelamento simultâneo de outra sessão é negado. Próxima operação completa com sucesso. Zero filho órfão, vazamento de memória ou gravação indevida após ciclos repetidos.

### Etapa D — Domingos como prioridade própria, sem ajuste exclusivo da filial 07

1. Separar SUNDAY_BALANCE de SATURDAY_BALANCE. Atualizar tipos, schema de resposta, nomes, limites de fases, testes, diagnóstico e documentação juntos. Não eliminar silenciosamente estabilidade ou preferências para caber no limite antigo de oito nomes.
2. Manter cobertura primeiro; otimizar domingos antes de sábados, concentração/rodízio, mudanças, estabilidade e preferências. Toda fase deve preservar os limites das prioridades já visitadas e a melhor melhora incidental.
3. Medir domingos por oportunidades efetivamente disponíveis e histórico confirmado. Validar férias, admissão, escala sem horário fixo, limites individuais, noites que ocupam domingo e grupos pequenos. Não transformar ausência ou histórico desconhecido em dívida de domingos.
4. Medir tanto amplitude por grupo quanto sua soma. Evitar melhora agregada que esconda piora desnecessária de um setor: fases posteriores devem preservar os limites dominicais de cada grupo já protegido pelo incumbente.
5. Prototipar vizinhanças de duas semanas ou pares de domingos, escolhidas por desequilíbrio, sem decompor setores nem remover lideranças. Selecionar por desempenho medido; não multiplicar buscas sem considerar o prazo total.
6. Avaliar todos os candidatos no mesmo verificador e vetor de métricas. Descartar candidatos inválidos ou dominados. Não trocar menor descoberto por domingos melhores de forma silenciosa.
7. Quando houver proposta anterior válida para exatamente os mesmos dados/revisão, usá-la como candidato protegido após revalidar. Dados alterados invalidam essa comparação; nunca impor limite de um cenário diferente.
8. Manter pesos e reservas internos, sem novos campos de configuração inicial. Ajustar com conjunto de calibração separado da aceitação.

Aceite: regressão sintética corrigida; melhora dominical conhecida sem aumento do descoberto no mesmo cenário; nenhum objetivo posterior piora domingo já protegido. Nas sete filiais, mediana dominical não piora frente à versão 2b1ea26; na 07, reduzir a regressão observada em comparação pareada. Cobertura mediana não piora em nenhuma filial. Reportar também piores execuções e setores, sem esconder divergências na média geral.

Se o conjunto de candidatos não contiver melhora compatível com a cobertura/regras, preservar a proposta válida. Distinguir limite de tempo de impossibilidade comprovada. Não declarar a ressalva dominical corrigida só porque a fase rodou ou porque uma execução favorável apareceu. Qualquer mudança de prioridade que aceite menos cobertura exige decisão explícita, fora da configuração automática padrão.

### Etapa E — Qualidade verificável sem promessa de ótimo global

1. Manter o melhor incumbente válido em todas as saídas; controlar prazos de construção, busca, validação e retorno separadamente. Derivar timeouts das camadas de uma configuração consistente; a interface deve esperar o servidor finalizar/cancelar com margem, e não abandoná-lo antes.
2. Preservar o orçamento padrão de busca de 12 segundos. Não ampliar esse orçamento apenas para o benchmark passar. Fixar meta de latência total somente após medir o custo real de um processo filho nos limites de produção.
3. Registrar objetivo, valor inicial/final, bound quando válido, tempo, motivo de término, alcance GLOBAL ou vizinhança e fases não executadas. Somente métricas agregadas, sem nomes ou IDs pessoais.
4. Informar FEASIBLE quando existir proposta válida sem prova global. OPTIMAL exige prova no modelo global de todas as prioridades aplicáveis, na ordem correta. Ótimo de recorte semanal não é ótimo global; nem seu bound pode ser anunciado como bound global.
5. Calcular diferença para o bound apenas no mesmo objetivo/modelo e com bound válido. Não criar um percentual único de “qualidade da escala” a partir de objetivos diferentes. Valor zero exige tratamento próprio, não divisão por zero.
6. Validar ótimos de instâncias pequenas com enumeração independente ou oracle exato, incluindo o vetor lexicográfico completo. Em modelos grandes, comprovar restrições e comparar qualidade, sem fingir prova de ótimo.
7. Tratar MODEL_INVALID, INFEASIBLE, timeout sem solução, solução parcial válida e cancelamento como condições diferentes. Nunca devolver lista vazia como se fosse uma proposta válida.

Aceite: nenhum falso OPTIMAL; valores e métricas conferidos por avaliador independente; casos pequenos coincidem com a prova exata; nenhuma fase posterior degrada limites protegidos. Mensagem principal ao usuário: “Proposta calculada dentro do prazo disponível”, com detalhes técnicos opcionais.

## 4. Matriz de validação e protocolo de benchmark

- Unitários Python: prioridades separadas, limites por grupo, vizinhanças cruzadas, históricos/ausências/noites, cancelamento em todas as etapas, autenticação e erros sem conteúdo pessoal.
- Testes de servidor HTTP real: autenticar e resolver; cancelar e liberar a vaga; repetir/antecipar cancelamento; payload truncado/excessivo; solicitação inválida durante ocupação; falha e reinício de processo. Não bastam mocks de stop_search ou do segredo.
- Vitest de API/serviço: sucesso funcional com persistência real do controle da operação; autorização por tenant/filial/sessão; revisão concorrente; falha de solver; timeout; nenhuma aplicação após cancelamento. Toda rota nova/alterada precisa de caminho funcional real.
- Navegador em ambiente isolado: importar CSV, escolher 42h, gerar, cancelar, gerar novamente, revisar, exportar PDF/XLSX; duas sessões e duas empresas; 375/768/1280 px; teclado e anúncio acessível dos estados.
- Regredir ENC, aprendiz excluído, 887 dias de ausência do benchmark anterior quando a entrada for idêntica, horário 22:10, pausa curta e liderança conjunta. Não fixar contagens quando o arquivo/horizonte for diferente.
- Benchmarks: sete filiais, versões 2b1ea26 e candidata, mesmos importadores/entrada, pelo menos dez repetições pareadas por versão/filial (140 execuções). Embaralhar a ordem, fixar recursos, registrar carga do host e descartar somente falhas ambientais por critério previamente escrito, sempre reportadas.
- Usar 1 CPU/1536 MB como ensaio principal, após confirmar o limite efetivo; 2 CPUs apenas como comparação separada. Incluir diferentes sementes no conjunto de teste e semente padrão de produção, sem confundir variação com determinismo.
- Separar calibração de aceitação: meses adicionais e cenários perturbados preservando restrições, ausências, setores pequenos, preferências reais não vazias, vínculos de liderança e 250 pessoas/42 dias/12 horários. Executar carga pesada isoladamente, sem saturar o servidor compartilhado.
- Publicar mediana, p95, mínimo/máximo e diferenças pareadas por filial, setor e objetivo. Com amostra pequena, indicar incerteza; duas repetições não sustentam conclusão estatística.
- Se não houver evidência suficiente de melhora da 07 sem regressões, voltar à etapa D; não reduzir gates, excluir casos ou flexibilizar regras para concluir.

## 5. Liberação, recuperação e organização do trabalho

1. Trabalhar diretamente no servidor, sem checkout de aplicação local. Revalidar Git antes de cada lote. Preservar usuários, volumes, CSV originais, segredos e grades.
2. Fazer lotes pequenos: regressões/controle de operação; segurança/cancelamento; objetivos/diagnóstico; integração/evidências. A revisão deve ser separada da escrita, mesmo se executada pela mesma pessoa em passagens distintas.
3. Testes focados durante cada lote. Uma rodada final de npm run quality e uma de npm run build, depois de consolidar as alterações. Retomar somente etapas que falharem ou forem invalidadas por uma correção real.
4. Validar migração aditiva em banco isolado e Compose protegido com config --quiet; nunca imprimir configuração expandida com segredos. Provar que banco antigo/novo e app/solver estão na combinação prevista.
5. Antes de publicar, preservar imagens e revisão atuais; criar o novo segredo de produção somente na etapa autorizada de implantação. Testes usam segredo exclusivo e banco isolado.
6. Publicar app e solver compatíveis de forma coordenada. Se o projeto exigir Git limpo, obter a autorização de commit da nova etapa; não inferir autorização de push.
7. Pós-publicação: checks nativos, autenticação positiva/negativa, cálculo sintético autorizado, cancelamento real, novo cálculo após cancelamento, leitura/exportação de planejamento existente. Não modificar grade real como efeito colateral do smoke.
8. Recuperação: reverter app e solver juntos para o par compatível, sem apagar segredo/volumes nem desfazer migração aditiva indiscriminadamente. O par antigo não autenticado exige recuperação coordenada e isolamento de rede, não um bypass secreto no código novo.
9. Registrar revisão de código, revisão documental, resultados reais, limites e Git final. Encerrar processos e temporários próprios; não limpar cache Docker compartilhado.

## 6. Checklist de conclusão

- [ ] Domingos separados de sábados; regressão da filial 07 resolvida pelo mecanismo geral e comprovada no conjunto de aceitação.
- [ ] Cobertura, ausências, bloqueios, jornada, descanso, aprendizes e liderança preservados.
- [ ] Qualidade e alcance da prova descritos corretamente; nenhum ótimo global inventado.
- [ ] Solve e controles internos autenticados, sem exposição de segredo e sem fallback inseguro.
- [ ] Cancelamento efetivo, isolado por operação/identidade, idempotente e sem resultado aplicado depois.
- [ ] Vaga e recursos liberados; novo cálculo funciona após cancelamento, erro e timeout.
- [ ] Testes HTTP, banco e navegador reais aprovados; benchmark repetido nas sete filiais com recursos comparáveis.
- [ ] Quality, build, migração e Compose aprovados; implantação e recuperação comprovadas quando autorizadas.
- [ ] Documentação/evidências atualizadas; situação de commit/push declarada sem ambiguidade.

Nenhum item fica marcado por expectativa. Se uma meta não for demonstrada, continua pendente com a causa e evidência correspondentes.

## Fontes técnicas verificadas

- OR-Tools, estados e limites: https://developers.google.com/optimization/cp/cp_solver e https://developers.google.com/optimization/cp/cp_tasks
- API Python 9.15, stop_search assíncrono e bounds: https://raw.githubusercontent.com/google/or-tools/v9.15/ortools/sat/python/cp_model.py
- Python 3.13, compare_digest: https://docs.python.org/3.13/library/hmac.html
- Python 3.13, ciclo de vida e limites de subprocessos: https://docs.python.org/3.13/library/subprocess.html

As fontes explicam as APIs, não garantem latência nem qualidade neste projeto. UI/UX Pro Max orientou feedback de progresso real, estados acessíveis e preservação do contexto; não substitui os testes de cancelamento no servidor.
