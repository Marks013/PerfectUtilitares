# Escalas 5×2 — operação e implantação

## Acesso e responsabilidades

O módulo fica em `/escalas` e exige conta ativa vinculada a uma empresa. O administrador gerencia as filiais da própria empresa. Outros usuários dependem de concessão explícita em `EscalaBranchAccess`, por empresa, usuário e código de filial: `VIEWER` consulta, `PLANNER` planeja e `APPROVER` também aprova. Não há concessão automática por senha de outro módulo. Transferir um usuário de empresa revoga suas concessões anteriores no banco.

Na primeira entrega, a manutenção dessas concessões é administrativa no banco; não foi acrescentado um editor de permissões à interface de Usuários. A implantação não cria usuários, permissões ou funcionários de demonstração na base operacional.

## Fluxo de trabalho

1. Criar uma proposta por filial e mês. O período inclui as semanas completas de segunda a domingo que alcançam o mês; os dias adjacentes ficam visíveis e entram nos cálculos.
2. Cadastrar ou importar a equipe pelo modelo CSV/XLSX do próprio módulo. Informar matrícula textual, nome, setor, cargo, carga de 40/42/44 horas, horários permitidos e admissão real. O FPRE131 não substitui horário, setor e histórico de folgas.
3. Configurar folgas variáveis, mistas ou fixas e consecutivas obrigatórias, preferenciais ou separadas. Escolher explicitamente o limite de domingos consecutivos aplicável à pessoa; o sistema não infere enquadramento pelo nome.
4. Informar os últimos 21 dias do vínculo, quando existentes. Histórico ausente permanece pendente; não representa folga. A data de início do planejamento não deve ser utilizada como falsa admissão.
5. Conferir fonte normativa, responsável, vigência, carga máxima, distribuição/compensação, intervalos, domingos, feriados e fechamentos. Nenhuma CCT expirada é aplicada automaticamente. O cadastro não substitui a conferência do instrumento vigente.
6. Declarar cobertura por setor/data/faixa, podendo detalhar cargo. Mínimo zero precisa ser explícito; uma data sem demanda não comprova dimensionamento. A conferência cobre as faixas declaradas, não horários de funcionamento omitidos.
7. Salvar e gerar uma proposta ou solicitar até três alternativas por colaborador/semana. Conferir a prévia completa e as outras pessoas afetadas antes de aplicar.
8. Salvar a nova revisão, resolver impeditivos e pendências e aprovar internamente. PDF e XLSX usam a revisão salva identificada, inclusive quando rascunho.

As sugestões são alternativas completas. Aplicar uma substitui a proposta integral; não é possível somar opções individuais ignorando sua disputa pela mesma cobertura. Qualquer edição invalida as prévias anteriores. A publicação interna não envia mensagens, não registra ponto e não lança valores na folha.

## Cálculo e conferência

Tempos são minutos inteiros: 40h = 2.400, 42h = 2.520 e 44h = 2.640. Distribuídos igualmente em cinco dias, correspondem a 8h00, 8h24 e 8h48 computáveis. Refeição não é trabalho; pausa remunerada conta para carga, mas não para atendimento. A jornada superior a oito horas exige distribuição/compensação autorizada.

O verificador recalcula as atribuições sem confiar nos totais do processador: semana 5×2, carga contratual/normativa, limite diário, até seis jornadas consecutivas, continuidade com histórico, domingos, intervalos reais, folga sem trabalho remanescente e cobertura nas fronteiras exatas dos segmentos. Nome A–Z é somente apresentação; não é prioridade na alocação. O rodízio compara oportunidades válidas, sem transformar licença em dívida de domingos.

Uma pessoa ocupa seu setor/cargo contratual. Cobertura geral de setor é efetivo total; uma demanda por cargo representa um mínimo daquele subconjunto, não uma tarefa adicional que possa duplicar a pessoa. Substituições entre setores, múltiplas habilidades e transferências efetivas durante o período ainda não estão modeladas nesta versão.

