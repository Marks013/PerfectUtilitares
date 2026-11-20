# Método de medição: solver, frontend e MediaPipe

**Sem métricas inventadas.** Este documento define como coletar medidas comparáveis. Não afirma ganho de performance.

## Solver (A08)

- Comandos existentes em `web/`: `npm run benchmark:escalas` (dados sintéticos) e `npm run benchmark:escalas:real` (dados importados apenas quando autorizados). Inspecione os scripts antes de executar; eles usam Docker e podem processar fixtures de RH.
- Fixar git SHA, imagem/digest, Node, Python, OR-Tools, host CPU/memória, workers, seed, horizonte, número de pessoas, tempo-limite e repetição.
- Medir por cenário os tempos p50/p95, pico RAM, status FEASIBLE/OPTIMAL/UNKNOWN, taxa de timeout, falta de cobertura em pessoas-minuto, setores vazios, distribuição dominical, desvios por pessoa e preservação de bloqueios.
- Usar os **mesmos dados, recursos e regras** para baseline e candidato; mudanças de semana ou vigência não são comparações simples.
- Não registrar nomes, matrículas, horários reais ou ausências individualizadas em artifacts públicos.

**Portão de desempenho:** nenhuma nova opção de otimização até obter baseline reproduzível; regressão de cobertura ou validação independente reprova a mudança mesmo quando o tempo melhora.

## MediaPipe (A11)

Inventário estático na árvore auditada:

| Asset | Tamanho aproximado |
| --- | ---: |
| `vision_wasm_module_internal.wasm` | 11,76 MB |
| `vision_wasm_internal.wasm` | 11,76 MB |
| `vision_wasm_nosimd_internal.wasm` | 10,96 MB |

Antes de trocar carregamento ou remover variantes, registrar waterfall do browser na primeira visita ao dashboard, fotos, PDF e escala em mobile/desktop; verificar quais variantes realmente são pedidas e política de cache. Testar SIMD e fallback não SIMD, redes lentas e entrada em fotos. Bytes versionados no Git não equivalem a bytes baixados em cada rota. Manter a mesma compatibilidade até existir evidência de medição.
