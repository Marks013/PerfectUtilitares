# Auditoria de validação e mídia — 06/11/2026

Base: `f6d1481`. Alterações restritas ao código de Escalas, PDF e Fotos,
sem migração, troca de dependência ou alteração de credenciais.

- **Escalas:** o verificador separa atribuições, jornadas e reservas por
  colaborador. Reutiliza o calendário e soma cada jornada à semana uma vez.
  As regras, a ordem das ocorrências, o Solver e a cobertura não mudam.
- **PDF:** a verificação semântica observa o cancelamento entre páginas e
  antes de iniciar o candidato. O PDF.js é encerrado mesmo se falhar na
  abertura, e o motivo original do cancelamento é preservado. A operação
  síncrona que já estiver em curso não é interrompida à força.
- **Fotos:** sem recorte manual, a orientação EXIF e o redimensionamento
  acontecem antes da única codificação de saída. O recorte manual conserva
  o caminho anterior, com os mesmos limites e checagem de formato.

## Verificação

Escalas: 250 colaboradores, quatro turnos, seis semanas e 10.500 atribuições
sintéticas. Sete amostras por revisão após aquecimento. Mediana de 1.187 ms
para 718 ms (-39,5%); o SHA-256 da saída completa foi idêntico. O resultado
mede o verificador, não o tempo total de geração nem a qualidade do Solver.

As regressões de PDF cobrem a liberação do documento e a parada entre páginas.
Fotos: cinco amostras alternadas por variante de um JPEG sintético de
1.800 × 1.200. Para EXIF 6, mediana de 94,68 para 57,57 ms. Nas quatro
orientações avaliadas, a saída manteve 354 × 472 e não reteve EXIF. Sem
recorte, os bytes mudam com a eliminação da codificação intermediária;
com recorte, a saída foi idêntica nos quatro cenários.
