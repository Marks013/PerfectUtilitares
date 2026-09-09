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
