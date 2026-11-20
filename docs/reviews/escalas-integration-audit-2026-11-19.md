# Auditoria de integração de Escalas

Data de referência: 19/11/2026 (America/Sao_Paulo).
Base funcional: `213e29ff08fc5af7d07c6524da13b06ff2a034c1`, PR #37.
Escopo: navegação global, cadastro de colaboradores, retomada da sessão, permissões por filial, exportação de turnos e dependências. Não é uma certificação de segurança de toda a aplicação.

## Contratos preservados

- `/escala` é a entrada canônica; `/escalas` continua sendo um redirecionamento compatível.
- A conta ativa mantém seu próprio tenant. Uma sessão operacional verificada permite somente o escopo da empresa padrão e nunca publicação ou administração. Uma conta bloqueada, banida ou sem tenant não pode usar o cookie operacional para substituir sua negativa de acesso.
- `branchPermission` permanece a autoridade para cada leitura/escrita. A descoberta de uma ação na interface não concede autorização.
- Rascunhos continuam versionados, com comparação de revisão, recuperação e salvamento separado de publicação. Sem alteração no solver, jornada, cobertura, dias protegidos, folgas ou escalas salvas.
- Nenhuma biblioteca nova, atualização forçada, redução de auditoria ou mudança em lockfiles.

## Achados e correções

### Criação escondida de usuários autorizados

A listagem informava `canCreate` somente para administradores e sessões operacionais, embora `createEscala` já admitisse PLANNER/APPROVER da filial. A descoberta agora consulta apenas concessões editáveis do mesmo usuário/tenant. VIEWER e ausência de concessão continuam sem criação. O POST ainda confere a filial solicitada, inclusive quando a pessoa pode criar em outra filial.

### Retomada inicial após expiração

Quando a primeira listagem recebia 401, o evento de desbloqueio não repetia a consulta se nenhum planejamento tivesse sido aberto. A retomada agora recarrega essa listagem sem fabricar um planejamento ou realizar gravações. O índice tem identificação de requisição para não aceitar uma resposta antiga como resultado novo. Respostas abortadas não disparam um desbloqueio espúrio; um 401 sem JSON ainda bloqueia os controles.

Callbacks de edição e aplicação de propostas também recusam alteração local enquanto o acesso está bloqueado ou o planejamento é somente leitura. Isso é uma proteção de interface, não um substituto da autorização no servidor.

### Navegação e conta negada

Os links do cabeçalho usam a rota canônica e identificam a seção atual por `aria-current`, sublinhado e tokens existentes. A sessão operacional verificada passa a ter o link de Escalas na renderização do cabeçalho, sem Conta nem links administrativos. Falha na consulta da sessão esconde esse link, sem quebrar a navegação pública. A tela de Escalas não monta o ambiente operacional quando há uma conta que a API negaria.

### Validação e acessibilidade do cadastro

O editor reutiliza o mesmo schema de colaborador do servidor. Datas fora de 1900–2099, períodos invertidos, histórico inválido e configurações de folga inconsistentes são recusados antes de fechar o editor. Os requisitos específicos de cadastro (matrícula, nome, setor, cargo e referência de horário quando aplicável) continuam valendo. Matrículas permanecem textuais.

`Field`, o componente compartilhado existente, ganha associações opcionais para instruções e erros. Os campos tocados recebem `aria-describedby` e `aria-invalid`. A validação de envio é controlada pela aplicação; o primeiro campo inválido recebe foco, e o resumo recebe foco quando o problema não pertence a um campo simples. Não se inventam datas de admissão ou horários.

### Busca da equipe

A ordenação e o texto normalizado são indexados quando a lista de colaboradores muda, em vez de repetidos em cada tecla ou abertura de editor. A consulta ignora acentos e diferenças de caixa, preserva a identidade dos objetos e permite limpar a busca com um botão que devolve o foco ao campo. O total filtrado é anunciado sem modificar a equipe. Não se afirma redução de latência em produção sem medição no ambiente real.

### Cadastro de turnos em acesso de consulta

A exportação continua disponível a quem pode ler os planejamentos. O cadastro de referências ausentes só é oferecido quando todas as referências a registrar pertencem a planejamentos editáveis. Sem essa capacidade, a tela explica a restrição; o serviço continua fazendo sua própria verificação.

### Teste de navegador anteriormente bloqueado

A evidência da CI `44623598415` mostra o teste de folgas tentando clicar em Editar dentro do disclosure fechado `escala-team-restrictions`. O teste passa a abrir a seção pelo controle visível. Não há clique forçado, manipulação da visibilidade ou remoção das asserções de persistência. O mesmo fluxo verifica erro de admissão, foco, ausência de gravação inválida, salvamento/recarga dos dois controles e largura móvel/desktop. Capturas sintéticas são retidas por três dias na CI.

## Donos de interface e limites

Produto operacional em português do Brasil, com o tema e a densidade existentes. Fonte de tokens: `web/src/app/styles/foundation.css`; leiaute do módulo: `web/src/components/escalas/escalas.module.css`. Não há redesign ou tema paralelo.

| Capacidade | Dono mantido | Verificação |
| --- | --- | --- |
| Navegação global | AppShell, AppNavigation, AppNavLink | Componentes e navegador |
| Rótulos, dicas e erros | controls.tsx / Field | Associações renderizadas e foco no E2E |
| Select e data | Controles nativos já adotados; schema de Escalas | Schema, teclado e navegador |
| Rascunho e sessão | useEscalasWorkspace / DraftSaveQueue / access.server | Ciclo assíncrono real com fronteiras de rede simuladas |
| CRUD e autorização | access.ts / service.ts / API | Concessões, escopo e sucesso de listagem |

O aprimoramento de `Field` é compatível com consumidores de um argumento; os formulários não tocados não são declarados automaticamente conformes. A consulta do cabeçalho representa o acesso verificado naquela renderização, não autorização permanente.

## Dependências

NPMScan consultou 41 dependências diretas de produção do manifesto desta base: nenhuma vulnerabilidade conhecida reportada e todos os pacotes encontrados. A resolução de `jszip: ^3.10.1` no manifesto consultou 3.10.2; a versão real do lockfile, **3.10.1**, foi verificada separadamente, também sem achados. O alias `@perfectutilitares/smtp` foi identificado como `nodemailer@10.3.1`.

Essa consulta não cobre sozinha as 710 entradas resolvidas do lockfile, dependências de desenvolvimento, imagens ou Python. A CI integral permanece responsável pelas auditorias npm do web/worker/migrator e pelas dependências Python fixadas. Sinais de manutenção antiga em bibliotecas não são tratados como vulnerabilidade nem motivam atualização sem regressões. A consulta de avisos não constitui análise de licenças ou revisão criptográfica de procedência.

## Evidência e liberação

Na preparação local: verificação sintática dos TypeScript modificados, `git diff --check` e gate de tamanho de módulos aprovados. Este ambiente não tem o Node 24 e as dependências instaladas do projeto; não se apresenta a análise sintática como typecheck ou teste funcional.

As regressões focadas e a CI integral precisam ser conferidas no SHA final antes de integração. Resultados da base não certificam estas alterações. A liberação continua exigindo o gate/recibo de `AGENTS.md`, validação do runtime e procedimento de deploy. Nenhuma implantação, alteração de dados reais, migração ou mudança de segredo foi realizada nesta auditoria.
