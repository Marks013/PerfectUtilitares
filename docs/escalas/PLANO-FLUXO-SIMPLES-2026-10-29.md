# Fluxo simples, persistência segura e acesso operacional de Escalas

Estado: implementação concluída e em validação integrada de lançamento; ainda não publicada. Base publicada: e8676a1. Trabalho exclusivamente no servidor.

## Decisões e limites

- O usuário autorizou acesso operacional por senha a todas as filiais da empresa padrão. Não abrange outras empresas nem o painel administrativo.
- Reutilizar somente a validação segura da senha STANDARD do Unimed; sessões de Escalas independentes, sem alterar a senha ou conceder permissões Unimed.
- Gravação automática salva rascunhos; nunca publica, aprova ou aplica propostas por conta própria.
- Manter dias bloqueados, afastamentos, folgas fixas e limites individuais; máximo de cinco dias consecutivos permanece obrigatório.
- Preservar os dados originais e a comparação com o cenário. Sem inferir contrato de 44 horas a partir de um horário diário.

## Causas iniciais verificadas

- O hook protege operações concorrentes por trava e versão de requisição, mas o salvamento é manual e aceitar uma revisão substitui integralmente o estado. Não há recuperação de resultado incerto nem rascunho recuperável.
- Ajuste de horários está dentro de uma seção avançada em Ajustes, distante da jornada e da geração. Downloads só aparecem dentro da aba Escala.
- O acesso atual exige sessão administrativa/usuário e permissões de filial. A senha STANDARD do Unimed já possui hash bcrypt no servidor, mas sua sessão não representa permissão de Escalas; é necessário outro guard e escopo próprio.
- Relatórios ainda incluem conferências administrativas e muitas planilhas auxiliares. A visão de horários repete datas; avisos ocupam espaço no fluxo principal.

## Checklist por etapas

- [x] 1. Preservar contratos com regressões focadas e detalhar recuperação, revisão e concorrência.
- [x] 2. Implementar salvamento automático com debounce, validação de fronteira, prevenção de respostas antigas, reconciliação após falha e recuperação de rascunho.
- [x] 3. Expor ajuste de saída junto da jornada, aplicar só ajustes compatíveis após escolha explícita, comparar original/proposto e invalidar dependências.
- [x] 4. Conferir importação e referências, alternativas limitadas de horários, prioridades do algoritmo e validação independente; não enfraquecer regras.
- [x] 5. Reorganizar área principal, downloads com estado real/revisão e central de erros, avisos e informações com ações opcionais, rolagem e acessibilidade.
- [x] 6. Simplificar relatórios: horários sem listas de dias, ordenação setor/cargo/nome/horário, setores separados, cobertura com faixa completa e destaque do desfalque, informações administrativas apenas no suporte da aplicação.
- [x] 7. Implementar /escala e alias /escalas, senha operacional, sessão isolada e expiração/bloqueio; proteger todas as operações e arquivos no escopo autorizado. Regressões de Unimed obrigatórias se houver alteração da validação compartilhada.
- [x] 8. Avaliar preferências auditáveis. Não prometer aprendizado de máquina sem benefício comprovado; registrar decisão e limites.
- [x] 9. Validar falhas e sucesso com CSV real, persistência/recarga, expiração, segurança de escopo, responsividade e arquivos reais. Reaproveitar testes não afetados; gates globais e build apenas no fechamento do conjunto.
- [ ] 10. Revisar diff, validar Compose protegido, commit autorizado, implantar e executar smoke real, registrar evidências e limitações.

## Plano de recuperação

Controle otimista de revisão existente permanece obrigatório. Alterações salvas geram nova revisão, sem reescrever o histórico. No erro de rede, consultar a revisão e o conteúdo persistidos antes de repetir uma gravação. Conflitos externos exigem escolha explícita, nunca sobrescrita silenciosa. Rascunhos temporários devem ser limitados à sessão e ao planejamento, sem credenciais. Sem alteração de segredos ou limpeza de caches compartilhados.


## Evidências do candidato de lançamento

