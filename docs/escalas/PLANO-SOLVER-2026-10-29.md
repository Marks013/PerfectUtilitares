# Correções do solver de Escalas — 29/10/2026

Estado: etapas deste plano concluídas e implantadas. Base inicial: 43e28c5. Código publicado: 2b1ea269309b344c3dc2afebf9af840898846447. Saúde dos serviços e teste autenticado de interface/exportações confirmados após a publicação, em 30/10/2026. Relatório e evidência agregada: VALIDACAO-SOLVER-E-UI-2026-10-29.md e benchmark-solver-2026-10-29.json. A documentação de fechamento é um commit posterior, sem alteração do bundle implantado. Push não executado.

## Objetivo e limites

Melhorar o aproveitamento dos 12 segundos e reduzir a construção do modelo, sem relaxar bloqueios, ausências, descanso ou jornada. A qualidade de cobertura é medida contra referências estimadas, não contra demanda comercial comprovada. Não prometer ótimo global ou determinismo absoluto por usar uma semente fixa.

## Etapas

1. Registrar regressões antes da alteração: equivalência do descanso em casos enumerados, construção com até 12 alternativas, interrupção UNKNOWN e preservação de prioridades.
2. Substituir pares de alternativas de horário por extremos de ocupação por dia. Preservar fronteiras publicadas, intervalos e semanas parciais. Manter modelo conjunto e equilíbrio de lideranças entre setores.
3. Manter um incumbente completo e avaliável em todas as fases. Ao esgotar uma busca sem solução melhor, preservar o valor do incumbente e aproveitar o orçamento restante nos objetivos seguintes. Não confundir FEASIBLE com ótimo comprovado.
4. Validar pausas internas acima de duas horas em jornadas acima de seis horas: rascunho com aviso; uso estrito exige ajuste ou exceção específica, revisada e vigente. Não transformar um acordo genérico em autorização automática. Sem novos campos obrigatórios na interface.
5. Usar o nome atual num_workers. Manter um worker e semente fixa, sem alegar reproducibilidade absoluta sob limite de tempo.
6. Validar sete filiais do FPRE136 real e afastamentos do FPHI105. Conferir inclusão dos horários 12:50–22:10, preservação de ABSENCE e ausência de pendências semanais artificiais por férias.
7. Comparar cobertura, domingos entre perfis comparáveis, estabilidade e preferências com o mesmo orçamento. Reportar número de fases e variação por repetição; não aceitar métricas brutas como prova de justiça.
8. Rodar testes focados durante implementação. Consolidar quality e build apenas no fechamento, validar Compose protegido, implantar e verificar saúde e fluxo real de Escalas.

## Evidência inicial

- 80 testes Python passaram na revisão inicial.
- Cenário sintético de 30 pessoas retornou cobertura UNKNOWN após obter incumbente viável e interrompeu os demais objetivos.
- 250 pessoas/42 dias/12 alternativas retornaram UNKNOWN na construção em aproximadamente 11 segundos, sem chamada CP-SAT.
- A versão atual já importa FPHI105 e registra ausências. O código atual já mantém referências noturnas em simulação e consolida avisos de afastamento por período; essas funções serão verificadas, não substituídas por implementações antigas.

## Complemento solicitado: organização e leitura

- Horários: setor A–Z, sequência completa de horários em ordem crescente, cargo e nome A–Z. Jornadas idênticas ficam juntas; folgas mantêm a ordenação adequada à grade mensal.
- Fonte FPRE136 com quatro horários zerados: identificar como ENC (escala sem horário fixo), sem inventar horas ou dispensa legal; manter presença e folgas.
- Cargo confirmado pela empresa AUX. DE SERVIÇOS EM SUPER e nomes explícitos de aprendiz: fora da geração de folgas; conservar cadastro, fonte, ausências e bloqueios já existentes.
- Revisão compacta, informações de publicação separadas das ações do rascunho, botões com destino e foco úteis. Opção de pausa curta deve ser encontrável, sem alteração silenciosa.
- PDF A4 e XLSX: cabeçalhos menores, melhor aproveitamento do papel, grades legíveis, contraste discreto, zoom e congelamento úteis.
- Manter validação de importação, proposta, revisão e exportação em navegador real, incluindo tela pequena. Nenhuma mensagem informativa deve simular uma falha de geração.

## Recuperação

Preservar banco, arquivos protegidos e todas as revisões. Alterações de contrato são opcionais e retrocompatíveis. Não aplicar solver_experimental.diff: o patch foi feito para outra revisão e a decomposição elimina o objetivo conjunto de lideranças.
