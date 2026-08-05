export async function findInLatestTwoCompetencies<
  TCompetency extends { id: string },
  TItem,
>(
  competencies: readonly TCompetency[],
  load: (competencyId: string) => Promise<TItem[]>,
): Promise<{ competency: TCompetency | null; items: TItem[] }> {
  const candidates = competencies.slice(0, 2);
  for (const competency of candidates) {
    const items = await load(competency.id);
    if (items.length > 0) return { competency, items };
  }
  return { competency: candidates[0] ?? null, items: [] };
}

export async function findWithPreviousCompetencyFallback<
  TCompetency extends { id: string },
  TItem,
>(
  currentCompetency: TCompetency | null,
  loadItems: (competencyId: string) => Promise<TItem[]>,
  loadPreviousCompetency: (
    currentCompetency: TCompetency,
  ) => Promise<TCompetency | null>,
): Promise<{ competency: TCompetency | null; items: TItem[] }> {
  if (!currentCompetency) return { competency: null, items: [] };

  const currentItems = await loadItems(currentCompetency.id);
  if (currentItems.length > 0) {
    return { competency: currentCompetency, items: currentItems };
  }

  const previousCompetency = await loadPreviousCompetency(currentCompetency);
  if (!previousCompetency || previousCompetency.id === currentCompetency.id) {
    return { competency: currentCompetency, items: [] };
  }

  const previousItems = await loadItems(previousCompetency.id);
  return previousItems.length > 0
    ? { competency: previousCompetency, items: previousItems }
    : { competency: currentCompetency, items: [] };
}
