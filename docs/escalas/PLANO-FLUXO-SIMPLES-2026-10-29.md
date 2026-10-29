# Fluxo simples, persistência segura e acesso operacional de Escalas

Estado: implementação iniciada, não concluída. Base publicada: e8676a1. Trabalho exclusivamente no servidor.

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

- [ ] 1. Preservar contratos com regressões focadas e detalhar recuperação, revisão e concorrência.
- [ ] 2. Implementar salvamento automático com debounce, validação de fronteira, prevenção de respostas antigas, reconciliação após falha e recuperação de rascunho.
- [ ] 3. Expor ajuste de saída junto da jornada, aplicar só ajustes compatíveis após escolha explícita, comparar original/proposto e invalidar dependências.
- [ ] 4. Conferir importação e referências, alternativas limitadas de horários, prioridades do algoritmo e validação independente; não enfraquecer regras.
- [ ] 5. Reorganizar área principal, downloads com estado real/revisão e central de erros, avisos e informações com ações opcionais, rolagem e acessibilidade.
- [ ] 6. Simplificar relatórios: horários sem listas de dias, ordenação setor/cargo/nome/horário, setores separados, cobertura com faixa completa e destaque do desfalque, informações administrativas apenas no suporte da aplicação.
- [ ] 7. Implementar /escala e alias /escalas, senha operacional, sessão isolada e expiração/bloqueio; proteger todas as operações e arquivos no escopo autorizado. Regressões de Unimed obrigatórias se houver alteração da validação compartilhada.
- [ ] 8. Avaliar preferências auditáveis. Não prometer aprendizado de máquina sem benefício comprovado; registrar decisão e limites.
- [ ] 9. Validar falhas e sucesso com CSV real, persistência/recarga, expiração, segurança de escopo, responsividade e arquivos reais. Reaproveitar testes não afetados; gates globais e build apenas no fechamento do conjunto.
- [ ] 10. Revisar diff, validar Compose protegido, commit autorizado, implantar e executar smoke real, registrar evidências e limitações.

## Plano de recuperação

Controle otimista de revisão existente permanece obrigatório. Alterações salvas geram nova revisão, sem reescrever o histórico. No erro de rede, consultar a revisão e o conteúdo persistidos antes de repetir uma gravação. Conflitos externos exigem escolha explícita, nunca sobrescrita silenciosa. Rascunhos temporários devem ser limitados à sessão e ao planejamento, sem credenciais. Sem alteração de segredos ou limpeza de caches compartilhados.
