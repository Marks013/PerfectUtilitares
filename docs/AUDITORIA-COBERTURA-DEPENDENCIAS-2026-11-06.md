# Auditoria de cobertura, PDF e dependências — 06/11/2026

Base: `485f119`. Sem alterações no Solver, banco, credenciais ou lockfiles.

## Correções e evidência

- **Escalas:** reutiliza horários de cobertura por turno e data, e o índice
  de presença entre setores na edição. Regras de jornada e contagem intactas.
  Em 250 pessoas, seis semanas, 10.500 atribuições e 4.032 demandas sintéticas,
  a mediana da validação completa caiu de 846 para 504 ms (-40,4%).
  Sete medições após aquecimento em cada versão; SHA-256 da saída idêntico.
- **PDF:** o candidato validado é movido entre caminhos temporários irmãos,
  sem cópia integral. A entrada original continua preservada. Assinatura,
  `fsync`, SHA-256 e publicação final mantidos. Falha no movimento descarta
  a reserva.
- **Jornada:** validação simples usa o tipo de dia informado. Sem o campo,
  mantém dia útil. Os testes usam o validador real e verificam resposta
  e dados enviados à persistência; modos duplos não mudaram.

## Dependências e decisão

- npm: 710 entradas avaliadas pelo `npm audit`, com zero avisos conhecidos.
  NPMScan confirmou zero achados no relatório. São 41 dependências diretas
  de produção e 19 de desenvolvimento; os 60 nomes efetivos foram
  consultados por versão no registro público, incluindo o alias de Nodemailer.
  Nenhuma flag de depreciação nas versões diretas ou no lockfile.
- Python: 38 versões fixadas verificadas no OSV, com zero avisos conhecidos.
  Isso não certifica ausência de falhas desconhecidas, malware ou riscos de licença.
- `npm outdated`: 38 entradas divergiram do dist-tag ou da faixa declarada.
  `jszip` 3.10.2 e `@types/pdfkit` 0.17.7 cabem nas faixas. Sem benefício
  demonstrado nesta rodada, o lockfile foi preservado. NextAuth 4.24.15
  seria um downgrade do beta 5; Prisma 8 anunciado é pré-lançamento.

### Comparação para ZIP

Snapshot NPMScan em 06/11/2026; métricas de registro, não benchmark do projeto.

| Pacote | Downloads semanais e tendência | GitHub | Manutenção, tipos e sinais |
| --- | ---: | ---: | --- |
| [JSZip](https://npmscan.com/package/jszip) | 71.116.368; crescente | 10.395 | Ativa, popularidade muito alta, TS integrado, sem depreciação ou aviso conhecido na última versão, sem scripts de instalação |
| [fflate](https://npmscan.com/package/fflate) | 151.660.913; crescente | 3.081 | Ativa, popularidade muito alta, TS integrado, sem depreciação ou aviso conhecido na última versão, sem scripts de instalação |
| [zip.js](https://npmscan.com/package/%40zip.js%2Fzip.js) | 8.574.823; crescente | 3.907 | Ativa, popularidade muito alta, TS integrado, sem depreciação ou aviso conhecido na última versão, sem scripts de instalação |

NPMScan indicou JSZip, seguido de fflate, com confiança baixa: “jszip: widely used (71,116,368 weekly downloads); actively maintained (published 58d ago); ships built-in TypeScript types; no known vulnerabilities in its latest version.”
fflate teve a menor estimativa de tamanho instalado, mas a migração exigiria preservar limites de leitura de XLSX, integridade de DOCX e ZIPs de Fotos. Sem ganho medido nesses fluxos, manter JSZip reduz risco; nenhuma biblioteca nova foi instalada.
