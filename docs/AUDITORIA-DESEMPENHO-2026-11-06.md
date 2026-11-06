# Auditoria de desempenho e entradas — 06/11/2026

Base auditada no servidor: `a78a97e`. A rodada cobre validação de Escalas,
compressão PDF, uploads de Fotos e retenção da Jornada.

## Correções

- **Escalas:** o verificador independente reutiliza conversões de hora civil
  para uma mesma data e minuto durante uma validação. Reavalia cada pessoa,
  mantém o cálculo de fuso, e descarta o cache ao retornar. O Solver, as regras,
  a cobertura e os planejamentos salvos não foram alterados.
- **PDF:** o fallback estrutural opcional da recompressão de imagens compara
  o tamanho com o mesmo critério da seleção final antes de renderizar páginas
  e extrair a assinatura semântica. Os candidatos elegíveis continuam sujeitos
  aos mesmos controles. O modo lossless explícito não mudou.
- **Fotos:** uploads passam pela assinatura real de JPG, PNG ou WebP e ela
  deve coincidir com o MIME informado. O Sharp continua responsável por
  decodificar, validar e processar o arquivo. Não foi trocado o pipeline.
- **Jornada:** o PDF do histórico usa o mesmo limite de 30 dias da listagem.
  Registros vencidos não são mais selecionados antes da execução do expurgo.
  Não há alteração na retenção física, no escopo por usuário nem no Sentry.

## Evidência

Benchmark sintético da validação de Escalas no servidor: 250 pessoas,
seis semanas, quatro turnos e 10.500 atribuições. Após aquecimento,
sete medições por revisão: mediana de 1.575 para 1.183 ms, redução de 24,9%.
As 250 sínteses, 262 ocorrências e demais campos tiveram SHA-256 idêntico
na saída serializada. Não mede a geração completa nem a qualidade do Solver.

Os testes focados cobrem intervalos por colaborador, fallback PDF acima e
abaixo do corte, formatos reais de imagem e o limite da retenção da Jornada.
