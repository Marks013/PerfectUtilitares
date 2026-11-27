# SolverForge — contrato de telemetria v1

## Bloqueio corrigido

Na [rodada de calendário LOCAL](SOLVERFORGE-CALENDARIO-LOCAL-2026-11-27.md), o SolverForge devolveu 25 resultados brutos viáveis, todos rejeitados em `result-schema`: o cliente exigia o formato do CP-SAT. O contrato agora aceita duas variantes estritas. O formato do OR-Tools permanece inalterado. O SolverForge declara versão 1, o método limitado, tempos agregados medidos, níveis do escore e se o candidato nativo foi aceito. Não inventa orçamento por nível, tempo de busca por nível, total de liderança nem prova de ótimo global.

O cliente trata o diagnóstico nativo somente quando a resposta também declara `FEASIBLE`; desconhecer uma versão, receber uma alegação de ótimo ou receber campos de outro contrato continua sendo erro. Completude, proteção dos dias e validação independente da grade continuam obrigatórias. A interface distingue solução inicial, busca que reteve essa solução e refinamento aceito, sem apresentar pontuações como fases independentes.

## Evidência

- 172 Vitest do cliente e da interface, TypeScript, lint focal, limite de módulos e `git diff --check` aprovados. No Vitest Windows, somente a permissão POSIX do arquivo de teste sintético foi emulada; o guard produtivo não mudou.
- Três testes nativos de metadados Rust passaram em AMD64, com Rust 1.100.0 e dependências fixadas, compilação offline. Imagem diagnóstica `sha256:0740f835de9d459d64a63d1c531570dc9ba7ea7e93fa63f22e6f0ce77f2b5770`. A prova ARM64 anterior cobre o calendário LOCAL, não esta revisão.
- Teste de ida e volta em memória: 12 pessoas sintéticas, 01–31/12/2026, calendário LOCAL, folgas e horários. Mesmo envelope SHA-256 `b20ca4a4161809e5b3f70cca89b22f2dfacfa7960c1c58f9e4a8b23d50682000`, comparador do projeto e cliente corrigido. Ambas as imagens foram executadas por HTTP local em contêineres descartáveis sem rede externa, com 1 CPU, 1536 MiB e 64 PIDs, sem banco ou volumes.

| Motor | Resposta | Aceite pelo cliente |
|---|---|---|
| OR-Tools (`f78c691`) | HTTP 200 / FEASIBLE | Nova proposta válida e completa |
| SolverForge v1 | HTTP 200 / FEASIBLE; 13 níveis declarados; sem prova de ótimo | Nova proposta válida e completa |

## Gate seguinte

A prova fecha a incompatibilidade do transporte para a amostra; não mede superioridade, não certifica equivalência operacional e não valida a imagem final em ARM64. Repetir os 25 pares das nove filiais com a mesma entrada em cada par e com as revisões reconfirmadas. Se houver nova rejeição, separar incompatibilidade de entrada, qualidade da grade e esgotamento de busca antes de portar a regra correspondente. Entre os riscos ainda abertos, distinguir estimativa de demanda sem equipe de mínimo confirmado impossível: a primeira precisa continuar visível como desfalque; o segundo não pode ser descartado.

Continuam abertos os 302 contratos históricos (117 P0 e 185 P1). Nenhuma escala real foi acessada, gravada ou publicada nesta rodada. OR-Tools continua sendo o motor de produção.
