# Integridade do fechamento e cobertura final — 10/11/2026

## Situação

Implementação integrada, com preservação das grades salvas. A implantação exige
qualidade aprovada, imagens identificadas pela revisão Git e conferência dos
serviços após a atualização.

## Correções

- A validação independente verifica trabalho atribuído após o fechamento efetivo:
  padrão 20h, ou 22h na filial 18, com configuração individual preservada.
- Salvar não permite introduzir ou editar trabalho fora desse limite, mesmo quando
  o cliente informa que o cenário está desatualizado.
- Um rascunho antigo pode ser guardado intacto e desbloqueado para recuperação,
  permanecendo desatualizado. Publicar exige nova validação integral.
- Revisões já publicadas mantêm sua leitura histórica. Se um dia publicado
  compartilhado conflitar com o fechamento atual, a geração informa como corrigir
  a origem ou a configuração antes de consumir o Solver.
- O Solver recebe o fechamento efetivo e protege, por setor, o desfalque estimado
  na última hora do mês visível. A nova prioridade CLOSING_COVERAGE vem após a
  cobertura total e a de domingo, dentro do orçamento global nominal de 12s.
- A proteção reutiliza as variáveis existentes. Não cria demandas, mínimos
  operacionais, jornadas, autorizações ou horas fictícias.

## Validação focada

- Qualidade final aprovada: tipos, lint, verificações operacionais, 331 arquivos
  de teste (2.690 testes aprovados e 3 ignorados), código não utilizado, tamanho
  dos módulos e 73/73 rotas com caminho funcional 2xx.
- 54 testes Python de objetivos, mês visível e domingos aprovados no runtime
  existente, com o código em memória; nenhum contêiner novo ou ambiente isolado.
- 30 testes do contrato TypeScript aprovados.
- 115 testes focados da validação e serviço aprovados.
- Recalculo real em memória de novembro/2026 nas filiais 02, 11 e 18. Cada
  comparação usa a mesma demanda preparada e um incumbente legal do algoritmo
  anterior como ponto inicial da melhoria, não uma grade antiga fora da regra.

| Filial | Total antes/depois | Domingo antes/depois | Última hora antes/depois |
| --- | ---: | ---: | ---: |
| 02 | 104.182 / 98.652 | 19.904 / 18.414 | 4.704 / 4.164 |
| 11 | 108.626 / 98.720 | 15.707 / 13.805 | 5.046 / 4.986 |
| 18 | 126.988 / 126.988 | 17.233 / 17.233 | 4.696 / 4.696 |

Valores em pessoas-minutos estimadas não atendidas; não representam demanda de
clientes medida nem garantia de atendimento. Nenhum setor piorou nos indicadores
protegidos. Zero trabalho após fechar, zero alteração de ausência/bloqueio, zero
erro na validação independente e revisões salvas inalteradas.

Os resultados foram FEASIBLE, não ótimos comprovados. A filial 18 não apresentou
ganho nesta execução. Algumas fases curtas retornaram UNKNOWN ou não couberam
no orçamento; o incumbente verificado foi preservado nesses casos.

## Escopo de entrega

Sem alteração de banco, bibliotecas, jornada mista opcional, arquivos importados,
PDF/XLSX ou configurações de produção. Nenhuma grade salva ou publicada pelos
testes. Uma única construção integrada das imagens deve preceder a implantação.
