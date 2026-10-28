# Escalas 5×2 — operação e implantação

## Acesso e responsabilidades

O módulo fica em `/escalas` e exige conta ativa vinculada a uma empresa. O administrador gerencia as filiais da própria empresa. Outros usuários dependem de concessão explícita em `EscalaBranchAccess`, por empresa, usuário e código de filial: `VIEWER` consulta, `PLANNER` planeja e `APPROVER` também aprova. Não há concessão automática por senha de outro módulo. Transferir um usuário de empresa revoga suas concessões anteriores no banco.

Na primeira entrega, a manutenção dessas concessões é administrativa no banco; não foi acrescentado um editor de permissões à interface de Usuários. A implantação não cria usuários, permissões ou funcionários de demonstração na base operacional.

## Fluxo de trabalho

1. Criar uma proposta por filial e mês, com referência inicial de 40 horas. A grade, os totais mensais e os relatórios mostram o primeiro ao último dia do mês civil. O horizonte técnico mantém as semanas completas para validar carga, repousos e continuidade; os dias adjacentes não entram na apuração mensal. Revisões antigas com horizonte exatamente mensal são reconhecidas sem regravar dados; propostas realmente semanais continuam semanais.
2. Importar somente o **FPRE136.CSV**. O arquivo Windows-1252 fornecido contém matrícula, nome, filial, setor, cargo, horário dos dias úteis e referência de sábado. A importação seleciona apenas a filial da proposta, preserva matrículas textuais e mantém as referências originais. O XLSX fornecido apresenta uma estrutura incompatível com a biblioteca existente; utilizar o CSV, semanticamente conferido contra os 650 registros do XLSX. O modelo CSV/XLSX próprio continua como alternativa, sem exigir um segundo arquivo.
3. Escolher a carga semanal e gerar a proposta. A prévia manual de horários é opcional e fica nos ajustes avançados. O sistema parte das referências atuais e preserva o intervalo: pode manter a entrada, manter a saída ou permitir ambas as alternativas para otimizar a cobertura. Conferir as referências e, quando necessário, ajustar as alternativas antes de gerar novamente. A ordenação é sempre por setor e nome; cargo é informação auxiliar. A jornada de 42 horas em cinco dias resulta em 8h24 de trabalho diário; a distribuição acima de oito horas depende da autorização aplicável. Não marcar compensação, acordo ou certidão sem conferência real. Folgas variáveis, mistas, fixas, consecutivas ou separadas continuam com exceções individuais opcionais, dentro das configurações avançadas. O padrão protetivo é quinzenal; a regra geral do comércio não afasta o art. 386. O sistema não infere gênero pelo nome.
4. Admissão e histórico são opcionais e ficam na conferência avançada. Data vazia não equivale a nova admissão. Quando disponíveis, os últimos 21 dias reais participam da validação; sua falta gera um aviso de limite de conferência, sem exigir segunda importação nem bloquear a publicação da proposta interna. A continuidade planejada é reconstruída automaticamente com as últimas propostas publicadas da mesma empresa e filial, por matrícula, mantendo-se separada dos registros reais de ponto.
5. Para simular, não é necessário preencher fonte normativa, responsável e confirmações documentais. As regras especiais ficam recolhidas e são solicitadas contextualmente quando a operação depender delas. A aprovação interna continua condicionada à conferência aplicável. Nenhuma CCT expirada é aplicada automaticamente; o cadastro não certifica conformidade legal.
6. Usar **Sugerir folgas para toda a filial**. Alterações locais são salvas antes da análise; não é necessário salvar em uma ação separada. A geração prepara referências ainda incompatíveis e preenche estimativas de cobertura ausentes, preservando horários escolhidos, decisões bloqueadas, ausências e mínimos confirmados. As estimativas consideram as possibilidades de cobertura de cada pessoa nas alternativas permitidas, sem duplicá-la, com referência de 5/7 nos dias úteis e 1/2 aos domingos. Uma faixa com possibilidade de atendimento recebe referência mínima de uma pessoa; uma equipe pequena não se transforma em cobertura zero durante a semana inteira. São metas de otimização enquanto não confirmadas, e não autorização para reduzir mínimos já aprovados. Eventuais faltas aparecem como pendências com setor, data, faixa e efetivo. A estimativa não comprova a demanda real de operação; mínimos, inclusive zero, precisam de conferência por filial antes de publicar.
7. Conferir a proposta de toda a equipe e aplicar a prévia. A sugestão individual foi retirada. A conferência agrupa ocorrências repetidas e oferece ações para regras, cobertura e dias sem atribuição. Informações técnicas e apuração individual ficam recolhidas, com detalhes opcionais.
8. Salvar a nova revisão, resolver impeditivos e pendências e aprovar internamente. PDF e XLSX usam a revisão salva identificada, inclusive quando rascunho.

