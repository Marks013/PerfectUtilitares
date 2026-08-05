# Correções pós-auditoria

## Escopo

1. Tornar fila PDF idempotente sob requisições simultâneas e proteger estados terminais no worker.
2. Suportar 0 a 6 dependentes no RN561 sem omissão, corrigindo também rodapé do modelo.
3. Expandir casos de referência Unimed: motivos, fechamento, datas-limite, meses, faixas etárias e arredondamento.
4. Remover resíduos de deploy, dependências sem uso e vulnerabilidade Nodemailer sem quebrar autenticação.
5. Corrigir importação de endereços aceitando `N` e `No.`; diagnosticar conciliação de faturas, dependentes e planos ambíguos com alertas acionáveis.
6. Tornar módulo Unimed público, mas bloqueado por senha; identificar perfil padrão/admin por hash e manter sessão em cookie seguro.
7. Publicar por sincronização com exclusões seguras; dados, templates e configurações seguem em bind mounts do host.
8. Validar no servidor: lint, typecheck, testes, build, E2E PDF/Unimed, segurança, concorrência, importações e renderização de documentos.

## Responsabilidade paralela

- `pdf_queue_fix`: fila, worker e regressões de concorrência.
- `unimed_document_fix`: RN561, template, casos de cálculo e regressões de 0 a 6 dependentes.
- `unimed_import_access_fix`: importações, conciliação e acesso público protegido por perfil.
- Agente principal: dependências, deploy, integração, backup, publicação e validação final no servidor.

## Aceite

- Duplo clique simultâneo processa uma vez e nunca rebaixa `SUCCEEDED` para `FAILED`.
- RN561 inclui todos os dependentes até limite funcional de 6 e renderiza sem corte.
- Importação aceita ambos os cabeçalhos de número; alertas explicam registros sem vínculo/ambíguos sem associação insegura.
- Módulo Unimed exige senha própria; sessão não expõe senha nem depende do login geral.
- Testes e build passam no servidor; `npm audit --omit=dev` sem vulnerabilidade alta/crítica.
- Produção saudável; nenhum e-mail real enviado; arquivos temporários de teste removidos.
