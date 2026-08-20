export function selectCompressionSamplePages(pageCount: number) {
  if (!Number.isInteger(pageCount) || pageCount <= 0) return [];
  const targetCount =
    pageCount <= 5 ? pageCount : pageCount >= 200 ? 9 : pageCount >= 40 ? 7 : 5;
  if (targetCount === pageCount) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  return Array.from({ length: targetCount }, (_, index) =>
    1 + Math.round(((pageCount - 1) * index) / (targetCount - 1)),
  ).filter((page, index, pages) => pages.indexOf(page) === index);
}

export function summarizeSelectableTextPages(characterCounts: number[]) {
  const pagesWithText = characterCounts.filter((count) => count >= 4).length;
  const pageRatio = characterCounts.length
    ? pagesWithText / characterCounts.length
    : 0;
  return {
    hasSelectableText: pagesWithText > 0,
    representative: pageRatio >= 0.6,
  };
}
