# Escalas: simulação automática, interface e afastamentos

Estado: implementação e validação concluídas em 28/10/2026. Execução direta no servidor. Esta entrega dá seguimento à reestruturação histórica registrada em REESTRUTURACAO-2026-10.md; não substitui aquele registro por uma promessa pendente.

## Checklist executado

- [x] Fluxo central: filial/mês → equipe → jornada → gerar → revisar → exportar. Áreas internas Equipe, Escala, Cobertura e Ajustes, sem telas administrativas obrigatórias para gerar rascunho.
- [x] Jornada única: 44→42 atualiza referências da filial, preparação, capacidade e totais; 42h uniformes correspondem a 8h24 de trabalho em cinco dias. Originais e exceções individuais permanecem separados.
- [x] Simulação separada de aprovação: documentos ausentes não bloqueiam um rascunho tecnicamente viável. Nenhuma autorização ou informação jurídica é inventada. Descansos, ausências, bloqueios e mínimos explícitos continuam obrigatórios.
- [x] Cobertura estimada por setor e função, limitada à capacidade real; alternativas de turno não contam como presenças simultâneas. Divisão civil correta dos turnos noturnos. Estimativas não são garantias nem mínimos obrigatórios.
- [x] Horários curtos, referências noturnas e pessoas sem relógio preservados na proposta, sem exclusão automática. Cargo de gerente ou encarregado não implica enquadramento jurídico.
- [x] Folgas balanceadas por setor, função e liderança. CP-SAT valida o candidato inicial e mantém busca livre quando ele é rejeitado; não relaxa restrições para aceitar uma sugestão.
- [x] FPHI105 opcional: prévia por matrícula, períodos inclusivos, férias e afastamentos. Aplicação explícita, idempotente, preservando ausências existentes e decisões bloqueadas. Dados médicos não são importados.
- [x] Estados reais e mensagens de recuperação: pronto, processamento, conclusão, avisos e falha. Barra indeterminada, sem porcentagens fictícias. Proteção contra cliques duplicados e respostas desatualizadas.
- [x] Cenário desatualizado persiste ao salvar/reabrir; exportação desatualizada retorna 409. Apenas proposta concluída e validada elimina o marcador. Desfazer edição continua funcional com os metadados novos.
- [x] CSS do módulo centralizado, identidade visual preservada, revisão UI/UX Pro Max, contraste e navegação acessível. Fluxos em 375, 768 e 1280 pixels sem transbordamento da página; grade tem rolagem própria.
- [x] PDF operacional compacto: grade, horários originais/propostos e desfalques acionáveis. Todas as faltas obrigatórias permanecem; até 24 grupos estimados prioritários aparecem, com indicação explícita do recorte. Excel contém todos os detalhes nas cinco abas, com painéis e impressão configurados.
- [x] Revisão de autorização por filial, uploads, dados médicos, bloqueios, concorrência e respostas antigas. Sem novas dependências, alterações em segredos, migrações de dados ou testes sobre escalas reais de produção.

## Evidência real e independente

O FPRE136 original foi enviado apenas em memória, sem preparar artificialmente o conteúdo: 650 colaboradores, sete filiais, 49 cargos, 76 referências sem relógio e 39 referências curtas. Todas as filiais retornaram FEASIBLE, sem exclusões automáticas, sem erros no verificador TypeScript independente e sem modificar fontes ou autorizações. Foram conferidas 27.300 atribuições técnicas. FEASIBLE significa viável dentro do prazo, não ótimo global.

| Filial | Colaboradores | Desfalques estimados após balanceamento | Resultado |
| --- | ---: | ---: | --- |
| 02 | 62 | 678 | Viável; validação independente aprovada |
| 06 | 121 | 1.311 | Viável; validação independente aprovada |
| 07 | 143 | 1.115 | Viável; validação independente aprovada |
| 08 | 81 | 712 | Viável; validação independente aprovada |
| 11 | 92 | 939 | Viável; validação independente aprovada |
| 16 | 53 | 514 | Viável; validação independente aprovada |
| 18 | 98 | 989 | Viável; validação independente aprovada |

