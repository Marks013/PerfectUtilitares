# Correções da auditoria de 8 de setembro de 2026

Base de recuperação do código: `68e0f37418c3a140aa15ddaf7a3ac1182d2725fa`.

## Etapas integradas

1. Autenticação e recuperação (A01, A03, A04, A05, A06): separar convites de recuperação, consumir tokens atomicamente, invalidar sessões após mudanças na conta, limitar o ponto comum de autenticação e validar o tamanho UTF-8 de senhas novas.
2. Infraestrutura e dependências (A02, A07, A08, A09, A10): reduzir privilégios do banco, limitar o corpo de uploads, corrigir versões vulneráveis/incompatíveis e substituir a integração legada de detecção facial.
3. Interface e manutenção (A11, A12, A13, A14): corrigir contraste, compactar navegação móvel, priorizar o formulário e remover código sem consumidores confirmados; limitar CSS aos módulos correspondentes.
4. Liberação: validar cenários independentes, registrar commits, preservar recuperação de dados/configuração, realizar um único rebuild integral e verificar a produção.

## Validação independente

Os testes preexistentes e a configuração de aprovação do projeto não fundamentam esta correção. `node verification/run.mjs` cria PostgreSQL descartável, aplica todas as migrações e executa somente os cenários novos em `verification/`, com configuração própria e banco real. O banco descartável é removido ao terminar.

Etapa 1: seis cenários passaram, incluindo aceitação/recuperação/troca de senha com sucesso, bloqueio de recuperação após alteração de permissões, concorrência de consumo, invalidação de links irmãos e JWT, limite de login e fronteira UTF-8.

## Efeitos intencionais da etapa 1

- Sessões emitidas antes da correção precisam de novo login.
- Links pendentes anteriores à migração expiram: não existe informação confiável para distinguir convite e recuperação antigos.
- Convites passam a criar contas novas. Contas existentes usam recuperação de senha; permissões continuam sendo alteradas pela administração.
- Alterações na conta invalidam a assinatura de estado usada por sessões e links de recuperação, inclusive alterações de nome.
- Senhas antigas continuam aceitas no login; o limite real de 72 bytes é aplicado às senhas novas.

As migrações são aditivas. Reverter o código por Git não restaura dados nem desfaz expiração de links. A recuperação operacional deve usar o backup de dados/configuração e as imagens anteriores, sem executar migrações destrutivas.
