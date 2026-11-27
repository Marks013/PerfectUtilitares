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

## Contraste, feedback e densidade dos painéis

O refinamento de 27/11/2026 preserva a paleta e a ordem de leitura. A fonte dos tokens continua em `web/src/app/styles/foundation.css`; ações destrutivas sólidas combinam `--app-danger`/`--app-danger-hover` com `--app-action-text`, por meio de `theme-utilities.css`. Não usar texto branco fixo como contrato dos dois temas. O texto de erro sobre superfícies suaves continua usando `--app-danger-text`.

Confirmações assíncronas de exclusão de conta e histórico usam `ConfirmAction`, sobre o `AlertDialog` existente. O painel de trabalho de Escalas recebe uma variante compartilhada de densidade: áreas administrativas recolhidas são linhas discretas e painéis internos perdem bordas e espaçamento lateral redundantes no celular, sem reordenar o DOM nem recortar formulários.

Contratos e limites da verificação desta alteração: [feedback do frontend](docs/design/frontend-feedback-2026-11-27.md). As verificações descritas acima não constituem evidência automática para alterações posteriores.

## Prioridade das tarefas e edições locais

A continuação de 27/11/2026 altera a ordem real de leitura: seleção do planejamento, avisos relevantes, contexto de filial/período, etapas e conteúdo da tarefa vêm antes da base global, operadores e catálogo administrativo. Não usar `order` de CSS para divergir da navegação por teclado. A administração continua disponível quando nenhum planejamento está aberto e mantém as mesmas permissões.

O cadastro local do colaborador só entra no salvamento automático depois de Aplicar cadastro à proposta. Trocar de pessoa, adicionar outro cadastro ou cancelar com alterações pendentes exige confirmação pelo AlertDialog compartilhado; continuar editando preserva os campos e devolve o foco ao editor. Reverter os campos remove o aviso. Não armazenar estes rascunhos pessoais em localStorage. A proteção cobre as transições do editor e o aviso nativo de saída/recarregamento; não substitui o fluxo de conflito e salvamento do planejamento.
