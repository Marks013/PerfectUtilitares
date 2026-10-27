# Escalas 5×2 — operação e implantação

## Acesso e responsabilidades

O módulo fica em `/escalas` e exige conta ativa vinculada a uma empresa. O administrador gerencia as filiais da própria empresa. Outros usuários dependem de concessão explícita em `EscalaBranchAccess`, por empresa, usuário e código de filial: `VIEWER` consulta, `PLANNER` planeja e `APPROVER` também aprova. Não há concessão automática por senha de outro módulo. Transferir um usuário de empresa revoga suas concessões anteriores no banco.

Na primeira entrega, a manutenção dessas concessões é administrativa no banco; não foi acrescentado um editor de permissões à interface de Usuários. A implantação não cria usuários, permissões ou funcionários de demonstração na base operacional.

## Fluxo de trabalho

1. Criar uma proposta por filial e mês. O período inclui as semanas completas de segunda a domingo que alcançam o mês; os dias adjacentes ficam visíveis e entram nos cálculos.
2. Importar somente o **FPRE136.CSV**. O arquivo Windows-1252 fornecido contém matrícula, nome, filial, setor, cargo, horário dos dias úteis e referência de sábado. A importação seleciona apenas a filial da proposta, preserva matrículas textuais e mantém as referências originais. O XLSX fornecido apresenta uma estrutura incompatível com a biblioteca existente; utilizar o CSV, semanticamente conferido contra os 650 registros do XLSX. O modelo CSV/XLSX próprio continua como alternativa, sem exigir um segundo arquivo.
3. Aplicar a configuração da filial à equipe em uma ação: carga de referência, propostas de horários adaptados e descanso dominical quinzenal protetivo para todos. Folgas variáveis, mistas, fixas, consecutivas ou separadas podem receber exceções individuais opcionais. A regra geral do comércio admite uma folga em três domingos; a proteção do art. 386 continua quinzenal e não pode ser relaxada por um limite numérico. O sistema não infere gênero pelo nome.
4. Admissão e histórico são opcionais e ficam na conferência avançada. Data vazia não equivale a nova admissão. Quando disponíveis, os últimos 21 dias reais participam da validação; sua falta gera um aviso de limite de conferência, sem exigir segunda importação nem bloquear a publicação da proposta interna. A continuidade planejada é reconstruída automaticamente com as últimas propostas publicadas da mesma empresa e filial, por matrícula, mantendo-se separada dos registros reais de ponto.
5. Conferir fonte normativa, responsável, vigência, carga máxima, distribuição/compensação, intervalos, domingos, feriados e fechamentos. Nenhuma CCT expirada é aplicada automaticamente. O cadastro não substitui a conferência do instrumento vigente.
6. Sugerir cobertura da filial a partir da equipe e conferir o conjunto uma vez. A estimativa usa a disponibilidade comum às alternativas de cada pessoa, aplica disponibilidade de 5/7 e limita a referência dominical a 1/2 no rodízio protetivo. Nunca exige a mesma pessoa nas duas extremidades incompatíveis de turnos alternativos. Mínimo zero é explícito e precisa ser confirmado. Faixas já cadastradas são preservadas. Essa sugestão não comprova a demanda real de operação; horários de funcionamento e exceções ainda precisam ser conferidos por filial.
7. Salvar e gerar uma proposta ou solicitar até três alternativas por colaborador/semana. Conferir a prévia completa e as outras pessoas afetadas antes de aplicar.
8. Salvar a nova revisão, resolver impeditivos e pendências e aprovar internamente. PDF e XLSX usam a revisão salva identificada, inclusive quando rascunho.

As sugestões são alternativas completas. Aplicar uma substitui a proposta integral; não é possível somar opções individuais ignorando sua disputa pela mesma cobertura. Qualquer edição invalida as prévias anteriores. A publicação interna não envia mensagens, não registra ponto e não lança valores na folha.

## Cálculo e conferência