Na filial 02, o resultado anterior concentrava todas as folgas em segunda, sábado e domingo. A prova real detectou o defeito apesar de os testes sintéticos do candidato passarem. A integração foi corrigida e uma regressão passou a verificar o resultado final do solver. Distribuição final segunda–domingo: 98, 102, 96, 91, 89, 82 e 186 folgas. As faixas com desfalque estimado caíram de 824 para 678; isso não comprova demanda operacional suficiente.

O FPHI105 real contém 35 registros de férias no relatório de novembro de 2026. A conferência por filial encontrou, respectivamente, 5, 7, 5, 5, 4, 3 e 4 registros correspondentes; os demais são ignorados na filial atual, sem associação por nome. Na filial 02, foram conferidos 129 dias contra datas calculadas independentemente a partir do arquivo original. A geração real, persistência e relatórios preservaram esses períodos. O restante sem correspondência na equipe importada não foi associado artificialmente.

## Verificação executada

- Quality completo na integração inicial: código, operações, cobertura, dependências internas, tamanho, rotas e navegador; 52 testes de navegador aprovados e três condicionais não aplicáveis ignorados.
- Após os acréscimos, quality:code aprovado: 270 arquivos Vitest, 1.989 testes aprovados e três condicionais ignorados; operações 20/20. Gates de cobertura não foram reduzidos.
- Regressões posteriores focadas aprovaram persistência do cenário desatualizado, exportação 409, geração incompleta e desfazer edições. TypeScript, lint, dead-code, tamanho e gate de rotas aprovados.
- Python completo: 75 testes aprovados, incluindo 150 pessoas, 42 dias, 6.300 metas opcionais, ausências, bloqueios e equilíbrio no resultado final.
- Verificação cruzada Python/TypeScript: 21 cenários aprovados, incluindo soluções inviáveis esperadas e continuidade com períodos anteriores/posteriores.
- Cinco fluxos de navegador sobre o build de produção e banco descartável: importação, geração real, horas, troca, desfazer, persistência, férias, bloqueios, reabertura, exportação e exclusão isolada. As falhas encontradas foram corrigidas e revalidadas, sem repetir fluxos já aprovados sem motivo.
- PDF real conferido com PDF.js: texto, matrículas, jornada e limites de página; XLSX real aberto e conferido em seu conteúdo, inclusive dias de ausência e aba Desfalques. Arquivos sintéticos também tiveram limites geométricos e completude verificados.
- Compose aprovado com acesso aos arquivos protegidos. Build de publicação e conferência de saúde/revisão seguem a disciplina abaixo.

## Publicação e recuperação

O commit identifica esta entrega. A publicação preserva imagens anteriores de aplicação, migrador, PDFs e solver; valida o Compose protegido; utiliza o procedimento nativo com limpeza de cache compartilhado desativada. Depois da publicação, a revisão OCI de aplicação, PDFs e migrador deve coincidir com o commit; solver.py, hints.py e server.py são comparados por hash com as fontes desse commit. Saúde dos serviços, login, consulta autenticada e bloqueio anônimo são conferidos novamente, sem alterar propostas operacionais.

Nenhuma tabela ou revisão é removida para voltar uma imagem. Os campos JSON opcionais simulation, simulationDailyMinutes e needsRegeneration exigem decodificador compatível em qualquer recuperação de revisões novas; não devem ser descartados ou removidos de dados salvos para forçar compatibilidade com uma imagem antiga. Os arquivos privados originais, dados montados, credenciais e caches compartilhados permanecem preservados.

## Limitações objetivas

Cobertura automática é estimativa, não demanda conhecida. Pessoas sem relógio não cobrem horários fictícios. Referências curtas e semanas com afastamento não comprovam uma carga contratual ou regra de crédito. Jornadas noturnas não recebem cálculo inventado de hora reduzida. A aprovação interna continua sujeita à conferência aplicável. A cobertura global medida de linhas é 64,82%; nenhuma suíte demonstra todos os fluxos possíveis do projeto. Os arquivos CSV privados são condicionais no CI e precisam ser fornecidos em tempo de execução para repetir suas provas.
