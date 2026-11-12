# Movimento de supermercados e reparo seguro das folgas

Base de comparação: `317971eb9b8bf5f4ee6ff0f7fd76f4deb3975b8c`. Trabalho realizado diretamente no servidor. Esta nota descreve a implementação e a verificação pré-implantação; o aceite das revisões salvas exige inspeção após a implantação.

## Correções entregues

- O reparo de rascunhos antigos agora considera presença sem horário, tanto `UNTIMED` como `MISSING`. Esses registros já participavam do rodízio, mas eram ignorados na preparação que reparava três folgas comuns consecutivas. A proposta completa era descartada por continuar inválida, mesmo depois de reparar as pessoas com horário.
- A nova troca preserva cinco dias e os limites individuais conferidos, não modifica domingos, bloqueios, afastamentos ou dias fixos e não inventa horários. `DUTY` nunca vira cobertura horária. O verificador independente decide se o conjunto completo pode ser utilizado.
- O limite de preparação permanece em 2.500 ms para reparos e o cálculo Python permanece em 12 segundos, um núcleo, 1536 MiB e um cálculo simultâneo. Falhar no reparo continua preservando a grade anterior; não há reconstrução irrestrita nem relaxamento automático.
- Movimento informado passa a orientar a cobertura estimada, não somente a presença de liderança. O objetivo `MOVEMENT_COVERAGE`, posterior à cobertura bruta, usa pesos 1/2/3 para LOW/NORMAL/HIGH. Datas sem indicação são neutras; não se presumem picos de fins de semana.
- O melhor déficit bruto por setor, domingos e fechamento permanece protegido. Cada setor/data explicitamente HIGH recebe proteção adicional desde a primeira fase, evitando transferir déficit para um pico declarado em troca de ganho mensal em outro dia. Melhorias encontradas nas fases seguintes permanecem protegidas.
- A preparação local aplica a mesma proteção HIGH. Trocas simples, pareadas e acumuladas também preservam o último responsável por setor num pico declarado. Responsabilidade manual compartilhada entre setores é conferida na composição final, e não só em cada troca isolada.
- A indicação de falta de liderança agora corresponde à presença efetiva mesmo quando sua fase de otimização não é executada. Antes, uma variável auxiliar podia permanecer marcada sem corresponder a uma ausência real.
- Python e TypeScript rejeitam setor inexistente numa indicação de movimento, em vez de ignorá-lo silenciosamente. Setores existentes apenas na demanda também são reconhecidos.

## Uso opcional do movimento

1. Abra Cobertura, em Ferramentas e ajustes opcionais.
2. Abra Movimento da loja (opcional).
3. Escolha toda a filial ou um setor, período e intensidade conhecida da operação.
4. Se houver repetição semanal, marque expressamente os dias. Nenhum dia vem marcado.
5. Confira a lista, salve o rascunho e gere novamente.

A lista é ordenada por setor A–Z e data. Conflitos no mesmo setor/período são rejeitados integralmente, sem inclusão parcial; a remoção mantém a identidade correta mesmo com ordenação visual. Uma indicação específica de setor prevalece sobre a indicação geral da filial. Alterar o movimento identifica a proposta como desatualizada.

Não foram cadastrados picos ou dados comerciais nas grades sem informação do operador. Essas indicações são prioridades relativas de planejamento, não cupons por hora, demanda medida, mínimos obrigatórios ou autorização para substituir funções. Importação de fluxo real e matriz de habilidades continuam sendo evoluções distintas, dependentes de dados explícitos.

## Verificações pré-implantação

As reproduções e regressões novas usam dados sintéticos. Os rascunhos reais permaneceram em memória nesta etapa, sem fixtures ou payloads pessoais em arquivos.

- 350 arquivos Vitest: 2.809 testes aprovados, três ignorados já existentes; cobertura e limites vigentes aprovados. A primeira execução encontrou somente uma fixture nova sem o setor exigido pelo contrato mais estrito; a fixture foi corrigida e a cobertura completada novamente. Não foi desativado teste ou reduzido limite.
- Prisma, TypeScript, lint, 47 verificações operacionais, código não utilizado, 425 módulos e gate das rotas aprovados. O ajuste final do lote de liderança passou novamente em 26 testes afetados e lint, sem repetir todas as verificações aprovadas.
- Python: dez regressões novas de movimento, liderança e entrada. O conjunto afetado executou 53 testes; a única expectativa antiga foi reproduzida no HEAD anterior, atualizada para reconhecer `REST_SPACING` e aprovada individualmente. A conferência final independente de movimento e otimização passou em 16 testes no runtime existente.
- Ruff não estava disponível no host e não foi instalado nesta entrega; não se declara lint Python aprovado. Os módulos foram importados e exercitados pelo runtime real.
- Revisão independente encontrou e levou à correção da retirada simultânea dos dois responsáveis por um mesmo setor prioritário.
- Não foi iniciado ambiente isolado nem acompanhado CI, conforme as orientações do usuário. A verificação de navegador será focada no fluxo autenticado alterado após o build, sem auditoria de navegação pública.

## Medição real em memória, antes do Solver Python

| Indicador | Filial 06, dezembro/2026 r11 | Preparação reparada | Filial 11, novembro/2026 r41 | Preparação melhorada |
|---|---:|---:|---:|---:|
| Desfalque estimado, pessoas-minutos | 150.524 | 149.142 | 136.651 | 132.328 |
| Janelas de três OFF | 16 | 0 | 0 | 0 |
| Pares OFF adjacentes | 187 | 165 | 116 | 93 |
| Dispersão dominical comparável | 24.000 | 24.000 | 18.667 | 18.667 |

Em ambas, nenhum setor piorou no total e os mesmos alvos de cobertura foram mantidos. Bloqueios e afastamentos permaneceram idênticos. A preparação levou aproximadamente dois segundos na 06 e menos de um segundo na 11, observações pontuais, não benchmark estatístico.

A dispersão de sábados da 06 aumentou de 40.000 para 42.000 nessa preparação; não se afirma melhora de todos os indicadores nem de cada dia. Não há movimento real cadastrado nessas duas grades. O usuário autorizou pares de folgas quando favorecem cobertura; não se afirma que todos os pares restantes sejam inevitáveis.

## Critério de aceite posterior

Salvar apenas propostas integralmente válidas, sem três OFF automáticas, com déficit por setor e equilíbrio dominical não inferiores ao rascunho comparado, referências e registros protegidos preservados. Usar controle de revisão e manter o estado DRAFT. Não publicar automaticamente nem recalcular outras grades. Confirmar exportações e interação semanal de movimento sem salvar dados de movimento fictícios.

A distribuição permanece uma proposta viável, não ótimo matemático comprovado, cobertura garantida ou certificação normativa. Os desfalques ainda são estimados e dependem da qualidade dos horários e necessidades operacionais informados.