As sugestões são propostas completas para a filial. Aplicar uma substitui a proposta integral. Qualquer edição invalida as prévias anteriores. A publicação interna não envia mensagens, não registra ponto e não lança valores na folha.

## Cálculo e conferência

Tempos controlados são minutos inteiros: 40h = 2.400, 42h = 2.520 e 44h = 2.640. Distribuídos em cinco dias, correspondem a 8h00, 8h24 e 8h48 computáveis. Refeição não é trabalho; pausa remunerada conta para carga, mas não para atendimento. A EC 141/2026 limita a jornada semanal a 42h a partir de 16/12/2026 e a 40h a partir de 16/12/2027. Neste regime, o limite diário da distribuição passa a 8h24 e depois 8h00. A ampliação acima de oito horas na transição exige instrumento coletivo conferido e vigente, além da autorização de compensação. Cargas menores existentes não são elevadas. Semanas que atravessam as transições usam a carga menor para a semana completa, mediante confirmação expressa; não há rateio diário presumido.

Horários zerados na nova importação recebem **horário não informado** (MISSING), sem presumir dispensa de controle ou enquadramento pelo cargo. **Sem controle de horário confirmado** (UNTIMED) é uma escolha explícita, não conclusão da importação. Revisões históricas são preservadas, sem recertificação jurídica retroativa. Entram no rodízio com cinco dias `DUTY` e duas folgas, incluindo a regra dominical e o máximo de seis dias seguidos. Não recebem turno fictício, crédito de horas nem participação na cobertura por faixa. O cálculo não certifica enquadramento no art. 62 da CLT e informa que os intervalos em horas não foram apurados. Tela, PDF e Excel usam a mesma legenda: F (folga), T01/T02 (turno), SF (presença sem horário), P (pendente), A (ausência), FV (fora do vínculo) e EX (não incluído). A descrição completa distingue MISSING de UNTIMED.

A preparação em lote preserva o horário original e cria alternativas de planejamento com a entrada ou a saída mantida, respeitando o intervalo original. Jornadas curtas não são ampliadas automaticamente; horários noturnos sem adaptação diurna permanecem fora da geração, com motivo explícito. Uma opção da filial pode propor um padrão diurno para essas exceções, sem editar cada pessoa. Esse padrão não é aplicado aos colaboradores sem horário fixo.

O perfil opcional da CCT Supermercados Umuarama **PR003084/2026**, fornecida pelo usuário, vale de 01/06/2026 a 31/05/2027. O perfil exige certidão sindical conferida para os regimes previstos na cláusula 46, preserva a proteção quinzenal e veda compensar DSR em feriado. O PDF não comprova a certidão da empresa nem um acordo específico de 8h24. A proibição de atendimento ao público em 25/12, 01/01 e 01/05 não é convertida automaticamente em proibição de todo trabalho interno; casos sem classificação permanecem pendentes. O instrumento sucessor precisa ser conferido para períodos posteriores.

O verificador recalcula as atribuições sem confiar nos totais do processador: semana 5×2, carga contratual/normativa, limite diário, até seis jornadas consecutivas, continuidade com histórico, domingos, intervalos reais, folga sem trabalho remanescente e cobertura nas fronteiras exatas dos segmentos. Nome A–Z é somente apresentação; não é prioridade na alocação. O rodízio compara oportunidades válidas, sem transformar licença em dívida de domingos.

Uma pessoa ocupa seu setor/cargo contratual. Cobertura geral de setor é efetivo total; uma demanda por cargo representa um mínimo daquele subconjunto, não uma tarefa adicional que possa duplicar a pessoa. Substituições entre setores, múltiplas habilidades e transferências efetivas durante o período ainda não estão modeladas nesta versão.

