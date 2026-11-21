# Escalas — operação guiada

Escopo: componentes do módulo Escalas. Preservar os tokens, a fonte, os controles e a identidade do PerfectUtilitares. O objetivo é ajudar equipes sem experiência a concluir uma tarefa sem conhecer as regras internas de geração.

## Organização

- Manter filial, período, revisão e estado de salvamento próximos da navegação.
- Usar três tarefas principais: Equipe; Montar escala; Horários, folgas e arquivos.
- Agrupar importações, regras, análises e integração administrativa em áreas próprias, conforme as capacidades recebidas do servidor.
- Em telas estreitas, empilhar a navegação em linhas com rótulos completos. Manter foco visível, controles de pelo menos 44 px e movimento reduzido.
- Usar ajuda junto da ação. Gerar prepara uma proposta; aplicar altera a grade; salvar guarda a revisão; publicar registra a aprovação; gerar arquivo prepara o download.
- Preferir listas, campos conhecidos e separação por espaço. Evitar cards decorativos, títulos técnicos e opções administrativas misturadas às tarefas diárias.

## Vocabulário

| Conceito | Texto adotado | Limite preservado |
| --- | --- | --- |
| Limite contínuo | Equilibrar os dois períodos de trabalho em até 4h30 cada | Proposta automática de dois períodos; mantém a duração diária e o intervalo. Não é um teto diário de 4h30. |
| Pausa curta em simulação | Simular jornada acima de 4h e até 6h sem pausa de 15 min | Mais de 4h, até 6h inclusive; somente simulação. Não dispensa a refeição de jornadas maiores. |
| Jornada mista | Alternar dias de 8h e 9h na semana de 42h | Mantém a explicação de três dias de 8h, dois de 9h e intervalo de 3h nos dias de 9h. |
| Vigência | Aplicar a partir de / Aplicar até | Explicita o período afetado pela troca de horário. |
| Turno autorizado | Horário de trabalho neste dia | Mostra as horas de cada opção, além do nome. |
| Cobertura | Pessoas por horário | Consulta administrativa, sem alterar o significado dos dados. |
| Publicação | Publicar escala conferida | Diferente do salvamento automático. |

## Integração e verificação

`initialContext` é informação visual produzida pelo servidor. Ausência de contexto não concede ações. Os componentes não substituem a autorização das rotas.

O cadastro de novos colaboradores depende de modelos de jornada aprovados. O início de uma escala por operador depende do snapshot aprovado do período; esses contratos não são inventados pela interface. A entrada por nome só deve ser ativada depois do fechamento dessas proteções.

Esta entrega foi conferida por testes de componentes e lint. Revisão visual em navegador, teclado, 200% de zoom e telas de computador/celular continua necessária na integração; renderização estática não comprova esses comportamentos.
