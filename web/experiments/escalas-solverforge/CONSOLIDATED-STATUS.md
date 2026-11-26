# SolverForge: branch consolidada de desenvolvimento

Data: 2026-11-26.

Branch: `experiment/solverforge-consolidado-2026-11-26`.
Base integral: `ce0293f22eb67ab67ef4196a0d5518db48b46162`, HEAD do PR #75 no momento da criação.

## Conteúdo preservado

A branch parte do commit completo, não de uma seleção de arquivos. Preserva todo o histórico e todas as alterações do candidato SolverForge publicadas no PR #75 até essa base, incluindo os contratos temporais, as proteções operacionais, os reparos dominicais, os testes e as verificações de CI existentes.

A consolidação acrescenta a correção de inicialização abaixo e este registro. Não reescreve histórico, não atualiza a branch original do PR #75 e não faz merge ou deploy. Main, Timefold #74, produção, comparadores, cenários externos, dependências e Cargo.lock não foram modificados por esta consolidação.

## Correção acrescentada: referência inicial de HOURS_ONLY

Em `src/temporal/seed.rs`, `initialize_unchanged` tenta aproveitar escolhas legais únicas sem alterações antes de criar outra escala inicial. O conjunto precisa passar pela avaliação global de viabilidade. Escolhas já admitidas são preservadas; entradas ambíguas, inviáveis ou fora do prazo não são tratadas como referência. A operação não cria bloqueios e mantém os domínios disponíveis para a busca nativa.

O defeito reproduzido era a construção de uma alteração de horário desnecessária, seguida da proteção do serviço criado por essa alteração. Isso impedia a busca de retornar à grade legal recebida, que já atendia à demanda.

Foram acrescentados quatro testes Rust: grade exata do cenário HOURS_ONLY, grade globalmente inviável sem mutação, entrada ambígua sem referência inventada e preservação de prazo/escolhas iniciais.

Blob testado de `src/temporal/seed.rs`: `2daa27484a46d5941e3e7088bfaae42c801b938f`.
SHA-256: `11c652a3ac53c0062255da7e99b9bb5c3325a88d2565bdd38a4605b63985a9ac`.

## Verificação executada nesta consolidação

Ambiente: laboratório Linux x86_64/gnu isolado, Rust 1.100.0, upstream SolverForge `78889c3ff9fda158c70e6a1f67f8c7f0fdae922e`, Cargo.lock preservado. Não é o runner ARM64/musl da qualificação oficial.

| Verificação | Resultado observado |
|---|---|
| Base publicada, testes Rust | 85 aprovados |
| Reprodução Rust com a chamada de inicialização desativada | O teste HOURS_ONLY falhou: alterações `[1, 1]`, esperado `[0, 0]` |
| Candidato completo, testes Rust release | 89 aprovados, zero falhas, zero ignorados, zero filtrados |
| Testes Python existentes | 45 aprovados |
| Clippy release, todos os alvos, `-D warnings` | Aprovado |
| Build release | Aprovado |
| `git diff --check` e comparação do lock | Aprovados |
| Cenário HOURS_ONLY pelo cliente e comparador originais, uma execução local | Respostas bruta/final válidas; `engineNew=true`; comparação e seleção `ACCEPTED`; sem regressão; zero pessoas/atribuições alteradas |

A busca nativa foi executada. O resultado desse caso foi `SEED_RETAINED`: preservação da solução inicial legal, não melhoria atribuída à busca. A medição local foi 2,053 s e não constitui qualificação de desempenho.

Comandos centrais, após preparar a cópia oficial com `prepare_workspace.py`:

```sh
cargo +1.100.0 test --locked --release --manifest-path "$WORKSPACE/Cargo.toml" -p perfectutilitares-solverforge-spike
cargo +1.100.0 clippy --locked --release --manifest-path "$WORKSPACE/Cargo.toml" -p perfectutilitares-solverforge-spike --no-deps --all-targets -- -D warnings
cargo +1.100.0 build --locked --release --manifest-path "$WORKSPACE/Cargo.toml" -p perfectutilitares-solverforge-spike
python3 -m unittest discover -s web/experiments/escalas-solverforge -p 'test_*.py'
```

## Pendências mantidas explícitas

A base `ce0293f` reprovou a qualificação ampliada na execução GitHub Actions `45903854175`. As falhas anteriores por cargo/faixa nos cenários de feriado/histórico e combinados, a presença diária com vigência parcial, a cobertura de dezembro e os vetos dominicais de escala fixa continuam exigindo correções e novas medições.

O novo código ainda não tem qualificação ampliada ARM64/musl nem comparação completa de 32 repetições. Os testes unitários e o cenário local HOURS_ONLY não demonstram eliminação integral das regressões, paridade funcional ou aptidão para substituir o OR-Tools em produção.

Nenhum critério foi afrouxado. Nenhum resultado de laboratório substitui um resultado obrigatório da CI. Não foi aberto um novo PR nem movida a referência do PR #75 nesta consolidação.
