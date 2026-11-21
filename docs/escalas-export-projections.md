# Contrato candidato das projeções PDF/XLSX

13/11/2026. Clone isolado na base c10602c. Implementação em `web/src/lib/escalas/export-projection-contract.ts`, sem alteração dos handlers, do cache existente ou dos renderizadores do produto. Esta entrega não modifica os arquivos atualmente baixados pelos usuários.

## Conteúdo permitido

O descritor aceita somente metadados canônicos fornecidos pelo servidor após resolver o acesso e a revisão salva. Não é parser do corpo/query HTTP e não autoriza uma projeção solicitada pelo cliente. A decisão BASIC_SCHEDULE/ADMIN_FULL continua pertencendo à política de permissões.

| Projeção e formato | Folgas/horários solicitados | Análises administrativas |
|---|---|---|
| BASIC_SCHEDULE, PDF | rest, hours ou ambos, conforme pedido autorizado | Nunca permitidas. |
| BASIC_SCHEDULE, XLSX | rest, hours ou ambos, conforme pedido autorizado | Nunca permitidas. |
| ADMIN_FULL, PDF | rest, hours ou ambos | Permitidas quando houver autorização e dados que as respaldem; o descritor não atesta existência ou validade dos dados. |
| ADMIN_FULL, XLSX | rest, hours ou ambos | Não permitidas: preservar a decisão de remover Capacidade/Desfalques do XLSX também para o administrador. |

`separateSectors` exige o valor booleano false. Não há divisão em seções setoriais neste contrato; a ordenação setor → cargo → horário → nome permanece responsabilidade do modelo/renderizador integrado. Não se modifica aqui a ordenação nem se introduz uma segunda função de classificação.

Modo, formato, projeção, revisão e versão de conteúdo são obrigatórios. Identidades são delimitadas, sem coerção; filiais usam o normalizador existente. Opções ainda não classificadas, inclusive filtros ou lista de colaboradores, são recusadas. Um futuro filtro precisa entrar explicitamente no contrato e na identidade antes de reutilizar cache.

## Identidade e reaproveitamento dos arquivos

A chave é uma tupla JSON com namespace novo, versão contratual, versão de conteúdo, empresa, planejamento, filial canônica, revisão salva, modo, formato, projeção e opção de setores. O namespace não reaproveita entradas do formato antigo. Identificadores com delimitadores não colidem por concatenação.

A versão do contrato é definida no código, sem campo de entrada para sobrescrevê-la. A versão do conteúdo deve vir da versão corrente dos renderizadores integrados; o valor sintético usado nos testes não é uma versão de produção. Regras novas de projeção/identidade exigem incrementar a versão contratual; mudanças de células/conteúdo continuam exigindo a versão de conteúdo correspondente.

ADMIN_FULL e BASIC_SCHEDULE sempre usam chaves distintas, inclusive quando um formato atualmente produzir conteúdo igual. Empresa, revisão, modo e formato também não compartilham bytes. Requisições equivalentes da mesma projeção continuam aproveitando o cache e a geração em andamento já implementados. O descritor e sua lista de seções são congelados para impedir alteração das regras de renderização depois de construir a chave.

Não incluir nome de usuário ou segredo no identificador do arquivo. A autorização precisa ser refeita a cada leitura e entrega, inclusive em cache hit. Revogação não depende de apagar bytes do cache: uma sessão/permissão antiga deve ser recusada antes de recuperá-los. O contrato não consulta nem conserva principal, cookie, autorização ou resultado de um guard.

## Integração ainda pendente

Sequência obrigatória do futuro fluxo:

1. Resolver a identidade atual, empresa e capacidades; validar o recurso da filial no servidor e aplicar os controles de entrada/rate limit existentes.
2. Carregar a revisão canônica solicitada e conferir cenário atualizado, referências, HOURS_ONLY e demais condições atuais de exportação. Não tratar uma proposta não aplicada como grade salva.
3. Resolver a projeção efetiva com a política de permissões; o perfil informado pelo cliente nunca substitui essa resolução. Construir o descritor com a empresa, filial e revisão carregadas, sem copiar esses metadados arbitrariamente do request.
4. Aplicar a projeção antes de montar o modelo. Para BASIC_SCHEDULE, não calcular nem incluir análises restritas ou dados pessoais desnecessários. Uma chave separada não remove informações que um renderizador completo já incluiu.
5. Consultar o cache com a chave do descritor. Gerar usando as mesmas seções e restrições congeladas; conferir novamente acesso atual antes de entregar após uma geração demorada. Preservar os limites, validações e cabeçalhos existentes.

Os renderizadores existentes ainda não consomem este contrato. Seus arquivos atuais não estão certificados como projeção básica por esta entrega. A integração depende da revisão consolidada do Central, testes reais de sucesso das rotas, guards antes do cache e conferência dos arquivos finais.

Aceite futuro em PDF e XLSX deve inspecionar páginas, abas, células, texto e metadados: ausência de análises e de dados fora do escopo no básico; ausência de Capacidade/Desfalques em todo XLSX; análises PDF somente com respaldo; datas, totais e horários coerentes com a mesma revisão; troca admin/operador, mudança de filial/revisão e revogação durante download. Conferir também o caso HOURS_ONLY sem fabricar presença e a ordenação sem seções.

## Evidência desta etapa

Com Node 24.22.1 e dependências já existentes: 43 testes aprovados em três arquivos, sendo 18 novos de contrato/cache, 5 do cache existente e 20 de permissões. Os testes novos usam o cache real, com Prisma substituído por um objeto vazio; não consultam banco. Conferem as duas ordens de geração admin/básico, geração simultânea e reaproveitamento exclusivo da mesma projeção. O lint dos dois novos arquivos passou sem avisos e o TypeScript da aplicação inteira passou sem emissão/incremental.

Revisão independente estática aprovada, sem defeito concreto ou lacuna bloqueante nesse recorte. O revisor não executou testes nem alterou arquivos. Não houve build, quality/E2E de liberação, migração, alteração de rota, commit, push ou implantação.

O usuário escolheu aguardar um ambiente de testes existente para a migração. Não será instalado ou preparado um novo PostgreSQL nesta frente; o candidato SQL continua sem execução e a liberação de banco permanece separada deste contrato de conteúdo.
