# Plano de abertura pública do PerfectUtilitares

## 1. Objetivo

Transformar o PerfectUtilitares de uma aplicação fechada por autenticação em
uma plataforma pública:

- Jornada, Fotos 3x4 e PDF podem ser usados sem cadastro;
- o login continua disponível, mas deixa de ser obrigatório;
- usuários autenticados recebem benefícios pessoais, principalmente o
  histórico de validações de Jornada;
- configurações, dados administrativos e ações sobre contas continuam
  protegidos;
- o acesso público não reduz a segurança dos uploads nem permite que uma
  pessoa acesse os arquivos temporários de outra.

Não faz parte desta mudança criar cadastro público. O fluxo atual de
administrador, convites e recuperação de senha pode ser mantido.

## 2. Diagnóstico atual

### 2.1 Bloqueio global

O bloqueio principal está em `src/components/app-shell.tsx`: o componente
executa `auth()` e redireciona qualquer visitante sem sessão para `/login`.
Como todo o grupo `src/app/(app)` usa esse shell, Dashboard, Jornada, Fotos e
PDF ficam privados por consequência.

Além disso:

- o Dashboard filtra os módulos pelas permissões da sessão;
- as páginas dos módulos usam `requirePageModuleAccess`;
- as APIs usam `requireModuleAccess`;
- a API de Jornada sempre associa e salva o resultado no usuário;
- os trabalhos PDF exigem `tenantId` e sessão para criação e acesso;
- as APIs de Fotos são essencialmente transitórias, mas também exigem sessão.

Remover apenas o redirecionamento do shell não é suficiente. Isso deixaria a
interface visível, mas as APIs continuariam bloqueadas e, no caso de PDF,
abriria risco de acesso cruzado se o identificador do trabalho fosse tratado
como autorização.

### 2.2 Permissões por módulo

Hoje `canAccessJornada`, `canAccessFotos` e `canAccessPdf` funcionam como
permissões de entrada. Depois da abertura pública, um usuário bloqueado poderia
simplesmente sair da conta e usar a ferramenta como visitante.

Portanto, esses campos não podem continuar significando "impedir o uso
público". A interpretação coerente passa a ser:

- acesso básico às ferramentas: público;
- recursos vinculados à conta, limites ampliados e personalizações:
  controlados pelas permissões;
- administração: controlada pelo papel `ADMIN`, sem alteração.

Essa mudança de significado deve aparecer claramente na tela de usuários para
não induzir o administrador ao erro.

## 3. Matriz de acesso proposta

| Área | Visitante | Usuário autenticado | Administrador |
| --- | --- | --- | --- |
| Início/Dashboard | Sim | Sim | Sim |
| Validar Jornada manual | Sim, sem salvar | Sim, salva no histórico se habilitado | Sim |
| Validar Jornada em lote | Sim, quota reduzida e sem histórico | Sim, quota ampliada | Sim |
| Histórico pessoal de Jornada | Não | Somente o próprio | Todos + visão geral |
| Exceções pessoais de Jornada | Não | Somente as próprias | Administração conforme regra atual |
| Fotos 3x4 individual/lote | Sim | Sim, quota ampliada | Sim |
| Ferramentas PDF | Sim, trabalhos temporários privados | Sim, trabalhos temporários privados | Sim |
| Histórico PDF | Não existe | Não existe | Não existe |
| Conta e exclusão da própria conta | Não | Sim | Sim |
| Usuários, convites e tenants | Não | Não | Sim |
| Regras e códigos de Jornada | Não | Não | Sim |

## 4. Arquitetura de autenticação

### 4.1 Três estados explícitos

Centralizar no servidor três estados:

1. **Visitante:** nenhuma sessão, acesso apenas às operações públicas.
2. **Usuário ativo:** sessão válida, benefícios conforme permissões.
3. **Administrador:** sessão válida e acesso administrativo absoluto.

Criar funções distintas, evitando uma guarda genérica ambígua:

- `getOptionalSession()`: retorna sessão ativa ou `null`;
- `requireAuthenticatedUser()`: exige uma conta ativa;
- `requireAdmin()`: mantém a exigência administrativa;
- `getPublicModuleContext(module)`: permite visitante e retorna o nível de
  serviço aplicável;