Tempos controlados são minutos inteiros: 40h = 2.400, 42h = 2.520 e 44h = 2.640. Distribuídos em cinco dias, correspondem a 8h00, 8h24 e 8h48 computáveis. Refeição não é trabalho; pausa remunerada conta para carga, mas não para atendimento. A EC 141/2026 limita a jornada semanal a 42h a partir de 16/12/2026 e a 40h a partir de 16/12/2027. Neste regime, o limite diário da distribuição passa a 8h24 e depois 8h00. A ampliação acima de oito horas na transição exige instrumento coletivo conferido e vigente, além da autorização de compensação. Cargas menores existentes não são elevadas. Semanas que atravessam as transições usam a carga menor para a semana completa, mediante confirmação expressa; não há rateio diário presumido.

Gerentes e encarregados identificados pelo usuário como não subordinados a horário, com os quatro horários zerados, recebem o modo **sem horário fixo**. Entram no rodízio com cinco dias `DUTY` e duas folgas, incluindo a regra dominical e o máximo de seis dias seguidos. Não recebem turno fictício, crédito de horas nem participação na cobertura por faixa. O cálculo não certifica enquadramento no art. 62 da CLT e informa que os intervalos em horas não foram apurados. O PDF mostra `SH`; o XLSX mostra “Trabalho sem horário fixo”.

A preparação em lote preserva o horário original e cria alternativas de planejamento com a entrada ou a saída mantida, respeitando o intervalo original. Jornadas curtas não são ampliadas automaticamente; horários noturnos sem adaptação diurna permanecem fora da geração, com motivo explícito. Uma opção da filial pode propor um padrão diurno para essas exceções, sem editar cada pessoa. Esse padrão não é aplicado aos colaboradores sem horário fixo.

O perfil opcional da CCT Supermercados Umuarama **PR003084/2026**, fornecida pelo usuário, vale de 01/06/2026 a 31/05/2027. O perfil exige certidão sindical conferida para os regimes previstos na cláusula 46, preserva a proteção quinzenal e veda compensar DSR em feriado. O PDF não comprova a certidão da empresa nem um acordo específico de 8h24. A proibição de atendimento ao público em 25/12, 01/01 e 01/05 não é convertida automaticamente em proibição de todo trabalho interno; casos sem classificação permanecem pendentes. O instrumento sucessor precisa ser conferido para períodos posteriores.

O verificador recalcula as atribuições sem confiar nos totais do processador: semana 5×2, carga contratual/normativa, limite diário, até seis jornadas consecutivas, continuidade com histórico, domingos, intervalos reais, folga sem trabalho remanescente e cobertura nas fronteiras exatas dos segmentos. Nome A–Z é somente apresentação; não é prioridade na alocação. O rodízio compara oportunidades válidas, sem transformar licença em dívida de domingos.

Uma pessoa ocupa seu setor/cargo contratual. Cobertura geral de setor é efetivo total; uma demanda por cargo representa um mínimo daquele subconjunto, não uma tarefa adicional que possa duplicar a pessoa. Substituições entre setores, múltiplas habilidades e transferências efetivas durante o período ainda não estão modeladas nesta versão.

O CP-SAT procura uma solução com todas as restrições obrigatórias. Depois minimiza desequilíbrio proporcional de domingos, pessoas alteradas, dias alterados, preferências não atendidas e desempate estável. Só avança ao objetivo seguinte quando o anterior está comprovado; `FEASIBLE` não é apresentado como ótimo. `UNKNOWN` não comprova impossibilidade e nunca substitui a proposta por uma lista vazia. Respostas com datas ausentes, ausências alteradas ou bloqueios removidos são rejeitadas.

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

Antes de publicar: executar a auditoria de migração em esquema transacional descartado, os testes focados, o gate de qualidade de código, o build e a validação Compose. `npm run quality:code` executa as mesmas verificações de código do `quality`; `npm run quality` continua incluindo E2E com navegador. Nesta sessão, o usuário vedou navegador: não executar E2E visual nem afirmar que foi validado.

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
