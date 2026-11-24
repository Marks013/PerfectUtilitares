# Piloto de compactação de PDF — Equilibrado

## Escopo e requisitos

O perfil Equilibrado já usa 150 DPI, JPEG 72 e preservação da tonalidade em [compression-policy.ts](../src/lib/pdf/compression-policy.ts). O [worker](../src/lib/pdf/compression-image-recompression.ts) chama o recompressor preservador de JPEGs com até 30 s; o [recompressor](../src/lib/pdf/jpeg-xobject-resample.py) limita a decodificação a 250 milhões de pixels e pode aceitar uma saída parcial. A ordem atual é a do inventário, não a de economia esperada. Quando um JPEG não cabe, a execução parcial padrão para, mesmo que uma imagem posterior menor pudesse ser tratada.

Esta etapa adiciona uma comparação offline. O piloto prioriza o ganho estimado de bytes por pixel de origem, usando somente metadados antes de abrir as imagens. Ele ignora candidatas que não cabem no orçamento restante. O piloto mantém 150 DPI, qualidade 72, os mesmos limites por documento/imagem e as mesmas verificações de elegibilidade; não converte cor ou achata páginas. A estimativa só ordena a tentativa: uma imagem só é substituída se os bytes codificados efetivamente diminuírem. A opção experimental não é passada pelo worker, portanto o comportamento do site não muda neste PR.

## Como comparar

No ambiente local equivalente ao worker Linux, com as dependências já usadas pela imagem (`pikepdf`, Pillow e Poppler com `pdfimages`, `pdfinfo` e `pdftotext`):

```sh
python3 web/scripts/pdf/benchmark-balanced.py --scratch-dir /caminho/local/temporarios /caminho/local/arquivo.pdf
```

Use um diretório temporário privado já existente. O comparativo executa a ordem padrão e a ordem experimental no mesmo arquivo, com 30 s por subprocesso por padrão. A medição é dessa etapa JPEG, não da fila nem do processamento completo do produto. O original não é sobrescrito. Só publique métricas agregadas; documentos reais e texto extraído não pertencem ao GitHub. Preservar o número de páginas e o texto extraível é uma triagem, não uma prova visual. Antes de ativar, comparar também texto pequeno a 100%, linhas finas, carimbos, tabelas e gráficos, incluindo páginas longe do início. O [verificador existente](../src/lib/pdf/compression-semantic.ts) segue obrigatório na integração do worker.

## Próximas entregas e critérios

1. **Equilibrado:** medir o caso PGR completo e a referência AET com o motor atual e a candidata no mesmo runtime. Meta no PGR: perto de 42%, com 40% como critério inicial de aceite, somente se a legibilidade e estruturas forem preservadas. No AET, comparar com os 21,7% observados anteriormente com as mesmas opções. Forçar uma redução não é permitido. Se 150 DPI não tiver margem, avaliar 130 DPI apenas em imagens de baixo risco, antes de uma única passada completa.
2. **Arquivos longos e lote:** medir inventário, decodificação, gravação e validação em separado, e registrar o tempo e a memória agregada. Se a seleção apenas reordenada não for suficiente, investigar janelas cooperativas de 250 milhões de pixels, até 1 bilhão por arquivo e teto inicial de 120 s de trabalho ativo. Estes são candidatos para ensaio, não valores ativados nem SLA. Verificar quatro PDFs longos dentro do limite de upload e um lote misto; manter a mesma oportunidade para cada PDF, sem ampliar concorrência ou repetir passadas completas.
3. **Automático:** decidir por documento. Otimizar estrutura em texto/vetor, preferir o Equilibrado em digitalizações e mistos quando houver ganho e conservar originais já otimizados. Sem conversão automática para preto e branco ou rasterização de páginas.
4. **Compacto:** avaliar conversão para 1 bit somente em digitalizações textuais elegíveis. Usar JBIG2 genérico, sem substituição de símbolos e com conferência de decodificação. Preservar fotos, carimbos, gráficos e cor necessária; converter cinza ou cor para 1 bit é perda, mesmo que o codificador preserve os bits resultantes.
5. **Impressão:** preservar texto e vetores nativos, perfis de cor e linhas finas. Em imagens e gráficos reduzir conservadoramente acima de 220 DPI; em texto digitalizado simples avaliar 180 DPI com piso de 150 DPI condicionado à leitura. Nunca ampliar o original para atingir um alvo.

Liberar cada perfil separadamente após essas provas. Manter o caminho anterior como retorno reversível. Trabalho interrompido, PDF inválido, saída maior ou perda de conteúdo não devem virar sucesso. Este piloto não atesta a redução do PGR, legibilidade no PDF real ou duração de lote.