- `requireAccountBenefit(module)`: protege histórico, exceções e outros
  benefícios pessoais.

As verificações devem continuar nos Route Handlers, Server Actions e funções
de acesso a dados. Ocultar um botão ou usar Proxy é apenas uma melhoria de
navegação, não uma barreira de segurança.

### 4.2 Estrutura de rotas

Recomendação conservadora: manter o grupo `(app)` e tornar `AppShell`
compatível com sessão opcional. Isso reduz movimentações de arquivos e risco de
regressão.

Cada página sensível deve continuar com proteção explícita:

- `/conta`;
- `/jornada/historico`;
- `/jornada/regras`;
- `/jornada/codigos`;
- `/admin/usuarios`;
- convites, recuperação administrativa e demais telas privadas.

O arquivo `proxy.ts`, se usado, deve servir apenas para redirecionamentos
otimistas, cabeçalhos e ergonomia. A autorização definitiva permanece junto
às APIs e aos dados.

## 5. Comportamento por módulo

### 5.1 Jornada

#### Visitante

- valida com regras globais ativas e banco compartilhado de códigos;
- recebe código da Jornada, períodos, duração e erros normalmente;
- não carrega exceções pessoais;
- não cria `JornadaValidation`;
- o resultado atual pode permanecer na tela, mas não deve criar histórico
  durável em `localStorage`, pois isso reduziria a vantagem real da conta.

#### Usuário autenticado

- utiliza regras globais e exceções pessoais existentes;
- salva cada validação no histórico quando `canAccessJornada` estiver ativo;
- visualiza e exclui apenas o próprio histórico;
- recebe quota superior à do visitante.

#### Administrador

- mantém regras, códigos, histórico geral e gestão das permissões;
- o menu deve separar “Meu histórico” de “Histórico geral”.

#### Ajuste de API

`POST /api/jornada/validar` passa a aceitar sessão opcional:

- `userId = null` para visitante e nenhuma gravação;
- `userId = session.user.id` para usuário elegível e gravação atual;
- resposta com formato idêntico nos dois modos, exceto `id` persistido e
  indicador `savedToHistory`.

O lote continua sem histórico persistente e pode ser público com limite
menor, tamanho máximo atual e validação completa antes do processamento.

### 5.2 Fotos 3x4

As rotas são adequadas ao uso público porque recebem, processam e devolvem o
resultado sem depender de dados pessoais persistidos.

Mudanças necessárias:

- substituir a exigência de módulo por contexto público;
- conservar verificação de origem, tamanho, extensão, MIME e assinatura;
- manter nomes gerados e processamento fora da área pública do servidor;
- aplicar quotas diferentes para visitante e usuário;
- limitar processamento concorrente, especialmente no lote;
- não registrar conteúdo, nome original completo ou imagem no Sentry.

As preferências dos checkboxes podem continuar no navegador, sem depender de
conta.

### 5.3 PDF

O PDF exige a maior mudança porque `PdfJob.tenantId` é obrigatório e as
operações posteriores dependem da propriedade do trabalho.

#### Sessão anônima de processamento

Ao primeiro uso, gerar um segredo aleatório de pelo menos 256 bits e gravá-lo
em cookie:

- `HttpOnly`;
- `Secure` em produção;
- `SameSite=Lax`;
- caminho `/`;
- validade curta, recomendada em 2 horas.

O segredo não deve ser salvo em texto puro. Salvar no trabalho somente um hash
HMAC/SHA-256 identificado como `ownerSessionHash`. Toda leitura, alteração,
download ou exclusão do trabalho deve exigir:

- usuário e tenant proprietários, quando autenticado; ou
- hash da sessão anônima proprietária, quando visitante.

O `id` do trabalho nunca deve ser considerado uma credencial.

#### Prisma

Alteração proposta em `PdfJob`:

- tornar `tenantId` opcional para trabalhos públicos;
- manter `userId` opcional;
- adicionar `ownerSessionHash String?`;
- adicionar índice em `ownerSessionHash`;
- adicionar validação de aplicação garantindo exatamente um proprietário:
  usuário autenticado ou sessão anônima.

