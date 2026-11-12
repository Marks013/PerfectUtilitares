# Folgas variáveis e revisão operacional — 11/11/2026

Referência: `8152026`. Solicitação: evitar três folgas comuns consecutivas, priorizar folgas separadas e permitir pares quando úteis à cobertura. Folgas fixas são escolha explícita, não uma decisão automática por cargo.

## Implementação

- `VARIABLE` continua sendo o padrão. A edição do colaborador apresenta a opção desmarcada “Fixar dias de folga (opcional)”; ao ativá-la, aparecem as opções de uma ou duas folgas fixas e seus dias. Configurações manuais existentes são preservadas.
- Novas gerações usam `restRulesVersion: 1` e limitam sequências regulares de OFF a dois dias, inclusive entre semanas e fronteiras conhecidas. Afastamentos e feriados fechados não viram OFF. Janelas inteiramente impostas e configurações fixas explícitas são preservadas. Revisões antigas continuam legíveis e exportáveis, com aviso quando aplicável; versões publicadas não são reinterpretadas por essa nova preferência operacional.
- `REST_SPACING` minimiza pares de folgas sem exigir separação que prejudique cobertura, descansos ou escolhas explícitas. O objetivo protege também as penalidades individuais do incumbente. Não equivale a prova de que todo par remanescente é inevitável.
- `UNTIMED_ROTATION` trata a distribuição de dias dos ENC com penalidade convexa: melhora a distinção entre contagens concentradas e distribuídas que empatavam no desvio absoluto. ENC continua sem horário fictício e sem cobertura horária garantida.
- O reparo prévio faz trocas de trabalho/folga na mesma semana, com validação individual e integral. Pode trocar duas pessoas do mesmo setor/cargo, com conferência do déficit por horário, quando a troca individual não preservaria cobertura. Não altera domingos, referências de horários, jornada, bloqueios ou afastamentos.
- Rascunhos antigos com sequências inválidas têm até 2.500 ms para reparo local; a preparação normal conserva 1.500 ms. O orçamento Python continua 12 segundos, um núcleo, 1536 MiB e um cálculo simultâneo.
- Se o reparo seguro não completar um rascunho com essas sequências, a aplicação mantém a grade e explica a limitação. Não troca silenciosamente um bom resultado de cobertura por uma reconstrução irrestrita pior.

## Evidência prática anterior à implantação

Filial 11, novembro/2026, revisão 40: seis janelas com três OFF; 126 pares adjacentes; déficit de 138.085 pessoas-minutos. O candidato completo passou no verificador independente com zero janelas de três OFF, 116 pares e déficit de 136.651. Nenhum setor piorou. Domingos inalterados. O caso individual indicado pelo usuário passou a ter zero pares consecutivos. Nenhum dado privado foi incorporado a fixtures.

Uma tentativa inicial que eliminava as sequências, mas piorava cobertura, foi rejeitada sem salvar. O cenário antigo da filial 06 não completou o reparo local seguro: seus dados não foram alterados nem considerados aprovados nesta etapa. A salvaguarda impede que esse resultado inferior vire nova proposta automática.

## Verificação

A execução integrada de código aprovou 2.790 testes e encontrou uma expectativa antiga de igualdade integral que não incluía o marcador de política novo. Essa expectativa foi atualizada mantendo a comparação integral, inclusive a cobertura manual e mínimos zero. Em seguida, 100 testes afetados, TypeScript, lint, código não usado, limites estruturais e 73/73 rotas funcionais passaram. A salvaguarda adicional passou em 33 testes do cliente, incluindo ausência de chamada ao cálculo quando o reparo seguro não é obtido.

Python: os testes novos reproduziram a ausência de limite e a saturação do objetivo antigo. Foram executados 123 testes afetados; um contrato de fronteira contradizia o novo máximo de duas OFF. Após ajuste autorizado dessa expectativa e inclusão de um caso viável de dois dias, 15 testes exatos passaram. Os dez testes de hints/feriados e Ruff também passaram. Não foi repetida a suíte completa de Python.

## Aceite

A revisão posterior à implantação deve inspecionar a geração real da filial 11 por setor, cargo, turno, jornada, datas de folga e presença. O veredito é operacional, não uma autorização normativa. Sem prioridade de movimento cadastrada, a cobertura continua estimada; não se deve inventar maior movimento por dia da semana ou declarar ótimo global a partir de FEASIBLE. Pares remanescentes exigem ressalva se sua necessidade não foi comprovada.
