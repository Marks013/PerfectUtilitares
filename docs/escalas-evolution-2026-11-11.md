# Escalas: auditoria e evolução de 11/11/2026

## Escopo e decisões

Referência: `ee815cd26fd8c6557f3228482338338d8288e91f`. Trabalho no servidor, sem alterações em outros módulos, dados históricos ou revisões publicadas. A autorização posterior permite commit, push, implantação e inspeção de duas grades: 06/dezembro e 11/novembro. A geração não publica automaticamente.

CCT e documentos são referências informativas, inclusive para publicação interna. Não há certificação jurídica automática nem autorização documental inventada. Permanecem os limites operacionais de jornada, descanso, dias fechados, afastamentos, bloqueios e horários importados compatíveis. A jornada mista continua opcional.

## Registro de achados

| Classe | Evidência anterior | Correção |
|---|---|---|
| Defeito comprovado | FPRE136 zerado classificado como MISSING, mas apresentado como ENC | Classificador canônico; quatro zeros viram UNTIMED somente em nova importação |
| Defeito comprovado | Matrícula existente impede reimportação | Prévia de conciliação e seleção explícita dos campos de origem |
| Inconsistência de negócio | Documentos e vencimento da CCT impedem uso interno | Referências informativas; limites numéricos preservados |
| Defeito comprovado | HTTP 400 do Solver apresentado como indisponibilidade | Erros separados para entrada inválida, falha interna, limite, cancelamento e timeout |
| Defeito comprovado | Mês inicial usa UTC | Mês de America/Sao_Paulo, com testes na virada local |
| Defeito comprovado | E2E procura seletor removido e registra espera depois da ação | Filial/Ano/Mês e espera de salvamento antes da ação |
| Defeito comprovado | CI executa navegador duas vezes e condiciona testes de código ao Chromium | Jobs separados; execução única do navegador |
| Defeito comprovado | Benchmark chama candidato experimental de produção atual | Snapshot da revisão de referência e do código real, com hashes |
| Limitação conhecida | Falha de viabilidade genérica | Diagnóstico suficiente por família, com assumptions e prazo limitado |
| Melhoria implementada | Liderança global por cargo, sem responsabilidade ou movimento | Responsabilidade explícita e prioridade opcional por setor/período |
| Melhoria implementada | Indicadores misturam capacidade potencial e presença | Contas separadas de capacidade nominal, disponibilidade conhecida e escala efetiva |
| Já resolvido | HTTP 413 interpretado como indisponibilidade | Mantida a proteção de 8 MiB e suas regressões; não houve aumento |

A API mantém 4 MiB para salvar/validar entradas. A chamada de geração usa identificador/revisão e envia ao Solver o cenário já carregado. O transporte interno mantém 8 MiB, inclusive preflight UTF-8. Os limites têm finalidades distintas.

## Preservação e contratos

- Novos campos `leadership` e `movementPriorities` são opcionais. Sem prioridades, não se presume movimento maior no fim de semana.
- Gerente não cobre a liderança de outro setor sem responsabilidade explícita. DUTY/ENC nunca cria cobertura horária.
- Reimportação mantém identificadores, decisões manuais, férias, bloqueios e histórico. Ausência no arquivo não significa desligamento.
- A escolha de atualização de horários é separada da atualização de nome, cargo e setor. Referências bloqueadas incompatíveis não são substituídas.
- Nenhuma revisão antiga é reclassificada ao ser lida. A geração preserva ausências e trabalho protegido.
- A política compartilhada contém as datas e limites existentes, sem pesquisa normativa externa ou alteração incidental de valores.
- Respostas incluem tempos por etapa, fases executadas e famílias de conflito sem nomes, matrículas ou payload pessoal.
- Um conflito suficiente não é apresentado como conjunto mínimo. UNKNOWN, INFEASIBLE, FEASIBLE e OPTIMAL permanecem distintos.

## Baseline e regressões

Vitest antes das mudanças: 338 arquivos, 2.751 testes aprovados e 3 ignorados, em 92,92 s.
Python antes das mudanças: 233 testes, com 2 falhas e 9 erros preexistentes em fixtures/expectativas que não acompanhavam os ajustes anteriores de disponibilidade e warm start. Esse resultado foi registrado antes de editar Python.

Foram reproduzidos primeiro os defeitos de classificação, reimportação, publicação documental, transporte e diagnóstico. Os testes documentais foram atualizados porque houve mudança expressa de produto; as proteções numéricas e de integridade continuam exercitadas.

Python integrado: 274 testes aprovados em 89,211 s. As regressões exercitam os módulos de produção, não candidatos. Os dois arquivos experimentais foram removidos após migrar seus consumidores; continuam recuperáveis pelo Git.

PDF/XLSX: testes de leitura real verificam ordenação, setores separados, legenda, ausência de duplicações e limites do papel. A inclusão da disponibilidade revelou avanço de 0,52 ponto além da margem de teste; a quebra de linha foi corrigida sem ampliar o papel ou remover conteúdo.

## Benchmark comparável

Dados sintéticos, mesmos inputs e hardware ARM64 de quatro núcleos, execução sequencial, memória limitada a 1536 MiB, cinco medições por cenário e variante após aquecimento. A validação TypeScript é independente da solução Python. Métrica: pessoas-minutos de cobertura estimada não atendida, não demanda real confirmada.

