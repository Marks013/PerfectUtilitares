# Auditoria e correções do Solver e do CI — 06/11/2026

## Escopo e preservação

A intervenção foi realizada em /home/ubuntu/PerfectUtilitares. Nenhuma grade foi aplicada ou salva durante os comparativos. Não foram alterados banco, migrações, senhas, segredos, dependências ou regras de jornada. O processamento continua limitado a um cálculo simultâneo e ao orçamento existente.

## Correções

### Transporte das grades e continuidade

O aplicativo remove somente employeeId de history, planningHistory e planningFuture: a identidade já pertence ao colaborador que contém esses arrays. Datas, turnos, ausências, bloqueios e todos os demais campos são preservados. A lista plana assignments não é compactada e a validação independente utiliza o input completo original.

Aplicativo e serviço passam a compartilhar limite explícito de 8 MiB, contado em UTF-8. O envio excessivo é recusado antes da rede; HTTP 413 do serviço recebe código SOLVER_INPUT_TOO_LARGE e explicação própria, sem sugerir apagar colaboradores ou históricos. O limite público de SAVE permanece em 4 MiB, o de resposta em 8 MiB e o de cancelamento em 1 KiB.

No caso sintético de 250 pessoas e seis semanas, com identificadores de 65 caracteres e continuidade de 21 dias em cada fronteira, o schema aceitou os dados. O SAVE ocupou 3.707.153 bytes; o envio anterior ocuparia 5.264.854 bytes e excedia o serviço antigo. A forma compacta ocupa 3.280.354 bytes, sem excluir contexto de planejamento.

A elevação do limite aumenta o teto bruto de corpos dos 16 handlers de 80 para 128 MiB, antes do parsing. A autenticação continua anterior à leitura do corpo. Não foi executado teste de carga.

### Proteções das fases secundárias

As expressões de proteção são identificadas por seus termos lineares. Um limite só é acrescentado quando é mais estrito que o já registrado. Offsets equivalentes e coeficientes repetidos são normalizados. A contagem de proveniência continua conservadora para não transformar um resultado FEASIBLE em uma declaração indevida de otimalidade.

No modelo determinístico de quatro fases, o total de restrições caiu de 49 para 19 e as cópias de cada guarda, de dez para uma. Objetivos, solução, fases e indicador proven permaneceram iguais. Os limites por setor, período e domingo continuam ativos desde o primeiro objetivo; não houve mudança de prioridade.

### Cancelamento e consulta de estado

A autorização de operações consulta somente os metadados da filial e a permissão atual. Não carrega revisões nem revalida a grade antes de cancelar ou consultar estado. Foram preservados tenant, proprietário da operação, existência do workspace, permissão de edição e atualizações condicionais de estado.

Os testes incluem sucesso sem consulta de revisão e rejeição por outro tenant, proprietário, filial revogada, workspace ausente e permissão somente de leitura.

### Falha de qualidade no CI

A execução 42212620326, revisão 780ccba, falhou em pdf-compression-safety.spec.ts: esperava COMPRESSED, GRAYSCALE e validação semântica, mas recebeu UNCHANGED sem transformação. O worker de teste era executado no host, onde o caminho /app/jpeg-xobject-resample.py e as dependências da imagem PDF não eram provisionados.

O CI agora prepara o target pdf-worker do Dockerfile existente e usa essa imagem nos testes de navegador. O runner ARM64 corresponde aos hashes dos wheels existentes. O preflight confere revisão da imagem, ferramentas, scripts e imports Python. Não foram introduzidos novos locks nem afrouxadas as asserções do teste.

O worker recebe somente variáveis permitidas, por nome, sem valores secretos nos argumentos. Utiliza usuário não-root, recursos limitados e apenas dois mounts temporários: armazenamento e heartbeat. Um symlink exclusivo permite ao aplicativo ler o heartbeat sem montar o checkout ou .env. A limpeza usa o ID exato do contêiner e verifica o alvo do symlink. O modo host anterior permanece disponível quando a imagem não é configurada.

## Validação

- npm run quality:code foi executado uma vez e aprovado: 313 arquivos Vitest, 2.435 testes aprovados e três ignorados, além de Prisma, tipos, lint, testes operacionais, código morto, tamanho de módulos e cobertura de rotas.
- As três regressões Python de deduplicação falharam no baseline e passaram com a correção. Ao todo, 55 testes focados de otimização, domingos e mês visível passaram no runtime atual, carregando fontes em memória.
- Cinco testes de transporte passaram, incluindo exatamente 8 MiB, 8 MiB + 1, UTF-8 e o limite separado de cancelamento.
- Os três testes do helper de runtime E2E passaram e foram incluídos em test:ops.
- Os scripts Node passaram em node --check, o workflow foi parseado e git diff --check passou.
- O preflight das ferramentas PDF também passou dentro do worker já utilizado em produção.
- A configuração Compose foi validada com acesso aos arquivos protegidos.
- As alterações de transporte e CI receberam revisão independente.

## Comparativo com planejamentos existentes

Cada versão recebeu o mesmo input preparado, sem salvar resultados. São execuções independentes e limitadas por tempo, não provas de ótimo nem garantia de repetir os mesmos resultados.

| Filial | Tempo anterior / novo | Desfalque estimado anterior / novo | Domingo anterior / novo | Validação |
| --- | --- | --- | --- | --- |
| 07 | 12.216 / 12.145 ms | 73.856 / 74.902 | 13.734 / 15.846 | Ambas válidas, 5.712 atribuições, nenhum dia pendente |
| 08 | 12.070 / 12.054 ms | 46.539 / 46.539 | 7.003 / 7.003 | Ambas válidas, 3.192 atribuições, nenhum dia pendente |
| 11 | 12.119 / 12.045 ms | 46.969 / 46.969 | 3.081 / 3.081 | Ambas válidas, 3.654 atribuições, nenhum dia pendente |

O desfalque está em pessoas-minutos do mês visível, segundo a conferência TypeScript. A filial 07 apresentou piora em dois setores nessa comparação; portanto, esta entrega não comprova redução geral dos desfalques. As proteções comparam o resultado ao incumbent viável da própria execução, não a outra execução anterior. Também são agregadas por setor e período, não uma garantia para cada faixa isolada.

As contagens de restrições na última busca foram 51.406 para 51.086 na 07, 28.788 para 28.513 na 08 e 33.764 para 33.472 na 11. O ganho comprovado é a eliminação de trabalho redundante; o tempo total permanece próximo do orçamento de 12 segundos.

## Limites da verificação

Não foi executado ambiente E2E isolado no servidor. O novo workflow não foi acompanhado em execução no GitHub; seu próximo resultado remoto permanece sujeito à confirmação do usuário. Nenhum teste ou gate foi desativado para ocultar a falha original.

Referências: https://github.com/Marks013/PerfectUtilitares/actions/runs/42212620326 e https://docs.github.com/en/actions/reference/runners/github-hosted-runners.