Uma restrição SQL `CHECK` pode reforçar essa invariável na migration, caso o
padrão atual de migrations permita SQL complementar.

#### Retenção

- manter o histórico PDF completamente desativado;
- apagar entradas de entrada após sucesso;
- manter saídas somente durante a janela transitória atual;
- expirar trabalhos abandonados;
- limitar trabalhos ativos por proprietário e globalmente;
- não dar acesso administrativo automático ao conteúdo de trabalhos públicos.

## 6. Interface pública

### Navegação anônima

Exibir sempre:

- Início;
- Jornada;
- Fotos 3x4;
- PDF;
- tema;
- ação “Entrar”.

### Navegação autenticada

Acrescentar:

- Meu histórico, quando a vantagem de Jornada estiver habilitada;
- Minha conta;
- Sair.

O administrador recebe também os itens administrativos atuais.

### Dashboard

O Dashboard deve sempre mostrar os três módulos públicos. Quando não houver
sessão, incluir uma chamada discreta e útil:

> Use todas as ferramentas sem cadastro. Entre para salvar seu histórico de
> Jornadas.

Não transformar o Dashboard em página promocional: ele continua sendo o
acesso direto às ferramentas.

### Login

- manter o formulário atual;
- acrescentar “Continuar sem entrar”;
- ao autenticar, retornar ao módulo que o usuário estava utilizando por meio
  de um `callbackUrl` validado como caminho interno;
- não permitir redirecionamentos para domínios externos.

### Metadados

- permitir indexação do início e das ferramentas públicas;
- aplicar `noindex` em login, conta, histórico e administração;
- adicionar `robots.ts`, `sitemap.ts`, canonical e metadados específicos dos
  módulos;
- nunca colocar nomes de arquivos enviados ou resultados privados em
  metadados, URLs indexáveis ou logs.

## 7. Segurança e controle de abuso

Abrir processamento de imagens e documentos aumenta risco de CPU, memória,
disco e banda. A proteção precisa existir em duas camadas.

### Aplicação

- validações baratas antes do parsing ou processamento;
- allowlist de formatos;
- conferir extensão, MIME e assinatura real;
- limites de bytes por arquivo, lote e resposta;
- timeouts de processamento;
- limites de páginas, pixels, dimensões, DPI e quantidade por lote;
- limite de trabalhos ativos por proprietário;
- filas e concorrência global controladas;
- respostas `Cache-Control: no-store` para conteúdo privado;
- nomes de arquivos gerados pelo sistema;
- bloqueio de métodos HTTP não suportados;
- Sentry sem dados dos documentos, imagens, cookies ou credenciais;
- mensagens de erro genéricas ao cliente e diagnóstico técnico apenas no
  servidor.

### Limites

Definir quotas por operação e custo, não apenas por rota:

| Classe | Visitante | Autenticado |
| --- | --- | --- |
| Jornada manual | Alta, operação barata | Superior |
| Jornada em lote | Baixa | Superior |
| Foto individual | Moderada | Superior |
| Foto em lote | Baixa | Superior |
| PDF leve | Moderada | Superior |
| PDF pesado/conversão | Baixa + fila | Superior + fila |

Os números devem ser calibrados com métricas reais do Oracle Cloud. A
configuração inicial deve ser conservadora e ajustável por variáveis de
ambiente.

### Armazenamento do rate limit

O `Map` em memória atual reinicia com o processo, não funciona entre réplicas
e pode depender de um `X-Forwarded-For` manipulável.

Recomendação sem novo serviço pago:

- usar PostgreSQL para buckets atômicos de limite, com expiração e limpeza;
- manter um pequeno bloqueio em memória apenas como primeira barreira;
- configurar no Nginx Proxy Manager limites gerais de requisição, corpo e
  conexão;
- confiar em cabeçalhos de proxy somente quando a conexão vier do proxy
  conhecido;
- normalizar IPv4/IPv6 e não aceitar cegamente o primeiro endereço informado
  pelo cliente.

Redis pode ser considerado no futuro se a carga justificar, mas não é
necessário para a primeira abertura.

### Proteção antiautomação

Não adicionar CAPTCHA por padrão. Primeiro medir abuso real. Preparar um ponto
de integração para desafio apenas em operações caras ou após repetidas
violações de quota.

