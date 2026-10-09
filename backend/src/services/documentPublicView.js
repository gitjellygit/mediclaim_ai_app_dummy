export function publicDocument(document) {
  if (!document || typeof document !== "object") return document;

  const safe = { ...document };
  delete safe.path;
  delete safe.rawText;
  delete safe.fileHash;
  return safe;
}

export function publicClaimDocuments(claim) {
  if (!claim || !Array.isArray(claim.documents)) return claim;
  return {
    ...claim,
    documents: claim.documents.map(publicDocument)
  };
}
