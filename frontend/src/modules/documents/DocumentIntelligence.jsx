import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Box,
  Typography,
  Button,
  Stack,
  Card,
  CardContent,
  TextField,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  LinearProgress,
  InputAdornment,
  IconButton,
  Modal,
  Paper,
  Checkbox,
  Tooltip,
  Collapse,
  Alert,
  Snackbar
} from "@mui/material";
import {
  Search as SearchIcon,
  CloudUpload,
  ExpandMore,
  ExpandLess,
  AttachFile,
  Visibility,
  SelectAll,
  CheckBoxOutlineBlank,
  DeleteSweep
} from "@mui/icons-material";
import { ClaimsApi } from "../../api/claims.js";
import { getToken } from "../../api/client.js";
import { useToast } from "../../context/ToastContext.jsx";
import { useSearchParams } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export default function DocumentIntelligence() {
  const { showToast, showDialog, confirmDialog } = useToast();
  const [searchParams] = useSearchParams();
  const claimIdFilter = String(searchParams.get("claimId") || "").trim();
  const openCodingFromQuery = searchParams.get("reviewCoding") === "1";
  const codingAutoOpened = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [codingOpen, setCodingOpen] = useState(false);
  const [codingDoc, setCodingDoc] = useState(null);
  const [codingSuggestions, setCodingSuggestions] = useState([]);
  const [codingLoading, setCodingLoading] = useState(false);
  const [codingEdits, setCodingEdits] = useState({});
  const [codingReviewingId, setCodingReviewingId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "info" });

  // ✅ selection (already used correctly)
  const [selectedDocs, setSelectedDocs] = useState(new Set());

  const [expandedRows, setExpandedRows] = useState(new Set());
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  useEffect(() => {
    loadDocuments();
  }, []);

  async function loadDocuments() {
    try {
      setLoading(true);
      const claims = await ClaimsApi.list();

      const allDocs = claims.flatMap(c =>
        (c.documents || []).map(d => ({
          ...d,
          claimId: c.id,
          patientName: c.patientName || "Unknown Patient"
        }))
      );

      setDocuments(allDocs);
    } catch (err) {
      console.error("Failed to load documents:", err);
      setDocuments([]);
      showDialog(
        err?.message || "Documents could not be loaded. Please try again.",
        {
          title: "Unable to load documents",
          severity: "error"
        }
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    setSelectedFile(file);

    try {
      const result = await ClaimsApi.smartUploadDoc(file);

      if (result.status === 409) {
        showDialog(
          "This exact document has already been uploaded. No duplicate document was created.",
          {
            title: "Duplicate document",
            severity: "warning"
          }
        );
      } else {
        const { message, matchStatus } = result;
        setSnackbar({
          open: true,
          message: message || "Document processed successfully",
          severity: matchStatus === "REVIEW" ? "warning" : "success"
        });
      }

      await loadDocuments();
    } catch (err) {
      console.error("Document upload failed:", err);
      showDialog(
        err.message || "Document upload failed. Please try again.",
        {
          title: "Document upload failed",
          severity: "error"
        }
      );
    } finally {
      setUploading(false);
      setSelectedFile(null);
      // Reset file input
      e.target.value = "";
    }
  }

  function extractedCodingCount(doc) {
    const extracted = doc?.extracted || {};
    return [
      ...(Array.isArray(extracted.icd10Codes) ? extracted.icd10Codes : []),
      ...(Array.isArray(extracted.cptCodes) ? extracted.cptCodes : []),
      ...(Array.isArray(extracted.icd10PcsCodes) ? extracted.icd10PcsCodes : [])
    ].filter(Boolean).length;
  }

  async function openCodingReview(doc) {
    setCodingDoc(doc);
    setCodingOpen(true);
    setCodingLoading(true);
    setCodingEdits({});
    try {
      const result = await ClaimsApi.getDocumentCodingSuggestions(doc.id);
      setCodingSuggestions(result?.items || []);
    } catch (err) {
      showDialog(
        err?.message || "Coding suggestions could not be loaded.",
        {
          title: "Unable to load coding review",
          severity: "error"
        }
      );
      setCodingOpen(false);
      setCodingDoc(null);
    } finally {
      setCodingLoading(false);
    }
  }

  function closeCodingReview() {
    if (codingReviewingId) return;
    setCodingOpen(false);
    setCodingDoc(null);
    setCodingSuggestions([]);
    setCodingEdits({});
  }

  async function reviewCodingSuggestion(suggestion, action) {
    const code =
      action === "CHANGE"
        ? String(codingEdits[suggestion.id] || "").trim()
        : undefined;

    if (action === "CHANGE" && !code) {
      showDialog("Enter the replacement code before choosing Change.", {
        title: "Replacement code required",
        severity: "warning"
      });
      return;
    }

    try {
      setCodingReviewingId(suggestion.id);
      const updated = await ClaimsApi.reviewCodingSuggestion(suggestion.id, {
        action,
        code
      });
      setCodingSuggestions((current) =>
        current.map((item) =>
          item.id === suggestion.id ? { ...item, ...updated } : item
        )
      );
      setCodingEdits((current) => ({
        ...current,
        [suggestion.id]: updated.finalCode || current[suggestion.id] || ""
      }));
      showToast(
        action === "REJECT"
          ? "Coding suggestion rejected"
          : action === "CHANGE"
          ? "Coding suggestion changed and applied"
          : "Coding suggestion accepted and applied",
        "success"
      );
    } catch (err) {
      showDialog(err?.message || "Coding suggestion could not be reviewed.", {
        title: "Coding review failed",
        severity: "error"
      });
    } finally {
      setCodingReviewingId("");
    }
  }

  async function handlePreview(doc) {
    const token = getToken();
    if (!token) {
      showDialog(
        "Your session is missing or has expired. Please log in again to preview documents.",
        {
          title: "Sign-in required",
          severity: "warning"
        }
      );
      return;
    }

    setPreviewDoc(doc);
    setPreviewOpen(true);
    setPreviewLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/documents/${doc.id}/preview`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Preview failed: ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (error) {
      setPreviewOpen(false);
      setPreviewDoc(null);
      showDialog(
        error?.message || "The document preview could not be loaded.",
        {
          title: "Document preview failed",
          severity: "error"
        }
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleClosePreview() {
    setPreviewOpen(false);
    setPreviewDoc(null);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
  }

  function handleSelectDoc(docId) {
    const newSelected = new Set(selectedDocs);
    if (newSelected.has(docId)) newSelected.delete(docId);
    else newSelected.add(docId);
    setSelectedDocs(newSelected);
  }

  function handleSelectAll() {
    const filteredIds = filteredDocuments.map(doc => doc.id);
    const allFilteredSelected = filteredIds.every(id => selectedDocs.has(id));
    
    if (allFilteredSelected) {
      const newSelected = new Set(selectedDocs);
      filteredIds.forEach(id => newSelected.delete(id));
      setSelectedDocs(newSelected);
    } else {
      const newSelected = new Set(selectedDocs);
      filteredIds.forEach(id => newSelected.add(id));
      setSelectedDocs(newSelected);
    }
  }

  function handleToggleExpand(docId) {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(docId)) newExpanded.delete(docId);
    else newExpanded.add(docId);
    setExpandedRows(newExpanded);
  }

  // ✅ FIXED BULK DELETE
  async function handleBulkDelete() {
    if (selectedDocs.size === 0) {
      showDialog(
        "Select at least one document before using bulk delete.",
        {
          title: "No documents selected",
          severity: "warning"
        }
      );
      return;
    }

    const confirmed = await confirmDialog(
      `Delete ${selectedDocs.size} selected document${selectedDocs.size === 1 ? "" : "s"}? This action cannot be undone. Submitted-claim documents are protected and will not be deleted.`,
      {
        title: "Delete selected documents?",
        severity: "warning",
        confirmLabel: "Delete",
        cancelLabel: "Cancel"
      }
    );
    if (!confirmed) return;

    try {
      setBulkDeleteLoading(true);

      const ids = Array.from(selectedDocs);
      await ClaimsApi.bulkDeleteDocs(ids);

      await loadDocuments();
      setSelectedDocs(new Set());
    } catch (e) {
      console.error("Bulk document delete failed:", {
        status: e?.status,
        message: e?.message
      });
      showDialog(
        e?.message || "The selected documents could not be deleted.",
        {
          title: "Documents could not be deleted",
          severity: "error"
        }
      );
    } finally {
      setBulkDeleteLoading(false);
    }
  }

  const filteredDocuments = useMemo(() => {
    const scoped = claimIdFilter
      ? documents.filter((doc) => doc.claimId === claimIdFilter)
      : documents;

    if (!searchTerm) return scoped;
    return scoped.filter(doc =>
      doc.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.type.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [documents, searchTerm, claimIdFilter]);

  useEffect(() => {
    if (!openCodingFromQuery || codingAutoOpened.current || loading) return;
    const candidate = filteredDocuments.find((doc) => extractedCodingCount(doc) > 0);
    if (!candidate) return;

    codingAutoOpened.current = true;
    openCodingReview(candidate);
  }, [openCodingFromQuery, loading, filteredDocuments]);

  const paginatedFilteredDocs = filteredDocuments.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );

  async function handleDownload(doc) {
    try {
      const token = getToken();
      if (!token) {
        showDialog(
          "Your session is missing or has expired. Please log in again to download documents.",
          {
            title: "Sign-in required",
            severity: "warning"
          }
        );
        return;
      }

      const res = await fetch(`${API_BASE}/api/documents/${doc.id}/download`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      
      if (!res.ok) {
        throw new Error("Download failed");
      }
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = doc.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download error:", err);
      showDialog(
        err?.message || "The document could not be downloaded. Please try again.",
        {
          title: "Document download failed",
          severity: "error"
        }
      );
    }
  }

  return (
    <>
      <Box sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" mb={2}>
          <Box>
            <Typography variant="h4">🧠 Document Intelligence</Typography>
            {claimIdFilter && (
              <Typography variant="body2" color="text.secondary">
                Showing documents for the selected claim.
              </Typography>
            )}
          </Box>

          <Button component="label" variant="contained" startIcon={<CloudUpload />}>
            <input type="file" hidden onChange={handleFileUpload} />
            Upload
          </Button>
        </Stack>

        {uploading && <LinearProgress />}

        <Card sx={{ mb: 2 }}>
          <CardContent>
            <TextField
              fullWidth
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                )
              }}
            />
          </CardContent>
        </Card>

        {filteredDocuments.length > 0 ? (
          <>
            <Stack direction="row" justifyContent="space-between" mb={2}>
              <Typography variant="h6">
                Documents ({filteredDocuments.length})
              </Typography>

              {selectedDocs.size > 0 && (
                <Stack direction="row" spacing={1}>
                  <Typography>{selectedDocs.size} selected</Typography>
                  <IconButton color="error" onClick={handleBulkDelete}>
                    <DeleteSweep />
                  </IconButton>
                </Stack>
              )}
            </Stack>

            <TableContainer component={Paper}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={
                          filteredDocuments.length > 0 &&
                          filteredDocuments.every(doc => selectedDocs.has(doc.id))
                        }
                        indeterminate={
                          filteredDocuments.some(doc => selectedDocs.has(doc.id)) &&
                          !filteredDocuments.every(doc => selectedDocs.has(doc.id))
                        }
                        onChange={handleSelectAll}
                      />
                    </TableCell>
                    <TableCell>File Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Confidence</TableCell>
                    <TableCell>Patient</TableCell>
                    <TableCell>Coding</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {paginatedFilteredDocs.map(doc => (
                    <TableRow key={doc.id}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={selectedDocs.has(doc.id)}
                          onChange={() => handleSelectDoc(doc.id)}
                        />
                      </TableCell>

                      <TableCell>{doc.fileName}</TableCell>
                      <TableCell>{doc.type}</TableCell>

                      <TableCell>
                        {doc.confidence ? `${doc.confidence}%` : "-"}
                      </TableCell>

                      <TableCell>
                        {doc.patientName || "Unknown Patient"}
                      </TableCell>

                      <TableCell>
                        {extractedCodingCount(doc) > 0 ? (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => openCodingReview(doc)}
                            data-testid={`coding-review-${doc.id}`}
                          >
                            Review {extractedCodingCount(doc)}
                          </Button>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            No codes
                          </Typography>
                        )}
                      </TableCell>

                      <TableCell>
                        <IconButton onClick={() => handlePreview(doc)}>
                          <Visibility />
                        </IconButton>

                        <IconButton onClick={() => handleDownload(doc)}>
                          <AttachFile />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <TablePagination
              component="div"
              count={filteredDocuments.length}
              rowsPerPage={rowsPerPage}
              page={page}
              onPageChange={(e, newPage) => setPage(newPage)}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
            />
          </>
        ) : (
          <Alert severity="info">No documents found</Alert>
        )}
      </Box>

      <Modal open={previewOpen} onClose={handleClosePreview}>
        <Paper sx={{ p: 3, maxWidth: 800, mx: "auto", mt: 5 }}>
          <Typography variant="h6">{previewDoc?.fileName}</Typography>

          {previewLoading ? (
            <Box sx={{ py: 6 }}>
              <LinearProgress />
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                Loading secure preview...
              </Typography>
            </Box>
          ) : previewDoc?.mimeType?.includes("pdf") && previewUrl ? (
            <iframe
              src={previewUrl}
              width="100%"
              height="500px"
              title={previewDoc?.fileName || "Document preview"}
            />
          ) : previewUrl ? (
            <Box
              component="img"
              src={previewUrl}
              alt={previewDoc?.fileName || "Document preview"}
              sx={{ maxWidth: "100%", maxHeight: 500 }}
            />
          ) : (
            <Typography>No preview available</Typography>
          )}

          <Stack direction="row" spacing={2} mt={2}>
            <Button onClick={handleClosePreview}>Close</Button>
            <Button onClick={() => handleDownload(previewDoc)}>Download</Button>
          </Stack>
        </Paper>
      </Modal>

      <Modal open={codingOpen} onClose={closeCodingReview}>
        <Paper
          sx={{
            p: 3,
            width: "min(980px, calc(100vw - 32px))",
            maxHeight: "85vh",
            overflowY: "auto",
            mx: "auto",
            mt: 5
          }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            spacing={1}
            sx={{ mb: 2 }}
          >
            <Box>
              <Typography variant="h6" fontWeight={800}>
                Coding Review
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {codingDoc?.fileName || "Document"} · Review document-derived codes before they enter the claim.
              </Typography>
            </Box>
            <Button onClick={closeCodingReview} disabled={Boolean(codingReviewingId)}>
              Close
            </Button>
          </Stack>

          <Alert severity="info" sx={{ mb: 2 }}>
            Document extraction creates suggestions only. A code is added to the claim only after Accept or Change.
          </Alert>

          {codingLoading ? (
            <LinearProgress />
          ) : codingSuggestions.length === 0 ? (
            <Alert severity="info">
              No ICD-10, CPT, HCPCS, or ICD-10-PCS codes were explicitly found in this document.
            </Alert>
          ) : (
            <Stack spacing={2}>
              {codingSuggestions.map((suggestion) => {
                const pending = suggestion.status === "PENDING";
                return (
                  <Card
                    key={suggestion.id}
                    variant="outlined"
                    data-testid={`coding-suggestion-${suggestion.system}-${suggestion.suggestedCode}`}
                  >
                    <CardContent>
                      <Stack spacing={1.25}>
                        <Stack
                          direction={{ xs: "column", sm: "row" }}
                          justifyContent="space-between"
                          alignItems={{ xs: "flex-start", sm: "center" }}
                          spacing={1}
                        >
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Chip size="small" label={suggestion.system.replaceAll("_", "-")} />
                            <Typography variant="h6" fontWeight={800}>
                              {suggestion.suggestedCode}
                            </Typography>
                            {suggestion.confidence != null && (
                              <Chip
                                size="small"
                                variant="outlined"
                                label={`${suggestion.confidence}% confidence`}
                              />
                            )}
                          </Stack>
                          <Chip
                            size="small"
                            color={
                              suggestion.status === "REJECTED"
                                ? "error"
                                : ["ACCEPTED", "CHANGED"].includes(suggestion.status)
                                ? "success"
                                : "warning"
                            }
                            label={suggestion.status}
                          />
                        </Stack>

                        {suggestion.evidenceText && (
                          <Box sx={{ p: 1.25, backgroundColor: "grey.50", borderRadius: 1 }}>
                            <Typography variant="caption" color="text.secondary">
                              Document evidence
                            </Typography>
                            <Typography variant="body2">
                              {suggestion.evidenceText}
                            </Typography>
                          </Box>
                        )}

                        {pending ? (
                          <>
                            <TextField
                              size="small"
                              label="Replacement code (only if changing)"
                              value={codingEdits[suggestion.id] || ""}
                              onChange={(e) =>
                                setCodingEdits((current) => ({
                                  ...current,
                                  [suggestion.id]: e.target.value.toUpperCase()
                                }))
                              }
                              disabled={codingReviewingId === suggestion.id}
                            />
                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                              <Button
                                variant="contained"
                                onClick={() => reviewCodingSuggestion(suggestion, "ACCEPT")}
                                disabled={Boolean(codingReviewingId)}
                              >
                                Accept
                              </Button>
                              <Button
                                variant="outlined"
                                onClick={() => reviewCodingSuggestion(suggestion, "CHANGE")}
                                disabled={Boolean(codingReviewingId)}
                              >
                                Change
                              </Button>
                              <Button
                                variant="outlined"
                                color="error"
                                onClick={() => reviewCodingSuggestion(suggestion, "REJECT")}
                                disabled={Boolean(codingReviewingId)}
                              >
                                Reject
                              </Button>
                            </Stack>
                          </>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            {suggestion.finalCode
                              ? `Final code: ${suggestion.finalCode}`
                              : "Rejected — not added to the claim."}
                            {suggestion.reviewedBy?.email
                              ? ` · Reviewed by ${suggestion.reviewedBy.email}`
                              : ""}
                          </Typography>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })}
            </Stack>
          )}
        </Paper>
      </Modal>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}