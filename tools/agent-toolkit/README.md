# Kit de agentes do PerfectUtilitares

Revisão: 19/11/2026. Escopo: ferramentas de desenvolvimento, sem mudanças no Solver,
na aplicação, nas regras de folgas ou no banco de produção.

## Seleção de dez recursos

Não é uma classificação universal. A seleção considera os contratos, testes e
tecnologias deste projeto. Oito skills externas são fixadas por commit, árvore Git
e blob de SKILL.md. Context-Mode é fixado por versão e SHA-256 do pacote. Docker
Compose usa um perfil próprio com documentação oficial e as regras do repositório.

| Recurso | Origem | Uso |
| --- | --- | --- |
| Context-Mode 2.2.1 | mksglu/context-mode | Busca e execução MCP com saídas delimitadas |
| Caveman | JuliusBrussee/caveman | Respostas concisas, sem reduzir a evidência técnica |
| TypeScript | Mindrally/skills | Tipos, validação e contratos |
| Modern Python | trailofbits/skills | Isolamento e qualidade, preservando requirements/unittest |
| Node.js Backend Patterns | wshobson/agents | API, autorização, erros e persistência |
| React Best Practices | vercel-labs/agent-skills | Renderização, efeitos e desempenho |
| Frontend Design | anthropics/skills | Formulários e interface coerentes com o produto |
| Postgres Best Practices | supabase/agent-skills | SQL, índices, migrações e concorrência, sem migrar de provedor |
| Docker Compose | Perfil do projeto baseado em docs.docker.com | Construção, saúde e preservação de volumes |
| Property-Based Testing | trailofbits/skills | Invariantes e regressões do solver |

As versões de catálogo são snapshots revisados, não promessa de que todos os
repositórios permanecem no último commit. `manifest.lock.json` registra cada fonte.
As entradas SKILL.md foram lidas. As pastas completas são verificadas por hash ao
baixar; isso não equivale a auditoria de todo script ou referência de terceiros.

## Requisitos e instalação

Execute em Linux, na raiz do checkout que contém AGENTS.md, com Python >=3.10,
Git, acesso HTTPS ao GitHub e espaço para as fontes. Nenhum pacote Python é exigido.
Para executar Context-Mode, Node >=24.15.0 é obrigatório. O instalador não muda o
Node da aplicação nem instala Codex, Claude Code, Cursor ou credenciais.

```sh
python3 tools/agent-toolkit/kit.py plan
python3 tools/agent-toolkit/kit.py install --project "$PWD" --agent codex
python3 tools/agent-toolkit/kit.py verify --project "$PWD"
python3 tools/agent-toolkit/kit.py smoke --project "$PWD"
```

Para Claude Code, selecione `--agent claude`; para Cursor, `--agent cursor`.
O destino é, respectivamente, `.agents/skills`, `.claude/skills` ou `.cursor/skills`.
Somente os dez diretórios com prefixo `pu-` desta seleção são gerenciados.
Não serão substituídas skills já existentes ou editadas localmente.

`--skills-only` instala os dez perfis, mas NÃO baixa o runtime Context-Mode. Essa
opção não permite afirmar que Context-Mode foi instalado ou está ativo. A seleção
de agente e runtime não é alterada implicitamente por uma atualização posterior.

## Context-Mode e Caveman, sem sobreposição

Caveman entra como referência de comunicação. O proxy Caveman não é instalado.
A concisão não se aplica a código, comentários, erros, commits, números ou evidências.
Context-Mode é o único componente de redução de saídas selecionado neste kit.
Não instalar dois interceptadores automaticamente no mesmo fluxo.

O pacote Context-Mode é auto-contido: nenhum npm install, script de ciclo de vida,
setup global ou hook é executado. Os arquivos ficam em
`.agent-toolkit/runtime/context-mode`. O comando `smoke` inicia o MCP em diretório
temporário, com HOME isolado e sem credenciais, e confere initialize e tools/list.
Ele não executa ferramentas de código, não inicia agentes pagos e não prova que o
host do usuário registrou o servidor.

Após conferir os arquivos, integrar manualmente o snippet correspondente ao cliente:

```text
.agent-toolkit/config/templates/context-mode.codex.example.toml
.agent-toolkit/config/templates/context-mode.mcp.example.json
```

São exemplos: o instalador NÃO os mescla com configurações existentes. Se o cliente
exigir caminho absoluto para Node, usar o executável compatível desse ambiente.
Reiniciar a sessão do cliente e conferir suas ferramentas MCP. As instruções
oficiais de instalação/remoção do Context-Mode estão em:
https://github.com/mksglu/context-mode/tree/v2.2.1/docs/install

A alternativa oficial com hooks exige alterações e confiança no host. Não foi
ativada por este kit. Um teste MCP isolado não certifica hooks, recuperação de
sessão nem integração com esta conversa do ChatGPT.

## Atualização e recuperação

```sh
python3 tools/agent-toolkit/kit.py update --project "$PWD" --agent codex
python3 tools/agent-toolkit/kit.py verify --project "$PWD"
```

`update` aplica SOMENTE as revisões do manifesto. Para versões novas, revisar o diff
e a licença na fonte, atualizar commit/árvore/blob ou versão/SHA-256, executar os
testes e então atualizar. Não busca `latest`, não aceita commits flutuantes e não
executa instaladores remotos via shell. Na atualização, arquivos gerenciados e o
recibo anterior ficam em `.agent-toolkit/backups/<id>/`. Alterações locais são motivo
de recusa, não autorização para apagar. Não há remoção automática de backups.

Falhas durante a troca restauram os diretórios anteriores. Uma falha durante o
estágio de download não publica perfis incompletos. Um arquivo de trava impede
instalações simultâneas. Após interrupção abrupta do processo, conferir o estado
antes de remover manualmente uma trava antiga. O recibo verifica deriva acidental;
não é assinatura de segurança contra o próprio usuário do sistema operacional.

## Organização dos agentes

Os perfis são instruções reutilizáveis, não dez processos autônomos. Um coordenador
conserva o escopo; os papéis TypeScript, Python/Solver, Backend, Frontend/UI,
PostgreSQL, Docker e Verificação usam suas referências somente na tarefa pertinente.
No máximo dois revisores independentes inicialmente; um único escritor por arquivo.
Não adicionar outra plataforma, outro banco, novas bibliotecas, acessos externos ou
cobranças apenas para seguir uma skill. Os comandos de teste são os do AGENTS.md.

Os requisitos pendentes de folgas permanecem separados deste kit: fechamento
dominical da Filial 02; ausência de fixação automática de dois dias; configuração
individual explícita de zero, uma ou duas folgas fixas. Esta instalação não implementa
nem implanta essas regras, e não é evidência de correção das escalas salvas.

## Verificação

```sh
python3 -m unittest discover -s tools/agent-toolkit -p 'test_kit.py' -v
```

As fixtures locais são sintéticas: elas testam o instalador, não substituem o download
real, a auditoria das fontes, testes do solver ou o quality completo do projeto.
A CI dedicada baixa as fontes em um projeto temporário e verifica o MCP com Node
compatível. Seus resultados precisam ser conferidos para o commit testado.
Não se modifica o processo de release da aplicação. Nenhum destes comandos faz
deploy, migra o banco ou autoriza publicação de uma escala.
