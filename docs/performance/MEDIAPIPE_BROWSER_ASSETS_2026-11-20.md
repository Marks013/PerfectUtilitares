# A11 | Verificação de assets MediaPipe no navegador

Este trabalho **não remove ativos**, não muda a rotina de detecção e não importa nenhuma fotografia real. Ele acrescenta uma auditoria reproduzível no Chromium do teste E2E isolado e configura cache da versão do modelo já presente em `web/public/mediapipe/models`.

## Inventário estático de referência

| Asset | Tamanho no repositório |
| --- | ---: |
| `vision_wasm_internal.wasm` | 11.756.954 bytes |
| `vision_wasm_module_internal.wasm` | 11.756.972 bytes |
| `vision_wasm_nosimd_internal.wasm` | 10.960.242 bytes |
| `vision_bundle.mjs` | 155.439 bytes |
| `blaze_face_short_range.tflite` | 229.746 bytes |

As três variantes WASM somam aproximadamente 34,5 MB no checkout; **não significa que um visitante baixe todas**. O `FilesetResolver` escolhe uma implementação conforme o navegador. O projeto mantém também arquivos de inicialização JavaScript para cada variante. O modelo facial possui SHA-256 fixado em `scripts/sync-mediapipe.mjs`.

## Mudança verificada

O `next.config.ts` já usa `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` em `/mediapipe/tasks-vision/:path*`. O modelo TFLite local passará a usar o mesmo cabeçalho, sem remover o arquivo e sem publicar dados do usuário. Isso evita um TTL divergente entre WASM e modelo local.

`web/e2e/mediapipe-assets.spec.ts` inspeciona em navegador real: acesso same-origin, tamanho baixado, código HTTP, content-type WASM, cabeçalho de cache, tempo do request e `PerformanceResourceTiming`, validação estrutural de variantes WASM com SIMD e sem SIMD, mais CSP/X-Frame-Options do frame. As métricas são registradas em stdout como `[mediapipe-browser-assets]`, sem modelo de reconhecimento de imagens pessoais.

O teste baixa deliberadamente dois arquivos WASM para verificar as duas variantes. Esse **comportamento de auditoria** não representa necessariamente o tráfego normal da aplicação, que carrega os assets conforme a necessidade. Não inferir ganho de velocidade nem consumo real da tela apenas dessa prova.

## Pendências que continuam abertas

- Medir o waterfall **da rotina completa de detecção**, tanto em navegador com SIMD quanto em ambiente de fallback realmente sem SIMD.
- Confirmar cache hit/miss em runtime representativo e compressão da entrega.
- Conferir se há necessidade operacional e aprovação para mudar caminhos, versões ou remoção de bundles.
- Não alterar segurança do frame, não baixar imagens reais e não ativar servidor de produção nesta prova.

A11 só será encerrado quando o caminho funcional e seu fallback forem validados ponta a ponta nas condições alvo. Nenhuma migração, autenticação, folha ou escala é modificada.
