# SolverForge — revisão e ensaio controlado de dezembro

## Revisões

- Candidata: `34b5c35c0b2d8a716aad7f0f17a43364d961fd00` (árvore `91f1929bdfac69c11d1c752d6ed98eb460d71410`), na branch local `experiment/solverforge-consolidado-2026-11-26`. Inclui o avanço `c9791a388712a1d8764d0afbbe035966f5ff16ec`. Upstream Rust: v0.31.2, `78889c3ff9fda158c70e6a1f67f8c7f0fdae922e`.
- Controle: OR-Tools `f78c691edbeaf16283f534bcacd8db1b4b7d5e66`, pacote `9.15.6755` com hashes do projeto, avaliador TypeScript congelado no mesmo commit. Imagens diagnósticas locais, não imagens de produção.

## Contratos históricos

As matrizes [regras](solverforge-revisao-contratos-regras.csv) e [cobertura](solverforge-revisao-contratos-cobertura.csv) cobrem exatamente as 328 chaves históricas que estavam pendentes em `074d299`, sem sobreposição: 112 de regras, 216 de cobertura. Elas ligam cada chave ao teste histórico, domínio e prova ainda necessária. Na parte de regras, as 26 baixas já presentes no avanço remoto tiveram o hash da origem e o destino conferidos: 22 portas Python e 4 Rust. Há **302 contratos abertos**, 117 P0 e 185 P1 na triagem. Nada foi abatido do inventário por revisão estática.

Dois pontos que demandam reprodução focal antes de aceitar uma migração:

1. `temporal.rs` hoje deriva o catálogo de setores da equipe e pode rejeitar uma demanda de setor sem pessoa (`DEMAND_SECTOR`). O contrato histórico separa desfalque de erro de catálogo. Criar casos separados para estimativa sem equipe (avisar) e mínimo confirmado (não inventar cobertura nem enfraquecer o piso), sem confundir cargo vizinho com equipe elegível.
2. `temporal/service_bounds.rs` limita o número de partições de cobertura, mas não recebe o prazo interno. Provar interrupção durante a construção, mensurar custo em recortes largos e conferir que time-out ainda é inconclusivo.

## Método do ensaio

Uma leitura transacional, somente leitura, selecionou os rascunhos de 01 a 31/12/2026: 01/r7, 02/r16, 06/r14, 07/r14, 08/r11, 10/r4, 11/r14, 16/r4 e 18/r9. Identificadores pessoais, nomes, matrículas e textos livres foram mascarados antes de a entrada sair do servidor. Não se persistiram payloads ou grades. A comparação é sobre as revisões fixadas, sem aplicar alterações recentes da base global por fora da revisão nem abrir o fluxo produtivo.

O mesmo cliente e avaliador do controle capturam e verificam o envelope byte a byte para os dois motores. A semente e os dados avaliados são os mesmos por par; pseudônimos podem alterar empates em relação à produção. Cada motor usa um contêiner amd64 descartável, sem rede externa nem volumes de dados, com 1 CPU, 1536 MiB e 64 PIDs. HTTP autenticado é exercitado apenas no loopback com credencial efêmera do ensaio. O resultado publicado é agregado, não contém escala. Uma observação por cenário serve para diagnóstico, não para estimar P95 ou afirmar ganho de velocidade.

Foram preparados os três modos das nove filiais. Em 01 e 10, `HOURS_ONLY` é consulta de referência no fluxo oficial, sem motor a comparar. O ensaio tem até 25 pares efetivos. Retenção da referência, proposta reconstruída no cliente, time-out e `UNKNOWN` não são vitórias nem prova de inviabilidade. Cobertura comparada entre motores exige proposta nova, válida e atribuível ao motor em ambos os lados. O pareamento não autoriza nenhum salvamento.

## Resultado da qualificação e do pareamento

- **ARM64/musl:** Rust 1.100.0, binário ELF64 estático AArch64, executado em QEMU 8.2.2 sobre host amd64. Passaram 189 testes Rust, Clippy estrito e, na rodada final, 39 testes Python/HTTP, com o binário real para os casos de integração. SHA-256 do binário: `ca8ad0f4ff0e5999b2d2c313cd7fe15f5f49a5b515d982f29f4b19b15ed50cfe`. A primeira rodada HTTP expôs uma corrida do teste ao ler `/proc` durante a coleta do processo filho. Corrigida a sonda, mantendo a exigência de que um filho ainda ativo falhe. Passaram também 24 repetições isoladas desse teste. Essa prova emulada não substitui qualificação nativa de produção, nem mede desempenho.
- **Bancada:** o avaliador filtrava as respostas HTTP 422 e 502 antes de classificá-las. A correção admite esses estados, mantém a validação de corpos, tetos e critérios de qualidade, e preserva o código real. Duas novas verificações passam. Controles válidos foram mantidos por hash idêntico; quando havia divergência do envelope ou falha de transporte, ambos os motores receberam o mesmo envelope recapturado.
- **Dezembro:** [resultado por filial, revisão e modo](solverforge-ensaio-dezembro-resultado.csv). Dos 27 cenários, dois não chamaram um motor e 25 produziram evidência de ambos. O resultado final do controle foi válido e completo nos 25: 20 respostas rotuladas como nova proposta pelo cliente, das quais três cumpriram também o critério de atribuição direta ao motor; houve cinco retenções da referência. O SolverForge retornou `HTTP 422 / SOLVER_UNSUPPORTED_INPUT` nos 25. A reprodução nativa local do mesmo envelope, usada apenas para diagnóstico, identificou `MAPPING / POLICY` em todos. **Zero pares permitem comparar cobertura ou velocidade.** A resposta rápida de rejeição não é ganho de desempenho.
- **Causa:** os nove rascunhos têm `calendarMode=LOCAL`, `normativeProfile=CUSTOM` e calendário já preenchido. O [leitor Rust](../../web/experiments/escalas-solverforge/src/temporal.rs#L447) aceita `MANUAL` nessa guarda, excluindo `LOCAL` antes da busca. Não se converteu calendário nem flexibilizou nenhuma regra para fazer a bancada avançar. A leitura final confirmou as mesmas nove revisões em rascunho.
- Ambas as imagens diagnósticas amd64 usam `python:3.13.18-slim-bookworm` no manifesto `sha256:f0fa218d5b06f9b9235024fa061cde2cb141f726de52134471053d2d9b5324a3`. O controle é `sha256:f81a4887810af5b83b38238eac84082c1c5f67bd7563ce53611b00f06d369ffe`; Forge, `sha256:f13c305bce150f6db375af1d4153f32b90dd4612dff094a719a7cc824ab53c04`. O contexto copiou o upstream Git verificado para o laboratório (o clone dentro do contêiner falhou por rede). Nenhuma dessas imagens foi implantada.

**Decisão: não migrar.** Primeiro portar o contrato `LOCAL` usando as datas já resolvidas pelo aplicativo; proteger abertura/fechamento, feriados/pagamento, folgas, mínimos e recortes. Cobrir isso com teste de aceitação e com negativos de calendário incoerente. Só então repetir os 25 pares antes de julgar cobertura por setor/cargo/faixa, domingo ou desempenho. Manter o OR-Tools oficial e os 302 contratos pendentes no gate.
