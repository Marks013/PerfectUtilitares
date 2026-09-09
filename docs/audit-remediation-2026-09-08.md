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

## Infraestrutura e dependências

- A02: credencial exclusiva `perfect_runtime`, sem superuser, createdb, createrole, replication ou bypassrls. O processo de migração conserva a credencial administrativa; aplicação e worker recebem a credencial de execução por arquivo protegido externo ao Git. DML no schema público e propriedade somente do schema `pgboss`, necessário para sua manutenção de partições. DDL público foi negado no teste real de permissões.
- A07: fotos individuais e em lote interrompem leitura multipart pelo total recebido, incluindo requisições sem Content-Length ou com valor falso. Nginx limita o site a 101 MiB, fotos individuais a 9 MiB e lotes a 41 MiB; estes valores acomodam os limites menores da aplicação e o envelope multipart. O callback de credenciais possui limite de 16 KiB e taxa de requisições. Limite simultâneo por IP: 20. Configuração persistida no campo avançado do host 13 do Nginx Proxy Manager. Três sondagens com Expect: 100-continue receberam 413 antes de qualquer upload.
- A08: `fast-uri` 3.1.7 e `mysql2` 3.24.4 nos lockfiles principal e do migrador. Consulta direta à API de advisories do npm retornou zero pacotes com alertas nos três lockfiles, em 9 de setembro de 2026. Isso não constitui garantia de ausência de vulnerabilidades desconhecidas.
- A09: Nodemailer 9.1.1 mantido, sem regressão para versões vulneráveis. O alias npm `@perfectutilitares/smtp` identifica a integração SMTP própria da aplicação; o provider opcional Nodemailer do Auth.js não é utilizado nem instalado. `npm ls` não apresenta dependências inválidas. A geração de MIME com anexo foi validada em stream local, sem enviar mensagens.
- A10: substituição de `@mediapipe/face_detection` por `@mediapipe/tasks-vision` 1.0.1. WASM servido localmente e modelo oficial BlazeFace short-range fixado por SHA-256. O adaptador conserva coordenadas normalizadas do recorte. Chromium detectou um rosto no retrato de referência, com coordenadas válidas. O recorte manual continua disponível; a amostra não representa todos os tipos de rosto e iluminação.

## Interface e manutenção

- A11: botão de entrada usa classe semântica e cor com contraste medido de 5,47:1 no tema claro (antes: 3,28:1).
- A12: navegação móvel recolhida, botão com estado acessível e fechamento por Escape/link; formulário de entrada precede a apresentação no celular. Cabeçalho móvel medido: 82 px; campo de e-mail: 157 px do topo. Login, dashboard, fotos, PDF e jornada foram examinados em 375 e 1440 px, sem transbordamento horizontal.
- A13: removidos os quatro exports sem consumidores de produção e os seletores `.progress-fill` e `.pdf-tool-item__status`. Removidas também as referências de testes específicas dessas rotinas retiradas; testes preexistentes não foram usados como critério de aprovação.
- A14: CSS de PDF, fotos, jornada e Unimed passa a ser importado nos respectivos layouts, incluindo regras responsivas. A página pública não precisa importar todos esses módulos. O botão de entrada deixa de depender de override de classe de cor genérica. Overrides compartilhados restantes são dívida técnica explícita para migração gradual; não foi feita uma reescrita integral do tema.

## Evidência e recuperação

- Commit inicial: `2b6a465` — autenticação e recuperação.
- Backup de dados verificado: `/home/ubuntu/perfectutilitares-config/audit-backup-1788899498294/database.dump`.
- Backup atualizado imediatamente antes da liberação: `/home/ubuntu/perfectutilitares-config/audit-backup-1788953205589/database.dump`.
- Imagens anteriores: `web-app:audit-before-20260908` e `web-pdf-worker:audit-before-20260908`.
- Backup do proxy dentro do NPM: `/data/nginx/custom/perfectutilitares-ingress-backup-1788952315142.json`.
- Oito testes independentes passaram com PostgreSQL descartável, incluindo imagem PNG real e ZIP de fotos; criação/envio/consumo/conclusão de tarefa pg-boss foi validada com a credencial restrita.
- Prévia de desenvolvimento isolada validou login Auth.js real e revogação do JWT após troca de senha. A prévia não reconstruiu imagens de produção.

## Fontes

- [Limite UTF-8 do bcrypt.js](https://github.com/dcodeIO/bcrypt.js).
- [Face Detector para Web — Google](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector/web_js).
- [Contraste mínimo — WCAG](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- [Advisory que impede retorno ao Nodemailer antigo](https://github.com/advisories/GHSA-p6gq-j5cr-w38f).
