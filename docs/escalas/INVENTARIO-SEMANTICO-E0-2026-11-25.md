# E0 — inventário semântico rastreável do Solver (primeiro fechamento de escopo)

Base imutável: f78c691edbeaf16283f534bcacd8db1b4b7d5e66. Planejamento: PR #70 (1dad0bf). Estado: **inventário expandido, não gate G0 aprovado**. As regras abaixo registram obrigação, fonte e testes existentes; a confirmação jurídica, revisão de todos os caminhos e oráculos diferenciais de cada sub-regra continuam pendentes. Não houve execução de testes nesta auditoria. Não confundir a ordem nominal de fases com contrato universal de score.

Convenções: PY = web/ops/escalas/; TS = web/src/lib/escalas/; testes PY listados foram localizados por nome na fonte fixada; os arquivos TS são referências de validação. H = obrigatório, G = guarda condicional, O = objetivo, P = preparação/contrato, S = segurança. Cada linha exige em E3 caso positivo, negativo e de fronteira; os testes citados são pontos de partida, não declaração de cobertura integral.

| ID | Classe | Sub-regra verificável / fonte | Evidência existente a reutilizar |
| --- | --- | --- | --- |
| I01 | P | Schema v1, IDs/datas/limites, referências resolvidas e rejeição de campos inválidos; PY model_input.py, TS schema.ts | test_payload.py; test_generation_contracts.py::test_invalid_rest_version_is_rejected_at_service_boundary |
| I02 | P | Semanas completas conforme MONDAY/SUNDAY, dezembro 31 dias somente exceção exata; planning_calendar.py / planning-calendar.ts | test_december_cutover.py::test_only_exact_sunday_cutover_allows_partial_edges |
| I03 | H | Período ativo, admissão/desligamento; solver.py active, validation-employee.ts | test_manual_shift.py::test_invalid_shape_dates_references_and_employment_fail_before_cp |
| I04 | P | Excluir AFASTADOS da projeção, não ADMINISTRATIVO; eligibility.ts | eligibility.test.ts |
| I05 | P | Aprendiz e até 360 minutos positivos FPRE136 excluídos conforme regra, registros protegidos permanecem; eligibility.ts | test_model_rules.py::test_excluded_learner_has_no_allocations_but_keeps_protected_records; generation-six-hour-contract.test.ts |
| I06 | H | Registros desabilitados não suprem cobertura; solver.py retained_disabled_records | test_generation_contracts.py::test_preserved_disabled_work_does_not_supply_coverage |
| I07 | P | Quatro zeros sem relógio; par parcialmente zerado válido permanece TIMED; MISSING não ganha relógio; fpre136-schedule.ts | fpre136-classification.test.ts; test_manual_shift.py::test_untimed_and_missing_profiles_never_receive_manual_clocks |
| I08 | P | Horário importado adaptado e alternativas de referência, sem ampliar contrato indevidamente; generation.ts, preparation.ts | generation-references.test.ts; test_preserved_import.py::test_estimated_shortage_does_not_move_an_imported_clock |
| I09 | H | Horário fixo importado não é substituído para cobertura confirmada; solver.py | test_preserved_import.py::test_required_coverage_reports_conflict_instead_of_substituting_the_clock |
| I10 | H | Override manual por data restringe trabalho, não força WORK; solver.py, manual-override.ts | test_manual_shift.py::test_inadmissible_manual_target_allows_off_in_day_generation_but_not_substitution |
| I11 | H | Exceção de horário bloqueado só vale no próprio dia; solver.py | test_manual_shift.py::test_explicit_existing_lock_is_only_a_day_exception_outside_the_normal_base |
| I12 | H | Override inadmissível com WORK fixo rejeita, sem substituir; solver.py | test_manual_shift.py::test_inadmissible_manual_target_conflicts_with_preserved_or_locked_work |
| I13 | P | Só horários sem grade não gera presença ou folga; hours-reference.ts/service-generation.ts | hours-reference-contract.test.ts |
| I14 | H | HOURS_ONLY exige grade completa e sem duplicatas; preserva kind/locks/datas/metadata e excluídos | test_generation_contracts.py::test_hours_only_missing_or_duplicate_baseline_rejected_before_cp; test_hours_only_preserves_all_kinds_dates_metadata_and_disabled_records |
| I15 | H | HOURS_ONLY altera só turno WORK permitido desbloqueado; solver-client.ts/hours-reference.ts | test_generation_contracts.py::test_hours_only_changes_only_permitted_unlocked_work_shift |
| I16 | H | REST_ONLY conserva referência por duração; extras bloqueados não vazam | test_rest_only.py::test_current_mode_keeps_clock_alternatives_but_rest_only_does_not; test_locked_mixed_extra_is_not_an_alternative_for_other_days |
| I17 | H | WORK/DUTY/OFF/ABSENCE/HOLIDAY distintos; ausência não cria folga | test_model_rules.py::test_absent_week_remains_absent_without_fictitious_rest |
| I18 | H | Feriado fechado em dia útil tem quatro trabalhos + dois descansos na semana normal | test_holidays.py::test_christmas_is_a_separate_holiday_with_four_workdays_and_two_rests |
| I19 | H | Domingo fechado pode contar como descanso; ausência no feriado prevalece | test_holidays.py::test_closed_sunday_counts_as_one_of_the_two_regular_rests; test_real_absence_on_closed_holiday_is_preserved |
| I20 | H | Feriado aberto dia útil não permite OFF ordinário conforme política; domingo aberto distinto | test_holidays.py::test_open_weekday_holiday_still_forbids_an_ordinary_rest; test_open_sunday_holiday_can_be_a_regular_rest_even_under_cct |
| I21 | H | Fechamento não admite trabalho nem demanda positiva obrigatória fictícia | test_holidays.py::test_closed_holiday_cannot_satisfy_positive_mandatory_staffing |
| I22 | H | Sábado v2/v3 protegido; ausência/feriado preservados; conflitos fixos não desbloqueiam | test_generation_contracts.py::test_fixed_and_locked_saturday_conflict_before_cp; test_saturday_absence_and_existing_holiday_keep_their_kind |
| I23 | H | 5 dias máximo, inclusive fronteira entre semanas/meses | test_model_rules.py::test_legacy_six_day_cap_cannot_allow_six_across_weeks; test_known_previous_month_five_days_force_a_rest_on_first_day |
| I24 | H | Descanso interjornada/repouso semanal em minutos civis, história e futuro; solver.py _rest/_civil_rest | test_shift_continuity_contract.py; validation.test.ts |
| I25 | H | Overnight não ocupa ausência nem data fechada; pausas não contam como presença | test_model_rules.py::test_overnight_work_must_not_occupy_an_absence_civil_date; test_coverage_protection.py::test_partially_overlapping_interval_does_not_count_break |
| I26 | H | Duração diária/limite semanal, regimes 40/42/44 e transições; labor-rules.ts | test_model_rules.py::test_extended_reference_keeps_daily_cap_and_full_meal_in_simulation; test_december_cutover.py::test_mixed_long_days_follow_sunday_weeks_at_both_edges |
| I27 | H | Jornada mista 42: 3x8 + 2x9 conforme regra, sem ampliar semana parcial | test_mixed_42.py::test_partial_week_preserves_absence_and_never_allows_three_locked_long_days |
| I28 | H | Pausa mínima/máxima, exceção específica vigente, limite de blocos | test_model_rules.py::test_extended_meal_requires_a_specific_current_agreement_outside_simulation; test_mixed_42.py::test_invalid_break_or_blocks_cannot_override_the_daily_limit |
| I29 | P | Simulação não fabrica autorização, pendências de evidência não equivalem a publicação | test_model_rules.py::test_42_and_44h_simulation_does_not_fabricate_compensation_authorization; validation.ts |
| I30 | H | Limite de domingos por regra individual e histórico, sem inferência de gênero/cargo; sunday_limit/effectiveSundayLimit | test_sunday_production.py; validation.test.ts |
| I31 | H | Folgas fixas/variáveis/mistas, consecutivas e sequência máxima de OFF; rest_configuration.py | test_variable_rests.py::test_sunday_monday_tuesday_offs_are_not_allowed_in_variable_mode; test_explicit_fixed_mode_and_fully_locked_offs_are_preserved |
| I32 | H | Só OFF regular conta em padrão, ausência/feriado quebram sequência; histórico e futuro restringem dia mutável | test_variable_rests.py::test_only_off_counts_absence_and_closed_holiday_break_the_block; test_history_and_future_rests_constrain_only_a_current_mutable_day |
| I33 | H | Dezembro primeiro bloco dois OFF e 3 WORK se aplicável; feriado não consome OFF | test_december_cutover.py::test_timed_and_untimed_each_have_two_rests_before_sunday; test_closed_holiday_does_not_consume_one_of_the_first_rests |
| I34 | H | Demanda confirmada por setor/cargo/faixa; excedente de outro cargo não compensa | test_daily_coverage.py::test_hard_role_floor_remains_a_constraint_even_with_general_surplus |
| I35 | O | Demanda estimada suave e deduplicada; sobreposição usa maior piso, não soma duplicada | test_daily_coverage.py::test_duplicate_one_hour_estimate_penalizes_one_hour; test_partial_overlaps_use_highest_floor_only_in_overlap; test_confirmed_and_estimated_targets_stay_separate_and_immutable |
| I36 | G | Preservar dia servido e faixas privadas, não mover perda para dia anteriormente atendido | test_daily_coverage.py::test_same_total_does_not_authorize_moving_deficit_to_a_previously_staffed_day; test_coverage_protection.py::test_a_demand_feasible_roster_cannot_drop_a_staffed_day |
| I37 | H/G | Faixa protegida cargo/dia, mínimo explícito não reduzido; UNTIMED/ausência/pausa não conta | test_coverage_protection.py::test_another_role_can_meet_demand_but_not_replace_protected_sunday_presence; test_less_strict_private_floor_never_decreases_confirmed_floor; test_cannot_count_absence_or_untimed_duty_toward_floor |
| I38 | G | Escopos horizonte/mês/domingo/mês+domingo, limites de picos e fechamento; coverage_comparison.py/roster-quality.ts | test_coverage_protection.py::test_monthly_sunday_counts_exclude_the_outer_sunday; test_same_total_cannot_worsen_simultaneous_peak |
| I39 | G | Dezembro: referência admitida e dias advisory, não transferir presença para data excluída | test_december_advisory_presence.py::test_an_exact_protected_day_cannot_be_replaced_by_an_advisory_day; test_coverage_protection.py::test_december_protects_day_role_and_band_without_freezing_surplus |
| I40 | G | Limite de bandas e dias, proteção ausente/null não relaxa referência admitida; coverage-protection.ts / solver-client.ts | coverage-protection.test.ts; solver-client.test.ts |
| I41 | O/G | Picos de domingo, movimento e fechamento; domingo e serviço estimado versus confirmado; sunday_peak.py/leadership.py/solver.py | test_daily_coverage.py::test_production_protects_sector_totals_and_defers_saturday_fairness; test_sunday_peak.py |
| I42 | O/G | Rodízio comparável por função/relógio/oportunidades, DUTY sem horas; weekend_balance.py | test_weekend_balance.py; test_variable_rests.py::test_untimed_rotation_runs_before_cosmetic_goals_and_varies_weekday_rests |
| I43 | O/G | Folgas em pares/espaçamento, preferência consecutiva/fixa não penalizada; rest_quality.py | test_variable_rests.py::test_pairs_are_soft_costs_but_absence_and_holiday_are_not_off; test_explicit_consecutive_preferences_and_fixed_modes_are_not_penalized |
| I44 | G | Liderança de prioridade e janelas longas preservadas mesmo com melhora de cobertura; roster-quality.ts | roster-quality.test.ts; test_leadership.py |
| I45 | G | Melhora operacional pode preceder justiça de seed, empate preserva rodízio; compareRosterCoverage/selectVerifiedRoster | roster-quality.test.ts; test_daily_coverage.py::test_deferred_saturday_guard_allows_coverage_recovery_and_prevents_later_rollback |
| I46 | O | Estabilidade, pessoas/dias alterados, preferências e desempate; solver.py goals | test_polish_priorities.py; test_optimization_contracts.py |
| I47 | G | Primeira solução legal, referência inválida/incomparável não autoriza reutilização sem validação | solver-client.test.ts; roster-quality.test.ts |
| I48 | S | Completude, schema estrito, proteção de metadata, referência retida vs nova, status honesto | solver-client.test.ts; test_generation_contracts.py |
| I49 | S | Identidade, secret, requestId/token, 8 MiB, 429 ocupação, cancelamento antes/depois, processo terminado antes de liberar vaga | test_service.py; test_transport.py; solve-operations.test.ts |
| I50 | S | 12/18/20s normal, 23/27/32s presença dezembro; sem renovar prazo; runtime_settings.py/service_operations.py/solver-transport.ts | test_optimization_contracts.py; test_service.py |
| I51 | S | Tenant, revisão/CAS, política aprovada, prova e publicação/rollback ficam na aplicação | service.test.ts; proposal-proof.test.ts; candidate-reference.server.test.ts |
| I52 | P | Catálogo global, exportação referências sem presença, calendário e revisões preservados | shift-catalog/flow-contracts.test.ts; shift-catalog/selection-export.test.ts |