| Pessoas / horizonte | Baseline: mediana / p95 (s) | Corrigido 1 núcleo: mediana / p95 (s) | 2 núcleos: mediana / p95 (s) | Déficit baseline / corrigido / 2 núcleos |
|---|---|---|---|---|
| 10 / 1 semana | 11,903 / 11,903 | 11,903 / 11,903 | 0,151 / 0,170 | 0 / 0 / 0 |
| 50 / 4 semanas | 8,722 / 8,735 | 8,742 / 8,754 | 4,400 / 4,837 | 2.520 / 2.520 / 2.520 |
| 115 / 6 semanas | 12,052 / 12,062 | 12,044 / 12,049 | 12,002 / 12,044 | 4.032 / 4.032 / 66.024 |

Todas as 60 medições válidas (incluindo linearização 1) retornaram FEASIBLE, sem erro no verificador independente ou setor inteiro em folga com duas pessoas disponíveis. Não é prova de ótimo global. Na versão corrigida com um núcleo, os indicadores de domingo e os déficits por setor permaneceram equivalentes ao baseline.

Dois núcleos foram rejeitados: pioraram cobertura no maior cenário e elevaram o pico de memória, de 298.472 para 338.052 KiB. A versão de um núcleo atingiu aproximadamente 292 MiB no maior cenário. Linearização 1 também foi rejeitada: o déficit mediano foi 5.040 no cenário médio e 76.608 no maior. A simetria foi medida separadamente, sem ganho que justificasse adotá-la. Permanecem um núcleo, linearização 0, simetria 0 e um cálculo simultâneo; os limites de produção não foram alterados.

Hashes do snapshot Python comparado: baseline `ceb77c9ba120ba77b517870b18ecb4d3a342219bef1ba5e18224ee14d3d29173`; corrigido `6d6b246186e0a6786954535252cd99ee302167e34cdb7839f0f216801735b838`. A estabilidade é medida contra a mesma grade de aquecimento da referência, não contra uma entrada vazia. Nos cenários de 10 e 50 pessoas, baseline e corrigido mantiveram as mesmas marcações. No maior, as medianas de dias alterados foram 394 e 420, com cobertura equivalente: resultados sob prazo de relógio não são determinísticos. Dois núcleos alteraram 1.094 marcações no maior cenário.

O benchmark sem prioridades mede também dias sem liderança como indicador, mas não afirma tê-los otimizado. A melhoria de liderança foi validada por regressões específicas com prioridades explícitas e alternativa viável, preservando déficit por setor e equilíbrio dominical.

A primeira montagem sintética manteve um horário manual de 44h diante de um alvo de 42h e resultou em inviabilidade coerente. Essas medições foram descartadas. A referência sintética de importação foi então fornecida explicitamente, permitindo a adaptação normal; o benchmark passou a rejeitar aquecimento inviável.

## Dependências e limites restantes

OR-Tools 9.15.6755 e sua closure com hashes foram preservados. Hypothesis e Ruff são ferramentas de desenvolvimento, em alvo separado, sem inclusão no runtime final. Não foi acrescentado validador de terceiros em produção.

Demanda real por hora/setor e substituição entre funções continuam como melhorias opcionais: não há arquivo de movimento real ou matriz de habilidades fornecida para validá-las. O algoritmo não transforma prioridades de liderança em demanda de pessoal.

## Verificação integrada

`npm run quality:code`: Prisma, TypeScript, lint, 47 testes operacionais, 343 arquivos Vitest com 2.777 testes aprovados e 3 ignorados, análise de código não usado, tamanho de módulos e 73/73 rotas com cenário funcional aprovados. A cobertura global, incluindo interface, foi 68,44% de linhas, 66,63% de statements, 62,91% de funções e 60,49% de branches; não é comparável diretamente a relatórios antigos sem interface.

`npm run test:escalas:python`: 274 regressões aprovadas; após ampliar a validação de campos opcionais, quatro testes de payload também passaram. Ruff aprovado. Verificação independente Python×TypeScript: 21 cenários fixos e 30 gerados por Hypothesis aprovados. Os gerados não duplicam os 21 fixos. Compose validado com acesso normal aos arquivos protegidos.

A revisão final da interface reproduziu e corrigiu responsabilidade inferida desatualizada após edição de cargo/setor; nove testes específicos, TypeScript e lint passaram. A primeira descoberta do E2E revelou atributo de importação JSON ausente, corrigido no módulo compartilhado; nenhuma espera foi ampliada para ocultar a falha.

O navegador executou os dois cenários operacionais de Escalas com sucesso em 1,4 minuto: horários reais persistidos, cobertura por faixa, exclusões, pausa opcional, isolamento entre planejamentos, telas de 375/768/1280 pixels e leitura das exportações folgas/horários/completo. O ambiente de verificação descartável foi encerrado pelo runner; nenhuma credencial ou base de produção foi substituída.

As medições são de cenários representativos, não prova de desempenho universal, ótimo matemático ou conformidade legal. A entrega deve registrar separadamente a construção, implantação e inspeção autenticada das duas grades. Nenhuma grade publicada é sobrescrita pela inspeção.
