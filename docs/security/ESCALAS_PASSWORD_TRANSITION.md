# M2 | Credencial opcional própria de Escalas (primeira etapa compatível)

**Estado:** configuração preparada no código, **não ativada no servidor**. Sem alteração de banco, sessões salvas ou permissões. A02 (tela de concessão individual por filial) permanece condicionada à autorização do responsável.

## Ordem de resolução

- Se `ESCALAS_ACCESS_STANDARD_PASSWORD_HASH` existir, a API de acesso operacional usa **somente** este hash BCrypt válido.
- Se a variável dedicada estiver **ausente**, mantém a compatibilidade com `UNIMED_ACCESS_STANDARD_PASSWORD_HASH` (somente padrão, nunca admin).
- Se a variável dedicada estiver presente, mas vazia/malformada, o acesso operacional retorna **503** e **não** recorre à senha do Unimed.
- Tentativas continuam sob o rate limit já existente, sem revelar hashes ou senhas em resposta/log.
- A sessão/cookie atual de Escalas permanece independente no nome e domínio, mas ainda usa `UNIMED_ACCESS_COOKIE_SECRET` como segredo raiz e `UNIMED_ACCESS_SESSION_TTL_MINUTES`. Essa independência não foi implementada aqui.

## Ativação operacional futura

1. Proprietário define identidade e escopo para o canal de acesso compartilhado, incluindo revogação e responsabilidades.
2. Validar continuidade e backup autorizado, planejar comunicação e contingência.
3. Gerar um hash BCrypt de senha dedicada **fora do repositório e da CI pública**, armazenar apenas em segredo de produção com permissões restritas, sem copiar para arquivos de auditoria.
4. Validar a nova autenticação e a recusa do Unimed STANDARD em ambiente isolado; conferir que operador segue sem publicação e não ganhou acesso extra.
5. Alteração/rotação de segredo, cookies e restrição por filial são **etapas separadas** que exigem decisão e testes.

**Sem configuração dedicada, o comportamento em produção é o mesmo.** A01 (ruleset CI) e A03 completo ainda não estão encerrados.
