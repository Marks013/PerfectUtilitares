# Refatoração por responsabilidade — 10/09/2026

Base: `9e4929ce6e5a99438987a59256f7cf108fff7bd9`.
Ordem de execução: Fotos 3×4, gestão de usuários e cálculo Unimed.

## Contratos

- Fotos: o controlador compõe quatro hooks. Preferências cuidam do formulário e armazenamento; edição cuida de arquivos, seleção, URLs e geometria; processamento cuida das requisições e downloads; detecção cuida do enquadramento facial individual e em lote.
- Usuários: um hook coordena estado e formulários; operações ficam em um módulo próprio; lista, edição, empresas e convites têm componentes com propriedades restritas ao que consomem.
- Unimed: a rota mantém autenticação, origem, limites, validação HTTP e resposta. O schema valida a entrada, o repositório consulta dados por tenant, o módulo de preços resolve valores oficiais e o serviço monta a entrada do cálculo e seu resultado.
- As fórmulas, as consultas por competência, a ordem de dependentes, as permissões e o modelo de acesso por módulo são preservados. A entrega não exige migração nem dependência nova.

## Ajustes encontrados durante a validação

O controlador antigo de Fotos também apagava o resultado concluído quando o Cropper remontava após o processamento. A reprodução em uma página temporária com o código original confirmou a origem anterior à refatoração. O hook de edição agora ignora notificações de geometria equivalentes; alterações reais continuam invalidando o resultado. A tolerância de 0,000001 aplica-se à posição e ao zoom, evitando diferenças de ponto flutuante na reinicialização.

Dois textos na administração ainda orientavam recuperar senha por convite. Foram alinhados ao fluxo atual de recuperação pela tela de login.

A edição administrativa revelou um erro anterior à refatoração: o retorno `void` de `pg_advisory_xact_lock` causava `UnsupportedNativeDataType` no Prisma. A consulta agora converte apenas o retorno para `text`, preservando o mesmo lock e o mesmo limite transacional. Esse padrão já era usado nos outros locks do projeto e segue a [orientação do Prisma para tipos não suportados em consultas SQL](https://www.prisma.io/docs/orm/v6/prisma-client/using-raw-sql/raw-queries).

## Verificação independente

A bateria antiga do projeto não foi usada como critério de aprovação, conforme solicitado.

- `node verification/architecture-check.mjs --compare-baseline`: sete testes novos, PostgreSQL descartável e comparação integral de status, cache e JSON com a rota anterior. Preços oficiais, ordem de dependentes, pró-rata, consignados, dia 25, fechamento aberto, dependente manual, isolamento de tenant e erros de entrada foram verificados.
- A comparação usa uma cópia temporária `verification/unimed-before.ts` da revisão base. Essa cópia é removida antes da publicação. O comando normal `node verification/architecture-check.mjs` executa os testes sem depender da cópia.
- Treze funções extraídas de Fotos mantiveram AST equivalente na comparação inicial. A correção de invalidação é verificada no navegador.
- Um oitavo teste real executa duas alterações administrativas concorrentes e verifica que somente uma pode remover um administrador ativo. Também verifica que a exclusão do último administrador permanece bloqueada.
- Layout: Fotos e administração em 375, 1024 e 1440 pixels, temas claro e escuro, sem overflow global nas 12 combinações.
- Fotos no navegador: seleção e substituição, ajustes por arquivo, recorte manual, JPEG, download repetido, invalidação após edição real, ZIP com duas imagens decodificadas e CRC válido, tratamento de ausência de rosto, preferências e liberação de URLs.
- O tamanho com a borda padrão é 364×482: o processador acrescenta 5 pixels externos aos 354×472 da foto. A refatoração preserva essa saída.
- Administração no navegador: edição e bloqueio com conferência SQL, criação de empresa, convite sem envio de e-mail, cópia do link, rejeição de convite para conta existente e exclusão confirmada na tela e no banco. As respostas foram 200, 201 e 409 conforme cada contrato.
- O verificador passou a limitar operações do navegador e consultas SQL. Na exclusão, verifica status, tela e banco, acompanhando o contrato consumido pela interface; a leitura adicional do corpo DELETE pelo Playwright em desenvolvimento não concluía.
- Verificações finais: `npx tsc --noEmit --pretty false`, Biome lint dos 18 arquivos de código alterados, `node --check` dos três scripts novos, `git diff --check` e `docker compose config --quiet`: aprovadas. Formatação aplicada somente aos arquivos desta entrega, sem mudar a configuração do projeto.

## Ferramentas

Context-mode: o atualizador oficial confirmou a versão 1.0.169 como a mais recente. Diagnóstico, execução e busca passaram; as ferramentas nativas voltaram a ficar disponíveis após a renovação da sessão. Nenhum banco persistente foi apagado.

Caveman: as duas cópias instaladas de `SKILL.md` foram atualizadas a partir do repositório oficial, revisão `15581d14007fd01fb3f132016741962f34936ca2`, com igualdade de conteúdo verificada e backups preservados. Fonte: [Caveman oficial](https://github.com/JuliusBrussee/caveman/blob/main/skills/caveman/SKILL.md).

## Recuperação

Backup verificado antes da publicação: `/home/ubuntu/perfectutilitares-config/audit-backup-1789058640353`.
O diretório contém o dump e a identificação das imagens anteriores. Os commits desta entrega preservam cada etapa.

As verificações administrativas usam usuários e empresas sintéticos em banco descartável. O envio de e-mail fica desativado no ambiente de verificação.
