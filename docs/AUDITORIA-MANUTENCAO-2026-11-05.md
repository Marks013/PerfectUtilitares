# Auditoria de manutenção e desempenho — 05/11/2026

Base inspecionada no servidor: `7f0769e`. Escopo: dependências e APIs antigas,
manutenção do host, preparação de Escalas e recuperação de senha.

## Achados tratados

- **Manutenção:** a tarefa semanal executava um arquivo gravável pelo usuário
  do projeto como root. Ele podava cache, imagens e contêineres do host
  compartilhado. A instalação passou a executar apenas a limpeza do projeto
  como `ubuntu` e o verificador de recursos instalado no host. O timer foi
  preservado; nenhuma poda foi executada. A limpeza não roda mais no build.
- **Limpeza:** diretórios rotacionados ligados a um destino externo podiam
  causar exclusão fora da árvore. A rotina ignora links simbólicos, verifica
  o caminho real do pai e rejeita configuração inválida antes de remover
  arquivos. Testes usam somente diretórios descartáveis.
- **Publicação:** o sincronizador antigo por staging agora falha explicitamente
  sem copiar nem apagar arquivos. O procedimento documentado usa Git e Compose
  com revisão identificada e não promete redefinir o administrador no seed.
- **Validação:** as chamadas depreciadas de formatos do Zod em login,
  recuperação, Usuários, Jornada e Unimed passaram às APIs atuais. O teste da
  Jornada gera um PDF real usando a rota com um CUID válido e verifica o
  filtro do operador. A recuperação mantém resposta indistinguível para
  endereços desconhecidos e não confirma requisições com falha HTTP ou de rede.
- **Escalas:** o contexto publicado usa um índice por matrícula; as travas e o
  histórico usados na cobertura são indexados por colaborador, preservando
  ordem, precedência e regras.

## Evidência

Benchmark A/B no servidor, com 250 colaboradores, seis semanas e 10.500
atribuições por plano. Sete amostras alternadas; saídas equivalentes por
`deepEqual`. Mede preparação, não o tempo total de geração nem o Solver.

| Etapa | Mediana anterior | Mediana atual |
| --- | ---: | ---: |
| Contexto de histórico publicado | 293,60 ms | 10,66 ms |
| Reservas de dias compartilhados | 272,97 ms | 8,24 ms |
| Estimativa de cobertura | 574,22 ms | 238,72 ms |

- npm audit: zero avisos conhecidos para a árvore npm auditada. As 40
  dependências públicas diretas consultadas no registry não têm flag
  `deprecated` nas versões instaladas. O adaptador SMTP local não é um pacote
  público. Sem mudanças no manifesto de dependências ou lockfile.
- OSV: 38 versões Python fixadas, sem avisos conhecidos.
- Gate de código: 312 arquivos Vitest, 2.401 testes aprovados e três pulados;
  73/73 rotas com cenário funcional; Knip e 391 módulos aprovados.
- Três testes de manutenção verificam retenção, links e configuração inválida.
  O launcher instalado e a unidade foram comparados com os arquivos do Git;
  o timer permanece habilitado. Nenhum serviço de manutenção foi iniciado.

## Limites

Não foi feita atualização em massa por diferença de versão. NextAuth continua
pré-release, sem marca de depreciação na versão instalada. Presenças e Sentry
ficaram fora da intervenção. As auditorias consultam avisos conhecidos; não
certificam ausência de vulnerabilidades desconhecidas.