## Precedência e oráculos obrigatórios

1. Primeiro validar entrada, relógios elegíveis, presença civil, condições individuais, calendário e regras hard. Um cenário deliberadamente inviável não autoriza relaxamento; Timefold UNKNOWN não equivale a prova INFEASIBLE.
2. Comparar cobertura protegida com o mesmo escopo e referência, não apenas score ou total de déficit. Confirmar liderança e janelas longas. Contrato especial de dezembro não congela toda estimativa advisory.
3. Em empate operacional, aplicar a distribuição/rest/rodízio existente. Em melhora operacional, testar exceções legítimas conforme o seletor. Registrar pares adversariais em que cada objetivo disputa com outro.
4. Separar garantia de negócio de estratégia CP: masks em hints, clones, variáveis auxiliares, recortes, pesos e reservas não são regras de RH. Não copiar automaticamente.
5. Oráculos a adicionar/fechar: enumerar casos mínimos legais/inviáveis; matriz de precedência completa; casos de demanda sem match; equivalência de representação semanal se testada; seed/reparo do mesmo envelope, modos, proteção dezembro, fronteiras e concorrência. Revalidar todos os testes antes de marcar G0/G2 PASS.

## Entrega E1 neste PR

Comparador inicial em web/scripts/escalas/cross-engine: fixtures sintéticas, captura do envelope real de solveEscala via fetch isolado, execução fria de OR-Tools com worker/controle reais em Docker descartável e adaptador futuro de Timefold, avaliação do resultado bruto e do retorno final TypeScript. Testes em src/lib/escalas/cross-engine.test.ts; captura de referência de dezembro admitida sintética e workflow de smoke baseline. A integração HTTP real, recuperação especial de dezembro, seed compartilhada completa, medições aquecidas, cgroup/CPU-segundos e verificador final independente dos JSONL permanecem pendentes. Nenhuma execução real ou certificação foi feita pela revisão documental. Ver instruções E1.
