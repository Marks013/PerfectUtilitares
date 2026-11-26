# Auditoria incremental do candidato SolverForge E2-SF1

Escopo: PR #75, revisão de partida 811ec15dc7aea682c200d068cdf0ac5b884f99e3; OR-Tools f78c691edbeaf16283f534bcacd8db1b4b7d5e66, Timefold E2.5 71945cd6e73c48b424dab1297fbc3bf8a15ae585. Nenhuma alteração de main, servidor, PostgreSQL, Compose produtivo ou PR #74.

## Achados e intervenções

| ID | Evidência/risco | Intervenção | Estado |
| --- | --- | --- | --- |
| SF01 | [CI 45739664460](https://github.com/Marks013/PerfectUtilitares/actions/runs/45739664460): E0277 em penalize com score local; demais erros anteriores não reapareceram | Usar fixed_weight da API pública para peso constante; manter adapter de nove níveis | CI pendente |
| SF02 | model.rs acumulava enumeração, agregação, validação e construção | Separar patterns, coverage e seed mantendo corpos funcionais e fachada | Equivalência textual; compilação pendente |
| SF03 | Mapper podia ignorar monthlyCarry, carriedHolidayRest, ausência manual, origem de calendário e liderança manual | Recusar explicitamente metadados não modelados e IDs duplicados de demanda; verificar deadline por banda | Testes negativos adicionados; CI pendente |
| SF04 | p50 de seis amostras usava nearest-rank inferior; medianas independentes não são deltas pareados | Mediana verdadeira, máximo (sem p95), deltas e redução por par válido, zero baseline sem porcentagem | Testes Python adicionados; CI pendente |
| SF05 | OSV consultou 52 dependências alcançáveis sem match em 45739664460, mas não cobre stdlib, musl, compilador; RustSec histórico anyhow 1.0.102 no lock total | Manter gate e achado, auditar grafo e cadeia de build antes de adoção | Aberto |
| SF06 | Domínio pessoal com até 50.625 padrões brutos em 4 semanas; clone de ranges por pessoa e recomputação do setor por movimento | Medir custo real de mapeamento, seed e busca antes de alterar representação/cache. Não extrapolar para 6 semanas | Aberto |
| SF07 | Modelo parcial não cobre 16 objetivos, ausências, dezembro, relógios variáveis, liderança completa, histórico/futuro e demais modos | Recusar escopos não suportados e manter validador original. Expandir somente depois do smoke e da qualidade E2 | Aberto |
| SF08 | Seed-only executado depois dos três motores; tempo sofre possível efeito da ordem | Diagnóstico separado, não atribuir ganho causal amplo; futura ablação balanceada com mesma seed, orçamentos 2/4/8/12 s e holdouts | Aberto |

## Sequência de aceitação

1. Cargo locked/offline e testes de integração do solver nativo, incluindo score recomputado.
2. Smoke ARM64 com três motores e imagem estática verificada, sem acesso a rede durante solve.
3. Seis ordens dos três motores nos três casos E2, com métricas de cobertura por setor, veto de proteção, CPU, latência e memória; pares inválidos não contam como ganho.
4. Comparar construtor com busca real, corrigir somente gargalos medidos, sem alargar CPU/RAM. Depois portar regras E3 e executar holdouts E4 com amostra suficiente.
5. Avaliação de segurança e operação separadas. Nenhum merge ou deploy; nenhuma certificação de superioridade neste recorte.

A medição usa o mesmo 1 CPU/1536 MiB/64 PIDs e prazos 12/18/20 s. A referência do produto, o verificador independente e os SHAs de controle permanecem congelados. Resultados sem paridade completa não justificam troca.
