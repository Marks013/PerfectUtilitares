> **Status:** concluido e arquivado em 8 de agosto de 2026. Este arquivo e um registro historico de trabalho entregue, nao um backlog ativo. A validacao atual e definida pelo CI, pelos testes e pela documentacao operacional versionada.

# Plano de correção do módulo PDF

## Objetivo

Eliminar perda silenciosa de conteúdo, tornar processamento e fila consistentes e substituir o recorte numérico por seleção visual ajustável pelo mouse, mantendo entrada numérica como alternativa precisa.

## Frentes

1. Renderização e compactação
   - publicar e configurar recursos PDF.js (WASM, CMaps e fontes);
   - tratar falhas de renderização como erro, nunca como sucesso parcial;
   - validar candidatos automáticos antes de escolher por tamanho;
   - preservar geometria e fornecer fallback seguro;
   - cobrir compactação e PDF para JPG com PDFs JBIG2/Form XObject.
2. Consistência operacional
   - tornar uploads e atualização de manifesto condicionais ao estado DRAFT;
   - impedir subcontagem e estouro por uploads simultâneos;
   - tornar enfileiramento idempotente mesmo se telemetria falhar;
   - corrigir timeout, reconexão, cancelamento e sucesso sem artefato;
   - alinhar expiração de jobs enfileirados com a fila.
3. Editor e recorte
   - seleção visual por arraste;
   - alças para mover e redimensionar a área mantida;
   - coordenadas corretas para páginas já rotacionadas;
   - acessibilidade por teclado e campos numéricos sincronizados;
   - coordenadas corretas para anotações em páginas rotacionadas/recortadas.
4. Validação
   - testes unitários e de integração;
   - testes de concorrência e estados de fila;
   - comparação visual do PDF real e corpus sintético;
   - build, deploy, health check e smoke test em produção.

## Critérios de aceite

- nenhuma imagem ou camada desaparece no PDF de referência;
- AUTO nunca aceita candidato com falha de renderização;
- nenhuma operação devolve o original ou um arquivo parcial como se fosse sucesso;
- cada operação valida sua própria saída e retorna diagnóstico acionável quando não puder cumprir o contrato;
- função sem qualidade comprovável fica desabilitada ou é removida da interface;
- PDF para JPG preserva visualmente todas as páginas;
- uploads simultâneos respeitam contagem e tamanho;
- recorte pode ser definido, movido e redimensionado pelo mouse;
- coordenadas continuam corretas após rotações;
- todos os testes, typecheck e build passam;
- app e worker ficam saudáveis após deploy.