- Acesso operacional usa exclusivamente o hash STANDARD existente do Unimed, com cookie próprio, HMAC com namespace de Escalas e tabela de sessão independente. Escopo autorizado pelo usuário: todas as filiais da empresa padrão; sem acesso a outras empresas, painel administrativo, publicação formal ou desbloqueio de aprovador. Autoria compartilhada não é atribuída a uma pessoa fictícia.
- Salvamento automático agrupa alterações em 850 ms, valida o conteúdo antes da gravação, serializa escritas e conserva edições realizadas durante uma confirmação lenta. Falha de confirmação é reconciliada por GET antes de repetir; conflitos exigem escolha explícita. Rascunho recuperável fica somente no sessionStorage, por até oito horas, sem credenciais; armazenamento indisponível é informado. Não há publicação automática.
- Abas visitadas conservam editores montados. Campos numéricos incompletos ficam no editor, sem substituir o último valor válido por zero. A recuperação pendente precisa ser resolvida antes de editar; não é sobrescrita em silêncio.
- Ajustes de horário aparecem junto da jornada e dos arquivos, com aplicação explícita em um passo, comparação com o original e exceções identificadas. Bloqueios e ausências permanecem; incompatibilidade não exclui colaboradores automaticamente.
- Os arquivos são gerados sob demanda. A interface só apresenta o link depois de receber bytes válidos da revisão confirmada. Mudanças de cenário/revisão invalidam links antigos.
- PDF e XLSX operacionais não incluem conferências administrativas nem listas de dias na relação de horários; variantes reais permanecem distintas. XLSX conserva apenas Escala/Horarios conforme a visualização, mais Desfalques/Excluidos quando necessários. Setores são separados e pessoas ordenadas por setor, cargo e nome; variantes por horário crescente.
- Revisão independente encontrou e teve corrigidos três problemas de concorrência: gravação de outra grade em andamento, proteção da recuperação antes da escolha e retomada após conferência longa. Desfazer uma decisão já preservada segue a operação explícita de desbloqueio e gravação separada, somente para aprovadores.
- 284 arquivos e 2.093 testes aprovados, três condicionais ignorados na rodada de cobertura. Cobertura global incluindo UI: 65,14% linhas, 63,21% statements, 58,92% funções e 55,78% branches. Os gates não foram alterados. Regressores focados posteriores cobrem as correções de navegador.
- Typecheck, lint, análise de código não utilizado, tamanho de módulos, 20 testes operacionais e gate de 73/73 rotas com cenário funcional foram aprovados durante o fechamento.
- FPRE136 original processado novamente: sete filiais, 650 colaboradores; todas as propostas viáveis e validadas independentemente, máximo de cinco dias consecutivos, zero exclusões automáticas, fonte intacta. FPHI105 permanece opcional e preserva afastamentos e férias.
- Quatro cenários de navegador repetidos após correção passaram em 2,5 minutos: acesso operacional/expiração/escopo/Unimed independente, gravação após validação longa, edição/desfazer/troca e recuperação de cobertura inviável. Os demais cenários aprovados são reaproveitados; execuções interrompidas não são apresentadas como uma suíte integral concluída.

## Preferências e limites

Não foi implantado aprendizado de máquina: não há benefício comprovado nem histórico de aceitação/rejeição suficiente que justifique a complexidade. Preferências individuais explícitas e revisões existentes continuam disponíveis; a interface apresenta as prioridades verificáveis do otimizador. Ausência de interação não é aprovação, não há compartilhamento de preferências entre filiais nem envio de dados pessoais a serviços externos.

Não são inventados contrato semanal, demanda, enquadramento ou autorização. O FPRE136 fornece horários originais; a carga da simulação vem da escolha de jornada. Na importação alternativa, carga semanal preenchida é referência individual; ausente é referência da filial. Histórico desconhecido limita a continuidade verificável e horários ausentes não contam como cobertura.

## Recuperação operacional preparada

- Compose validado com acesso aos arquivos protegidos.
- Imagens de aplicação, worker e migração preservadas em tags rollback-guided-20261029-e8676a1. A imagem original do solver em execução não estava mais disponível no armazenamento Docker; uma imagem equivalente foi preservada após conferir as três fontes por SHA-256, sem alterar o solver em execução.
- Backup do banco anterior à migração: /home/ubuntu/PerfectUtilitares-recovery/pre-guided-20261029-177e7ff4e8.dump, formato custom, 1.857.548 bytes, arquivo 0600 em diretório root 0700; catálogo validado por pg_restore --list. SHA-256: 75d47e8ad0fc36c73e7330ab51cf759e0dad80b614d0764bbc06be9ae0180fcf.
- Migração é aditiva: sessão operacional nova, autoria individual passa a aceitar nulo e origem da sessão é registrada. Sem remoção de grades, revisões ou dados importados. Recuar aplicação não exige apagar as novas colunas; restaurar banco só seria uma operação explícita com avaliação dos dados posteriores.

## Ampliação solicitada no teste final

O usuário solicitou avaliar a qualidade das folgas, dos horários e das quantidades de cobertura. A auditoria independente de 650 colaboradores e 3.900 semanas-pessoa identificou um ajuste na referência dominical; ele foi implementado e testado sem alterar os mínimos explícitos. Comparação detalhada e limitações em TESTE-GERACAO-COBERTURA-2026-10-29.md. O build foi atualizado por necessidade dessa alteração comportamental; testes de segurança e UI já aprovados são reaproveitados quando não afetados.

## Fechamento do candidato

Os 17 cenários únicos de Escalas passaram contra o build de produção: 14 na execução integrada e três na repetição focada, após atingirem legitimamente o limite de seis gerações por dez minutos no mesmo ambiente de teste. O limite de produção foi preservado; a repetição utilizou banco isolado novo, sem desabilitar proteção. Depois da melhoria dominical, três cenários dependentes de cobertura passaram novamente contra o build atualizado: CSV real completo, afastamentos opcionais reais e gráfico/exportações. As demais regressões não afetadas foram reaproveitadas.

A rodada de navegador dos arquivos gerais restantes concluiu 16 cenários e ignorou dois condicionais. A primeira execução geral foi interrompida sem conclusão; não é apresentada como uma suíte global integralmente aprovada. O fechamento comprova o módulo de Escalas e as dependências afetadas, além das checagens globais de código já registradas.

Build inicial, worker e atualização necessária após o ajuste de dimensionamento dominical concluídos. Sem rebuild a cada edição; a publicação Docker ainda será realizada uma vez para o conjunto. Nenhum gate foi reduzido e nenhuma credencial foi modificada.