## 8. Variáveis de implantação

Adicionar chaves com validação Zod:

```env
PUBLIC_ACCESS_ENABLED=false
PUBLIC_JORNADA_ENABLED=false
PUBLIC_FOTOS_ENABLED=false
PUBLIC_PDF_ENABLED=false
ANONYMOUS_SESSION_TTL_MINUTES=120
PUBLIC_RATE_LIMIT_ENABLED=true
```

As chaves permitem publicar a nova versão ainda fechada, testar em produção e
liberar um módulo por vez. Ao desabilitar acesso público, usuários
autenticados continuam usando o comportamento atual.

Limites de arquivos, concorrência e quotas devem ter variáveis próprias, com
valores padrão seguros e limites mínimos/máximos no schema de ambiente.

## 9. Etapas de implementação

### Etapa 1: fundação e contrato de acesso

- criar os contextos de acesso visitante/autenticado/admin;
- tornar `AppShell` compatível com sessão nula;
- manter guardas explícitas nas páginas privadas;
- tornar Dashboard e navegação públicos;
- alterar a descrição das permissões por módulo no painel de usuários;
- adicionar as chaves de ativação.

**Aceite:** visitante abre início e módulos sem loop de login; conta e
administração continuam retornando redirecionamento/erro seguro.

### Etapa 2: Jornada em modo duplo

- aceitar sessão opcional na validação;
- não persistir validações anônimas;
- persistir e listar histórico somente para conta elegível;
- separar “Meu histórico” e “Histórico geral”;
- aplicar quotas por nível;
- cobrir validação manual e lote.

**Aceite:** a mesma Jornada produz o mesmo resultado com e sem conta; apenas a
execução autenticada elegível aumenta o total do histórico.

### Etapa 3: Fotos públicas

- liberar páginas e APIs;
- preservar validações atuais;
- adicionar concorrência e quotas por custo;
- testar individual, lote, ZIP e memórias de preferências.

**Aceite:** visitante processa e baixa arquivos sem qualquer registro
persistente e sem enxergar dados de outra requisição.

### Etapa 4: propriedade anônima de PDF

- criar migration do proprietário anônimo;
- emitir cookie seguro;
- adaptar criação, consulta, edição, download e exclusão;
- garantir limpeza de trabalhos anônimos;
- adicionar limite de trabalhos ativos.

**Aceite:** dois navegadores anônimos não conseguem acessar os trabalhos um do
outro, mesmo conhecendo seus IDs.

### Etapa 5: proteção de infraestrutura

- implementar rate limit compartilhado no PostgreSQL;
- endurecer resolução do IP atrás do Nginx Proxy Manager;
- configurar limites gerais no proxy;
- revisar timeouts, fila PDF, disco e limpeza;
- criar métricas por módulo e tipo de usuário sem dados pessoais.

**Aceite:** reiniciar o app não zera limites compartilhados; carga excessiva
recebe `429` ou fila controlada sem derrubar os demais módulos.

### Etapa 6: acabamento público

- textos de conta opcional;
- retorno seguro após login;
- metadados, sitemap e robots;
- acessibilidade e responsividade;
- estados de quota, processamento, falha e expiração;
- aviso curto de privacidade e retenção nos uploads.

**Aceite:** fluxo completo funciona em celular, tablet e desktop, com tema
claro/escuro, sem textos técnicos expostos ao cliente.

### Etapa 7: auditoria e liberação gradual

- testes unitários e de integração;
- Playwright nos perfis visitante, usuário e administrador;
- build Turbopack;
- teste Docker com app e worker;
- teste real por HTTPS atrás do Nginx Proxy Manager;
- liberar Jornada, depois Fotos e por último PDF;
- observar CPU, memória, fila, disco, erros e respostas `429`.

## 10. Matriz mínima de testes

### Autorização

- visitante acessa apenas rotas públicas;
- usuário inativo não recebe benefícios autenticados;
- usuário comum não acessa APIs administrativas;
- usuário consulta somente o próprio histórico;
- administração não depende de itens ocultos na interface;
- sair da conta não contorna nenhuma operação privada.

### Jornada

