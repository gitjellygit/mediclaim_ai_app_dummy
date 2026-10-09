export function publicDocument(document) {
  if (!document || typeof document !== "object") return document;

  const {
    path: _path,
    rawText: _rawText,
    fileHash: _fileHash,
    ...safe
  } = document;

  return safe;
}

export function publicClaimDocuments(claim) {
  if (!claim || !Array.isArray(claim.documents)) return claim;
  return {
    ...claim,
    documents: claim.documents.map(publicDocument)
  };
}
