# Folgas explícitas e fechamento dominical da Filial 02

Base: main `57e0941db3af6c361eeb6af717812e48e665a11d`, após integração do PR #36 com CI aprovada.

## Contrato operacional v3

Novas gerações ativam `restRulesVersion: 3`. Revisões anteriores continuam legíveis;
publicações históricas não são reinterpretadas. A regra é operacional informada
pelo usuário, não uma declaração de obrigação legal geral.

- Filial numérica 02 (inclusive 2/002): domingos fechados no mês e nas fronteiras
  civis necessárias. Domingo comum é OFF, não feriado remunerado. Não habilita
  folgas fixas pessoais. Ausência e feriado verdadeiro mantêm suas classificações.
- Cada pessoa pode cadastrar dois controles `{enabled, weekday}` independentes.
  Desativar mantém o dia. Só a edição explícita projeta os controles para
  `offMode`/`fixedOffDays`; a geração e a reimportação não os habilitam.
- Duas folgas comuns não podem repetir os mesmos dias em TODAS as semanas
  completas comparáveis, quando a organização é variável e há pelo menos duas
  dessas semanas. Repetições ocasionais são permitidas; não há obrigação de
  alternar cada semana. A checagem usa o mesmo domingo-sábado do planejamento.
- Semanas com ausência, feriado, dia bloqueado ou vínculo parcial não viram
  oportunidades de rodízio. Semanas com dias de fechamento diferentes são
  comparadas separadamente. Dois dias impostos por configuração/fechamento ou
  consecutivas obrigatórias explicitamente solicitadas não são fixação automática.
- Se outras restrições impedirem qualquer variação, o resultado será conflito,
  não uma escala repetitiva disfarçada como variável nem um relaxamento silencioso.
  Deve-se revisar a demanda/restrição ou aprovar explicitamente a configuração fixa.

O limite de dois descansos, a jornada, os intervalos, a proibição vigente de folga
comum no sábado, os bloqueios, a cobertura obrigatória e o orçamento permanecem.
Duas folgas pessoais sem domingo na Filial 02 podem exigir três descansos e gerar
conflito. O cadastro avisa; não remove automaticamente uma escolha.
HOURS_ONLY não redistribui dias. Trabalho dominical incompatível deve ser corrigido
em geração que permita folgas, sem desbloqueio automático.

## Integração

Python aplica fechamento antes do modelo, valida os controles no serviço e na
chamada direta, restringe padrões antes da viabilidade e recusa sugestões já
repetitivas. TypeScript faz validação independente, preserva serialização e
inclui os controles na assinatura existente do cenário. O Docker copia o módulo
Python utilizado. Não há coluna nova nem migração destrutiva: o cadastro permanece
no JSON versionado existente, com compatibilidade de leitura do legado.

## Evidência e liberação

Local: 9 testes Python puros, 24 testes do instalador, sintaxe Python, typecheck
estrito dos módulos TypeScript puros e paridade de 256 configurações/441 pares
semanais. A paridade inclui um oráculo independente de igualdade de pares.
Esses testes NÃO equivalem a executar OR-Tools ou a aplicação completa.

Novos testes normais do projeto cobrem CP-SAT real, verificação TypeScript,
componente e E2E de cadastro/gravação/reabertura dos quatro estados. Seus resultados
precisam ser conferidos no SHA da CI. Não se antecipa aprovação aqui.

O kit de dez perfis fica em `tools/agent-toolkit`, com fontes fixadas e instalação
isolada na CI. Arquivos instalados não registram automaticamente MCP/hook no host.
Não houve acesso ao servidor ou ao banco de produção. Deploy exige o gate e o
recibo local definidos em AGENTS.md. Nenhuma revisão salva muda por efeito do deploy.
