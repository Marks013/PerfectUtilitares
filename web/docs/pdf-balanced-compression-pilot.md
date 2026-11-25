# Piloto de compactação de PDF — Equilibrado

## Escopo e requisitos

O perfil Equilibrado já usa 150 DPI, JPEG 72 e preservação da tonalidade em [compression-policy.ts](../src/lib/pdf/compression-policy.ts). O [worker](../src/lib/pdf/compression-image-recompression.ts) chama o recompressor preservador de JPEGs com até 30 s; o [recompressor](../src/lib/pdf/jpeg-xobject-resample.py) limita a decodificação a 250 milhões de pixels e pode aceitar uma saída parcial. A ordem atual é a do inventário, não a de economia esperada. Quando um JPEG não cabe, a execução parcial padrão para, mesmo que uma imagem posterior menor pudesse ser tratada.

O comparador offline mantém os limites clássicos para medir apenas a ordem. O worker usa a ordem por ganho estimado de bytes por pixel no perfil Equilibrado com a opção de manter a tonalidade detectada, inclusive em PDFs mistos com imagens pesadas quando elegíveis. A estimativa usa metadados; uma imagem só é substituída se os bytes codificados diminuírem. Imagens que não cabem no orçamento não impedem o processamento das seguintes. Não há conversão de cor nem achatamento de páginas neste caminho.

O limite clássico desta etapa era de 300 páginas, 300 objetos de imagem e 250 milhões de pixels decodificados. Em PDFs elegíveis de 301 a 900 páginas, o novo caminho admite até 1.800 objetos de imagem e até 1 bilhão de pixels por arquivo, mantendo o teto de 24 milhões por imagem. Entre imagens, o motor encerra a decodificação após 75 s e grava o trabalho concluído; o subprocesso tem teto de 120 s, sujeito ao limite configurado e ao cancelamento do job. Esses tetos não são um prazo de fila. O worker ainda valida o candidato e mantém as alternativas existentes se ele falhar ou não oferecer ganho suficiente. A concorrência por lote não aumenta. O Compose mantém o piloto desativado por padrão. Use `PDF_BALANCED_JPEG_PRIORITY=1` no ambiente de interpolação do Compose para habilitar a ordem nova e o orçamento estendido; `0` restaura o caminho anterior.

## Como comparar

No ambiente local equivalente ao worker Linux, com as dependências já usadas pela imagem (`pikepdf`, Pillow e Poppler com `pdfimages`, `pdfinfo` e `pdftotext`):

```sh
python3 web/scripts/pdf/benchmark-balanced.py --scratch-dir /caminho/local/temporarios /caminho/local/arquivo.pdf
```

Use um diretório temporário privado já existente. O comparativo executa a ordem padrão e a ordem experimental no mesmo arquivo, com 30 s por subprocesso por padrão. A medição é dessa etapa JPEG, não da fila nem do processamento completo do produto. O original não é sobrescrito. Só publique métricas agregadas; documentos reais e texto extraído não pertencem ao GitHub. Preservar o número de páginas e o texto extraível é uma triagem, não uma prova visual. Antes de ativar, comparar também texto pequeno a 100%, linhas finas, carimbos, tabelas e gráficos, incluindo páginas longe do início. O [verificador existente](../src/lib/pdf/compression-semantic.ts) segue obrigatório na integração do worker.

## Próximas entregas e critérios

1. **Equilibrado:** medir o caso PGR completo e a referência AET com o motor atual e a candidata no mesmo runtime. Meta no PGR: perto de 42%, com 40% como critério inicial de aceite, somente se a legibilidade e estruturas forem preservadas. No AET, comparar com os 21,7% observados anteriormente com as mesmas opções. Forçar uma redução não é permitido. Se 150 DPI não tiver margem, avaliar 130 DPI apenas em imagens de baixo risco, antes de uma única passada completa.
2. **Arquivos longos e lote:** os testes sintéticos processam PDFs de 100, 500 e 900 páginas em sequência e verificam redução e ordem das páginas. Eles substituem o inventário externo por linhas sintéticas e não medem a fila. Antes de publicar, medir inventário, decodificação, gravação, validação, tempo e memória no ambiente Linux do worker. Verificar PDFs longos representativos e um lote misto dentro do limite de upload, sem ampliar concorrência.
3. **Automático:** decidir por documento. Otimizar estrutura em texto/vetor, preferir o Equilibrado em digitalizações e mistos quando houver ganho e conservar originais já otimizados. Sem conversão automática para preto e branco ou rasterização de páginas.
4. **Compacto:** avaliar conversão para 1 bit somente em digitalizações textuais elegíveis. Usar JBIG2 genérico, sem substituição de símbolos e com conferência de decodificação. Preservar fotos, carimbos, gráficos e cor necessária; converter cinza ou cor para 1 bit é perda, mesmo que o codificador preserve os bits resultantes.
5. **Impressão:** preservar texto e vetores nativos, perfis de cor e linhas finas. Em imagens e gráficos reduzir conservadoramente acima de 220 DPI; em texto digitalizado simples avaliar 180 DPI com piso de 150 DPI condicionado à leitura. Nunca ampliar o original para atingir um alvo.

Liberar cada perfil separadamente após essas provas. Manter o caminho anterior como retorno reversível. Trabalho interrompido, PDF inválido, saída maior ou perda de conteúdo não devem virar sucesso. Este piloto não atesta a redução do PGR, legibilidade no PDF real ou duração de lote.
