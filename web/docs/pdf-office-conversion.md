# Conversão local de PDF para Word, Excel e JPG

## Funcionamento

O processador reconstrói documentos editáveis com `pdfplumber`, `python-docx` e `openpyxl`. A conversão não envia arquivos a serviços externos. Word prioriza o equilíbrio entre aparência e edição: fontes, tamanhos, cores, imagens, tabelas, colunas e dimensões de página são reconstruídos a partir das coordenadas do PDF. As páginas mantêm suas divisões por meio de seções do Word; documentos maiores que o limite físico do Word são escalados proporcionalmente.

Excel cria uma aba por página. Tabelas com linhas e tabelas sem bordas identificadas com confiança recebem células separadas. Texto externo às tabelas permanece na planilha. Valores decimais brasileiros inequívocos tornam-se números; identificadores, zeros iniciais e números inteiros ambíguos permanecem texto. Conteúdo iniciado por `=` permanece texto, sem gerar fórmulas.

Páginas digitalizadas sem texto passam pelo OCRmyPDF/Tesseract já instalado, em português e inglês. Uma página digitalizada cujo texto não foi reconhecido gera erro explícito, em vez de um arquivo silenciosamente vazio. O OCR não recupera perfeitamente tipografia, fotos e estrutura de digitalizações; esses documentos e layouts complexos exigem revisão. A conversão é geométrica, sem modelo generativo que invente conteúdo.

JPG aplica o mesmo recorte e rotação do editor, preserva CropBox, usa subamostragem 4:4:4 e grava os DPI no arquivo. O padrão é 200 DPI/90%, com controles de resolução e qualidade salvos no rascunho. O processamento mantém somente uma página rasterizada por vez.

## Dependências, cache e limites

- `ops/pdf-worker/office-requirements.txt` fixa 13 dependências diretas e transitivas com SHA256 dos wheels da plataforma atual: ARM64, musl e Python 3.14. Outra plataforma exige regenerar e verificar o lock.
- `/opt/pdf-office` é uma venv isolada, sem pacotes Python do sistema. O OCR existente usa o runtime do sistema e não é atualizado por essa instalação.
- O estágio Docker `pdf-office-deps` instala e verifica as dependências antes da cópia do código. O cache BuildKit de pip é exclusivo da plataforma e usa `sharing=locked`; não integra a imagem final.
- O worker copia somente a venv e os três módulos Python de produção. Testes e ferramentas de instalação adicionais não são copiados para o runtime final.
- Cada conversão usa diretório privado em `job/work/UUID`; cache de fontes e temporários ficam nesse diretório e são removidos ao concluir ou falhar.
- Limites Office: 5 PDFs por lote, 100 páginas por arquivo, 100.000 caracteres por página, 40 megapixels na análise gráfica, 1,5 GiB de espaço de endereçamento do subprocesso e até 8 minutos por lote. OCR usa um processo, até 45 segundos por página e 240 segundos no total. Saída máxima: 100 MB.
- Timeout encerra o grupo de processos, incluindo OCR, antes da limpeza. O paralelismo e os limites existentes do worker permanecem em vigor.
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

## Referências técnicas

- [pdfplumber: extração e limitações](https://github.com/jsvine/pdfplumber)
- [python-docx: texto e parágrafos](https://python-docx.readthedocs.io/en/latest/user/text.html)
- [python-docx: seções](https://python-docx.readthedocs.io/en/latest/user/sections.html)
- [OCRmyPDF: processamento por páginas e limites do OCR](https://ocrmypdf.readthedocs.io/en/stable/cookbook.html)