O CP-SAT procura uma solução com todas as restrições obrigatórias. Depois minimiza desequilíbrio proporcional de domingos, pessoas alteradas, dias alterados, preferências não atendidas e desempate estável. Só avança ao objetivo seguinte quando o anterior está comprovado; `FEASIBLE` não é apresentado como ótimo. `UNKNOWN` não comprova impossibilidade e nunca substitui a proposta por uma lista vazia. Respostas com datas ausentes, ausências alteradas ou bloqueios removidos são rejeitadas.

## Limites explícitos desta entrega

- Planejamento de uma a seis semanas completas, até 150 colaboradores por proposta/filial. As filiais são independentes, sem deslocamento automático de pessoal entre elas.
- Jornadas noturnas podem ser registradas e conferidas em rascunho. A publicação permanece pendente porque ainda falta representar o crédito de hora noturna reduzida, mesmo que alguém tenha marcado revisão normativa.
- Semanas com ausências ou vínculo parcial permanecem pendentes até existir regra específica para sua carga. Não há horas a repor fictícias ou conversão de licença em folga.
- Feriado não trabalhado que não pode compensar o descanso semanal exige um estado/regra própria ainda não modelado. A geração informa configuração específica pendente; não inventa ausência nem diagnostica falta de funcionários.
- Somente as faixas operacionais declaradas são conferidas. A revisão normativa/municipal, cobertura completa de funcionamento e histórico real são responsabilidades do cadastro e da aprovação.
- Edições de uma versão publicada criam rascunho posterior, preservando a revisão anterior. Os arquivos podem apontar uma revisão histórica; ainda não há uma tela de comparação de todas as revisões.
- O processador tem um trabalho ativo por vez e prazo limitado. A primeira entrega usa chamada privada limitada em vez de fila persistente: queda ou cancelamento exige nova solicitação; a última proposta salva permanece intacta. Cancelar análise descarta a resposta na tela; o processamento privado já iniciado pode concluir seu prazo.

## Infraestrutura e recuperação

O serviço `escalas-solver` usa OR-Tools 9.15.6755 com dependências fixadas, Python em imagem identificada por digest, usuário sem privilégios, raiz somente leitura, rede interna sem porta publicada, limite de 1 CPU e 1.536 MiB. O serviço de PDFs continua separado. O processador não grava nem registra o conteúdo pessoal recebido.

A migração `20261026160000_add_escala_workspaces` adiciona tabelas de propostas, revisões e permissões, índices e revogação de concessões na mudança de empresa. Não recalcula dados de folha nem altera cadastros de jornada existentes. Relações compostas impedem revisão ou concessão associada a outra empresa. Escritas usam revisão esperada e transação para impedir sobrescrita concorrente.

Antes de publicar: executar a auditoria de migração em esquema transacional descartado, os testes focados, o gate de qualidade de código, o build e a validação Compose. `npm run quality:code` executa as mesmas verificações de código do `quality`; `npm run quality` continua incluindo E2E com navegador. Nesta sessão, o usuário vedou navegador: não executar E2E visual nem afirmar que foi validado.

Executar `bash ops/escalas/audit-migration.sh` a partir de `web/` testa chaves, revisões duplicadas e revogação na transferência em esquema isolado, encerrado por `ROLLBACK`. Os testes Python são `python -m unittest discover -s ops/escalas -p test_solver.py`; exigem o ambiente com `requirements.txt`. A conferência entre o motor real e o verificador é `node --import tsx scripts/escalas/verify-model.mjs <python>`.

Preservar imagens anteriores antes da atualização. Para voltar à versão anterior, restaurar as imagens de app/migrador/PDF e iniciar a composição anterior; conservar as tabelas novas e suas revisões. Não executar migração destrutiva para desfazer a funcionalidade. Parar/remover o serviço de escalas somente depois que nenhuma versão ativa depender dele. Backups e segredos do ambiente permanecem nos procedimentos existentes.

## Referências técnicas

- [OR-Tools: escalas de empregados](https://developers.google.com/optimization/scheduling/employee_scheduling)
- [CP-SAT: estados e minutos inteiros](https://developers.google.com/optimization/cp/cp_solver)
- [Instalação oficial Python](https://developers.google.com/optimization/install/python)
- O planejamento aprovado de 26/10/2026 documenta as fontes normativas consultadas e as confirmações ainda necessárias. Este módulo não fixa transições legais futuras a partir de uma referência não confirmada no cadastro.