O CP-SAT procura uma solução com todas as restrições obrigatórias. Minimiza primeiro faltas de cobertura estimada, ponderadas pela duração; depois, concentração de folgas por setor, desequilíbrio proporcional de sábados e domingos, pessoas alteradas, dias alterados, preferências não atendidas e desempate estável. Folgas consecutivas não são exigidas por padrão. Mínimos manuais ou confirmados continuam obrigatórios. Confirmar a cobertura consolida sua natureza obrigatória; uma alteração posterior da equipe não a transforma silenciosamente em estimativa. A contagem de domingos considera também o turno iniciado no sábado que ocupa o domingo. Só avança ao objetivo seguinte quando o anterior está comprovado; `FEASIBLE` não é apresentado como ótimo. `UNKNOWN` não comprova impossibilidade e nunca substitui a proposta por uma lista vazia. Respostas com datas ausentes, ausências alteradas ou bloqueios removidos são rejeitadas.

Publicações de períodos vizinhos precisam ser coerentes nos dias compartilhados e no histórico usado nas fronteiras. A última revisão publicada continua sendo a referência quando uma edição posterior ainda está em rascunho. Conflitos são apresentados para revisão; o sistema não sobrescreve a outra escala nem transforma uma previsão em registro de ponto.

Folgas fixas consecutivas no domingo e na segunda-feira atravessam naturalmente a fronteira semanal. Quando a última folga de domingo depende de uma segunda-feira fixa já aprovada, o sistema apresenta uma reserva explícita dessa segunda-feira para continuidade. A reserva não aumenta as folgas ou horas do período e não altera histórico. A escala seguinte precisa preservá-la. Folga variável desconhecida não recebe essa inferência; desligamento e feriado incompatível impedem a reserva.

## Limites explícitos desta entrega

- Planejamento de uma a seis semanas completas, até 250 colaboradores, 120 horários e 12.000 faixas de cobertura por proposta/filial. As filiais são independentes, sem deslocamento automático de pessoal entre elas.
- Jornadas noturnas podem ser registradas e conferidas em rascunho. A publicação permanece pendente porque ainda falta representar o crédito de hora noturna reduzida, mesmo que alguém tenha marcado revisão normativa.
- Semanas com ausências ou vínculo parcial permanecem pendentes até existir regra específica para sua carga. Não há horas a repor fictícias ou conversão de licença em folga.
- Feriado não trabalhado que não pode compensar o descanso semanal exige um estado/regra própria ainda não modelado. A geração informa configuração específica pendente; não inventa ausência nem diagnostica falta de funcionários.
- Somente as faixas operacionais declaradas são conferidas. Revisão normativa/municipal e cobertura de funcionamento são configurações por filial. Histórico real não é obrigatório; quando ausente, o sistema permite publicar o planejamento com aviso de abrangência e sem certificar a execução ou a continuidade real anterior.
- Edições de uma versão publicada criam rascunho posterior, preservando a revisão anterior. Os arquivos podem apontar uma revisão histórica; ainda não há uma tela de comparação de todas as revisões.
- O processador tem um trabalho ativo por vez e prazo limitado. A primeira entrega usa chamada privada limitada em vez de fila persistente: queda ou cancelamento exige nova solicitação; a última proposta salva permanece intacta. Cancelar análise descarta a resposta na tela; o processamento privado já iniciado pode concluir seu prazo.

## Infraestrutura e recuperação

O serviço `escalas-solver` usa OR-Tools 9.15.6755 com dependências fixadas, Python em imagem identificada por digest, usuário sem privilégios, raiz somente leitura, rede interna sem porta publicada, limite de 1 CPU e 1.536 MiB. O serviço de PDFs continua separado. O processador não grava nem registra o conteúdo pessoal recebido.

A inicialização dos outros módulos não depende da saúde do otimizador. Se ele estiver indisponível, somente gerar/sugerir retorna indisponibilidade; consulta e edição das propostas salvas continuam disponíveis. O comando de publicação sobe explicitamente o serviço de Escalas junto com aplicação e PDFs.

A migração `20261026160000_add_escala_workspaces` adiciona tabelas de propostas, revisões e permissões, índices e revogação de concessões na mudança de empresa. Não recalcula dados de folha nem altera cadastros de jornada existentes. Relações compostas impedem revisão ou concessão associada a outra empresa. Escritas usam revisão esperada e transação para impedir sobrescrita concorrente.

Antes de publicar: executar os testes focados, as verificações de compatibilidade, o build e a validação Compose. Quando houver migração, executar também a auditoria em esquema transacional descartado. `npm run quality:code` executa as verificações de código do `quality`; `npm run quality` inclui E2E com navegador. Dimensione os testes ao comportamento afetado: geração, importação, permissões, revisões, cobertura, interface e exportações. Registre separadamente os testes HTTP, a conferência dos arquivos e as interações realmente verificadas no navegador.

