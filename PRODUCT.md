# PerfectUtilitares — Escalas

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

O administrador atual controla o módulo completo. Operadores das filiais terão acesso somente às filiais e ações atribuídas. O usuário confirmou que as equipes das filiais são leigas, sem experiência com lógica ou opções técnicas; pediu uma interface orientativa, intuitiva e menos espalhada também para o administrador.

## Product Purpose

Organizar e editar escalas, horários e folgas de cada filial, gerar/recalcular propostas respeitando as regras configuradas e emitir documentos da revisão correta. O sucesso é concluir tarefas recorrentes com contexto e consequência claros, sem precisar entender a implementação do Solver.

## Operating Context

O planejamento envolve filial, período, equipe, horários, folgas, revisão salva e geração de arquivos. O projeto já possui Next.js/React, CSS Modules, controles e ícones; a mudança é dentro desse produto existente. A frente atual usa um clone separado e precisa reconciliar sua implementação com a revisão consolidada do Maestro Central.

## Capabilities and Constraints

- O administrador mantém conta, autenticação e acesso completos.
- A página /escala terá entrada por nome cadastrado. O usuário aceitou que isso separa a navegação e não comprova identidade pessoal.
- Operadores podem gerar/recalcular, editar horários/folgas e usar cadastros/turnos permitidos no seu escopo, com as regras administrativas preservadas.
- Importações, TXT de integração, análises gerenciais e configurações protegidas permanecem administrativas. PDF/XLSX básicos de folgas e horários são permitidos.
- Nenhum XLSX inclui Capacidade/Desfalques. PDF administrativo mantém análises autorizadas quando houver dados suficientes.
- O layout deve orientar sem relaxar regras, esconder erros reais, aplicar propostas automaticamente ou atribuir turnos/presença fictícios.
- Mudança de filial ou período não pode descartar silenciosamente alterações não salvas.
- Configurações de pausa curta, limite de blocos a 4h30 e regime misto não viram atalhos operacionais.
- O usuário escolheu aguardar um ambiente de testes existente para a migração. Produção e o trabalho do Maestro não são alterados por esta frente isolada.

## Evidence on Hand

Código e testes existentes; plano detalhado em outputs/relatorios-reformulacao-20261113 do repositório principal; fotos de relatórios fornecidas pelo usuário. As fotos são referências para documentos, não evidência de telas atuais nem de categorias de dados que o sistema não registra.

## Product Principles

1. Mostrar a filial, o período e o estado de salvamento durante todo o trabalho.
2. Organizar a navegação pelas tarefas do usuário; reservar detalhes avançados para o momento adequado.
3. Usar linguagem cotidiana, exemplos e retornos junto da ação realizada.
4. Preservar dados e explicar consequências antes de ações que descartam ou substituem trabalho.
5. Exibir somente ações pertinentes ao perfil, com autorização correspondente no servidor.

## Open Decisions

Os dispositivos mais usados nas filiais ainda não foram informados. A implementação deve funcionar por teclado e em telas menores, sem assumir que todos usam um computador largo ou que entendem símbolos sem rótulos. Não há autorização para mudar a identidade dos outros módulos do PerfectUtilitares.
