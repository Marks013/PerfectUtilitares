# Conversão local de PDF para Word, Excel e JPG

## Funcionamento

O processador reconstrói documentos editáveis com `pdfplumber`, `python-docx` e `openpyxl`. A conversão não envia arquivos a serviços externos. Word prioriza o equilíbrio entre aparência e edição: fontes, tamanhos, cores, imagens, tabelas, colunas e dimensões de página são reconstruídos a partir das coordenadas do PDF. As páginas mantêm suas divisões por meio de seções do Word; documentos maiores que o limite físico do Word são escalados proporcionalmente.

Excel cria uma aba por página. Tabelas com linhas e tabelas sem bordas identificadas com confiança recebem células separadas. Texto externo às tabelas permanece na planilha. Valores decimais brasileiros inequívocos tornam-se números; identificadores, zeros iniciais e números inteiros ambíguos permanecem texto. Conteúdo iniciado por `=` permanece texto, sem gerar fórmulas.

Páginas digitalizadas sem texto passam pelo OCRmyPDF/Tesseract já instalado, em português e inglês. Uma página digitalizada cujo texto não foi reconhecido gera erro explícito, em vez de um arquivo silenciosamente vazio. O OCR não recupera perfeitamente tipografia, fotos e estrutura de digitalizações; esses documentos e layouts complexos exigem revisão. A conversão é geométrica, sem modelo generativo que invente conteúdo.

JPG aplica o mesmo recorte e rotação do editor, preserva CropBox, usa subamostragem 4:4:4 e grava os DPI no arquivo. O padrão é 200 DPI/90%, com controles de resolução e qualidade salvos no rascunho. O processamento mantém somente uma página rasterizada por vez.

### Ajustes da auditoria de setembro de 2026

Cartazes com decoração cobrindo a página mantêm a arte como fundo e o texto nativo como quadros editáveis. PDFium desativa os objetos de texto apenas na cópia em memória usada para renderizar o fundo; o PDF original permanece intacto. Fontes incorporadas com nomes anônimos recebem uma substituição disponível. A largura dos caracteres é ajustada pelas métricas do PDF, mas fontes decorativas não disponíveis podem manter diferenças visuais.

Tabelas Word preservam a altura das linhas e eliminam parágrafos vazios criados por mesclas. Texto ao lado de tabelas mantém sua posição em quadros editáveis. A extração considera as células efetivas, preservando identificadores presentes em lacunas da grade. No Excel, esses identificadores e as anotações permanecem associados às linhas; colisões e geometria irregular possuem alternativa que preserva o conteúdo. A impressão usa a orientação da página de origem e uma página de largura.

JPG reserva espaço para a numeração de páginas antes de limitar nomes longos. Erros determinísticos de limite ou ausência de texto reconhecido encerram o trabalho com seu código específico, sem repetir conversões que não podem melhorar com uma nova tentativa. Falhas transitórias continuam elegíveis às tentativas existentes.

O refinamento preserva preenchimentos e imagens nas células Word, sem criar linhas em tabelas detectadas sem bordas. Excel preserva mesclas verticais e retangulares, distingue alinhamento de identificadores e valores decimais, congela a região abaixo do cabeçalho detectado e repete esse cabeçalho na impressão de páginas com uma única tabela.

O editor salva rascunhos em sequência e aguarda a última gravação antes de processar. Falhas de rede ou sessão são exibidas e permitem nova tentativa. A área de anotação fica bloqueada durante a finalização e após a conclusão. Fonte e espessura acompanham a escala da prévia; a exportação mantém a orientação do texto em páginas giradas e o espaçamento de múltiplas linhas. As anotações são sobrepostas ao PDF; não substituem o texto original do documento.

## Dependências, cache e limites

- `ops/pdf-worker/office-requirements.txt` fixa 13 dependências diretas e transitivas com SHA256 dos wheels da plataforma atual: ARM64, musl e Python 3.14. Outra plataforma exige regenerar e verificar o lock.
- `/opt/pdf-office` é uma venv isolada, sem pacotes Python do sistema. O OCR existente usa o runtime do sistema e não é atualizado por essa instalação.
- O estágio Docker `pdf-office-deps` instala e verifica as dependências antes da cópia do código. O cache BuildKit de pip é exclusivo da plataforma e usa `sharing=locked`; não integra a imagem final.
- O worker copia somente a venv e os três módulos Python de produção. Testes e ferramentas de instalação adicionais não são copiados para o runtime final.
- Cada conversão usa diretório privado em `job/work/UUID`; cache de fontes e temporários ficam nesse diretório e são removidos ao concluir ou falhar.
- Limites Office: 5 PDFs por lote, 100 páginas por arquivo, 100.000 caracteres por página, 40 megapixels na análise gráfica, 1,5 GiB de espaço de endereçamento do subprocesso e até 8 minutos por lote. OCR usa um processo, até 45 segundos por página e 240 segundos no total. Saída máxima: 100 MB.
- Timeout encerra o grupo de processos, incluindo OCR, antes da limpeza. O paralelismo e os limites existentes do worker permanecem em vigor.
- Métricas de fontes usam cache limitado a 64 combinações por subprocesso. A auditoria não adiciona dependências nem altera limites de CPU, memória ou concorrência.
- JPG recusa imagens acima de 40 megapixels ou 8192 pixels por dimensão, com orientação para reduzir DPI ou recortar. Não reduz a resolução silenciosamente.

## Verificação reproduzível

Os testes Python geram PDFs sintéticos, reabrem DOCX/XLSX e renderizam DOCX novamente com LibreOffice. Cobrem tipografia, imagens, tabelas/mesclas, colunas, acentuação, CropBox, rotação, paginação, OCR, limites e erros sem conteúdo privado.

No servidor, após construir uma imagem com as dependências:

```sh
docker run --rm --network none --read-only --memory 2g --cpus 2 \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m -e XDG_CACHE_HOME=/tmp/cache \
  -v /home/ubuntu/PerfectUtilitares/web/src/lib/pdf:/source:ro -w /source \
  --entrypoint /opt/pdf-office/bin/python3 web-pdf-worker \
  office-export-tests.py
```

Os testes Vitest cobrem o subprocesso, timeout/limpeza, persistência dos arquivos, tipos MIME, rollback e renderização real JPG. Os testes Playwright cobrem seleção, limites de lote, reset e persistência das opções JPG.

O CI instala Poppler para os testes de renderização. O job Docker usa um runner ARM64 e `docker-compose.ci.yml`, que remove apenas a referência aos arquivos de ambiente de produção durante a validação de build. A publicação continua usando o Compose de produção e seus arquivos protegidos.

## Referências técnicas

- [pdfplumber: extração e limitações](https://github.com/jsvine/pdfplumber)
- [python-docx: texto e parágrafos](https://python-docx.readthedocs.io/en/latest/user/text.html)
- [python-docx: seções](https://python-docx.readthedocs.io/en/latest/user/sections.html)
- [OCRmyPDF: processamento por páginas e limites do OCR](https://ocrmypdf.readthedocs.io/en/stable/cookbook.html)
- [PDFium: estado de objetos da página](https://pdfium.googlesource.com/pdfium/+/main/public/fpdf_edit.h)
- [Open XML: quadros editáveis e posicionamento](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.frameproperties?view=openxml-3.0.1)