Executar `bash ops/escalas/audit-migration.sh` a partir de `web/` testa chaves, revisões duplicadas e revogação na transferência em esquema isolado, encerrado por `ROLLBACK`. Os testes Python são `python -m unittest discover -s ops/escalas -p test_solver.py`; exigem o ambiente com `requirements.txt`. A conferência entre o motor real e o verificador é `node --import tsx scripts/escalas/verify-model.mjs <python>`.

Preservar imagens anteriores antes da atualização. Para voltar à versão anterior, restaurar as imagens de app/migrador/PDF e iniciar a composição anterior; conservar as tabelas novas e suas revisões. Não executar migração destrutiva para desfazer a funcionalidade. Parar/remover o serviço de escalas somente depois que nenhuma versão ativa depender dele. Backups e segredos do ambiente permanecem nos procedimentos existentes.

## Referências técnicas

- [OR-Tools: escalas de empregados](https://developers.google.com/optimization/scheduling/employee_scheduling)
- [CP-SAT: estados e minutos inteiros](https://developers.google.com/optimization/cp/cp_solver)
- [Instalação oficial Python](https://developers.google.com/optimization/install/python)
- [EC 141/2026, arts. 6 e 7](https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc141.htm).
- [Lei 10.101/2000, art. 6](https://www.presidencia.gov.br/ccivil_03/leis/l10101compilado.htm).
- [STF, RE 1403904: proteção quinzenal das mulheres](https://portal.stf.jus.br/noticias/verNoticiaDetalhe.asp?idConteudo=496208&ori=1).
- CCT PR003084/2026, fornecida em PDF pelo usuário: conteúdo lido diretamente; autenticidade no Mediador não certificada nesta revisão.

## Edição, exclusão e relatórios mensais

A grade permite busca por nome/matrícula, filtro de setor, cabeçalhos fixos, edição contextual, troca atômica de dias e desfazer a alteração recente. A prévia revalida os colaboradores afetados através das fronteiras e as faixas de cobertura relevantes. Violações novas de restrições obrigatórias ficam explícitas; dias bloqueados e ausências não são transferidos silenciosamente.

A exclusão identifica filial, período e revisão e solicita confirmação. DELETE /api/escalas usa workspaceId e expectedRevision, autenticação, mesma origem, limite de requisições e autorização por empresa/filial. Revisões e proposta são removidas na mesma transação, com registro de auditoria sem conteúdo pessoal. Uma proposta com versão publicada exige permissão de publicação; períodos publicados próximos impedem exclusão conservadora porque o legado não registra IDs de origem de todo contexto de continuidade. Nenhuma exclusão real de produção foi executada nos testes.

PDF e XLSX usam presentation.ts como interpretação única: mês, setor/nome, códigos persistidos, mesmas células e mesmos avisos relevantes. O PDF não tem mais a seção visual “Resumo de carga e turnos”; os cálculos permanecem no verificador e os detalhes opcionais ficam em aba secundária do Excel. A planilha principal é a grade mensal, com cabeçalhos congelados, filtro e impressão em paisagem. O demonstrativo descreve horários originais, propostos, intervalos e diferenças.

Ocorrências repetidas são agrupadas sem mudar sua severidade ou perder contagens. Dias externos ao mês são identificados como verificação técnica entre períodos. Rascunhos continuam exportáveis sem exigir aprovação normativa.

## Limites da otimização e continuidade posterior

O prazo permanece limitado a 12 segundos. Uma proposta FEASIBLE atende às restrições verificadas, mas não comprova ótimo nem execução de todas as fases de equidade. Se a primeira fase consumir o prazo sem provar a melhor cobertura, a hierarquia estrita não avança aos objetivos inferiores. Não se deve apresentar essa proposta como cobertura suficiente ou equilíbrio ótimo.

Planejamentos publicados anteriores e posteriores fornecem contexto por matrícula, separado de ponto real. Dias técnicos compartilhados são preservados; divergências exigem revisão. Os 21 dias conhecidos após o horizonte são recebidos como planningFuture, sem serem exibidos ou contados na escala atual, para conferir sequências, domingos e intervalos na borda futura. O servidor reconstrói esse contexto de fontes publicadas e não confia em contexto arbitrário recebido do cliente.

A validação desta reestruturação e o estado de implantação estão registrados em REESTRUTURACAO-2026-10.md. Sem autorização específica, não executar deploy.
