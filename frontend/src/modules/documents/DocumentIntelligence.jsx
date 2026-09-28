import React, { useState, useEffect, useMemo } from "react";
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

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export default function DocumentIntelligence() {
  const { showToast, showDialog, confirmDialog } = useToast();
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
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
    if (!searchTerm) return documents;
    return documents.filter(doc =>
      doc.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.type.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [documents, searchTerm]);

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
          <Typography variant="h4">🧠 Document Intelligence</Typography>

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