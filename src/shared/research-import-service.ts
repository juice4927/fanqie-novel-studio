export function assertLocalResearchImportRights(
  rightsConfirmed: boolean,
): void {
  if (!rightsConfirmed) {
    throw new Error("必须确认拥有材料的合法使用权");
  }
}