- visitante não gera registro;
- usuário elegível gera registro;
- usuário sem benefício recebe resultado público, mas não histórico;
- código, períodos e mensagens são iguais nos dois modos;
- lote respeita tamanho, tipo e quota.

### PDF

- propriedade isolada entre dois visitantes;
- propriedade isolada entre usuários e tenants;
- cookie ausente, alterado ou expirado não dá acesso;
- ID válido sem prova de propriedade retorna `404`;
- download expirado falha sem recriar arquivo;
- limpeza remove entrada, saída e registro;
- histórico PDF permanece inexistente.

### Upload e disponibilidade

- extensão falsa e assinatura inválida;
- arquivo truncado;
- PDF com páginas/dimensões excessivas;
- imagem descomunal ou corrompida;
- lote acima do limite;
- muitas requisições concorrentes;
- reinício do app durante um trabalho;
- indisponibilidade temporária do worker.

### Interface

- navegação pública e autenticada;
- retorno ao módulo após login;
- estados vazios, erro, limite e progresso;
- teclado, foco e leitores de tela;
- larguras móveis e desktop;
- temas claro e escuro.

## 11. Migração, implantação e retorno

1. Fazer backup do PostgreSQL e do diretório persistente de uploads
   temporários.
2. Publicar migrations com `PUBLIC_ACCESS_ENABLED=false`.
3. Executar testes autenticados atuais para detectar regressões.
4. Validar visitante em ambiente de homologação ou domínio restrito.
5. Ativar Jornada e observar métricas.
6. Ativar Fotos e observar recursos.
7. Ativar PDF por último.
8. Em incidente, desativar a chave do módulo sem reverter banco ou imagem
   Docker.

A migration de `PdfJob` deve ser compatível com os trabalhos existentes:
`tenantId` atual permanece preenchido e `ownerSessionHash` começa nulo. O
retorno ao modo fechado não exige desfazer a migration.

## 12. Decisões recomendadas

- **Conta opcional, sem cadastro aberto:** mantém controle dos tenants e
  convites.
- **Histórico exclusivo da conta:** principal vantagem do login na Jornada.
- **Sem histórico local anônimo:** evita uma vantagem paralela e difícil de
  administrar.
- **Sem histórico PDF:** mantém a decisão atual de privacidade e economia de
  disco.
- **PDF anônimo com prova de propriedade:** evita IDOR e vazamento entre
  visitantes.
- **Permissões controlam benefícios, não o uso público:** evita bloqueios
  facilmente contornáveis por logout.
- **Rate limit compartilhado em PostgreSQL:** aproveita infraestrutura
  existente e funciona entre processos.
- **Liberação por módulo:** reduz risco operacional no servidor.

## 13. Arquivos mais afetados

- `src/components/app-shell.tsx`;
- `src/app/(app)/layout.tsx`;
- `src/app/(app)/dashboard/page.tsx`;
- páginas públicas de Jornada, Fotos e PDF;
- `src/lib/modules/access.ts`;
- `src/lib/api/security.ts`;
- `src/lib/api/rate-limit.ts`;
- APIs de Jornada, Fotos e PDF;
- helpers de propriedade e retenção de PDF;
- `prisma/schema.prisma` e uma migration incremental;
- schema de ambiente e arquivos Docker/Nginx documentados;
- testes de autorização, módulos e Playwright.

## 14. Referências técnicas

- Next.js recomenda centralizar autorização e fazer verificações seguras
  próximas da fonte dos dados:
  <https://nextjs.org/docs/app/guides/authentication>
- No Next.js 16, Proxy pode fazer verificações otimistas, mas não deve ser a
  solução completa de sessão ou autorização:
  <https://nextjs.org/docs/app/getting-started/proxy>
- OWASP recomenda allowlist, assinatura real, nome gerado, limites e
  armazenamento com privilégio mínimo para uploads:
  <https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html>
- OWASP recomenda analisar operações caras e combinar limites na aplicação e
  infraestrutura contra indisponibilidade:
  <https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html>
- Controles por operação cara e abuso de fluxo:
  <https://cheatsheetseries.owasp.org/cheatsheets/Business_Logic_Security_Cheat_Sheet.html>
- Segurança e limites para APIs REST públicas:
  <https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html>

