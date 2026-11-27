# Frontend — continuação da revisão de 27/11/2026

## Alterações

- Testes de contraste verificam explicitamente blocos, tokens e cores, sem asserções não nulas. Não reduz regras do lint.
- Escalas apresenta seleção, alertas relevantes, contexto de filial/período, navegação e tarefa antes da base global, operadores e catálogo administrativo. A mudança é na ordem do DOM, mantendo permissões e acesso administrativo sem planejamento selecionado.
- O editor de colaboradores pede confirmação antes de trocar, adicionar outro cadastro ou cancelar com campos locais alterados. Continuar editando preserva os campos; descartar não grava dados; aplicar usa o fluxo existente de salvamento. A reversão dos campos remove a pendência. Há aviso de saída/recarregamento. Não utiliza armazenamento persistente de dados pessoais.
- Extração de EmployeeEditor mantém a exportação anterior e evita ultrapassar o limite de tamanho do módulo. Não altera regras de horários, folgas, autorização, endpoints ou dados de produção.
- O CI 508 mostrou dois testes de login com seletor global de alertas ambíguo: o anunciador de rotas do Next também tem role=alert. As asserções agora se restringem ao formulário, preservando foco e conteúdo exigidos.

## Evidência executada antes do envio

Ambiente descartável com Node 24.22.3, npm 11.19.1 e dependências do lockfile. Nenhum deploy.

- Lint bloqueante corrigido; 15 testes Vitest de login/contraste passaram.
- Regressão de ordem do DOM falhou antes da mudança e passou depois; testes de acesso e estrutura: 18 aprovados.
- Editor e regressões relacionadas: 83 testes aprovados em sete arquivos.
- Chromium com os componentes reais Employees/AlertDialog, estado sintético em memória: reprodução falhou antes da proteção e passou depois. Conferidos troca limpa, edição pendente, cancelamento, descarte, adição, Escape, primeiro foco/retorno ao editor, validação inválida, aplicação, reversão e ausência de gravação ao descartar. Isso não equivale à aplicação completa com banco.
- Suíte de cobertura: 479 arquivos, 4.759 testes aprovados e 3 ignorados. A primeira execução teve cinco falhas de PDF por ausência de Poppler; após instalação, os 32 testes dos dois módulos e a suíte completa passaram.
- Typecheck e lint integral passaram; limite de tamanho dos 552 módulos e cobertura funcional das 81 rotas passaram.
- O comando quality:code local ainda terminou com falha na análise de código morto: RangeError de alocação em oxc-parser/Knip no sandbox, inclusive com Node 24.19.0. Não foi alterada ou desativada essa verificação; exigir confirmação no CI com seu ambiente habitual.

## Verificação exigida para integrar

Executar CI da revisão final, incluindo build, qualidade completa e E2E isolado. Os novos cenários em escalas-employee-draft.spec.ts usam exclusivamente banco descartável e verificam também a persistência; não foram executados com banco no sandbox. O CI 508 validou qualidade/build da revisão anterior, mas falhou nos seletores de login; não é aprovação da revisão final.

Revisar as capturas reais e o comportamento em telas estreitas/teclado. A proteção local não é restauração persistente de rascunho após fechar o navegador e não substitui o controle de conflitos do planejamento. Merge e deploy não fazem parte desta entrega.
