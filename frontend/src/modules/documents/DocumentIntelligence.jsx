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
  Alert
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

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export default function DocumentIntelligence() {
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

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
      console.error(err);
      setDocuments([]);
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
      const claim = await ClaimsApi.create({
        patientName: "Unknown Patient",
        payerName: "Insurance",
        amount: 1
      });

      await ClaimsApi.uploadDoc({
        claimId: claim.id,
        type: "OTHER",
        file
      });

      await loadDocuments();
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
      setSelectedFile(null);
    }
  }

  function handlePreview(doc) {
    setPreviewDoc(doc);
    setPreviewOpen(true);
  }

  function handleClosePreview() {
    setPreviewOpen(false);
    setPreviewDoc(null);
  }

  function handleSelectDoc(docId) {
    const newSelected = new Set(selectedDocs);
    if (newSelected.has(docId)) newSelected.delete(docId);
    else newSelected.add(docId);
    setSelectedDocs(newSelected);
  }

  function handleSelectAll() {
    if (selectedDocs.size === documents.length) {
      setSelectedDocs(new Set());
    } else {
      setSelectedDocs(new Set(documents.map(doc => doc.id)));
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
      alert("Please select documents to delete");
      return;
    }

    if (!confirm(`Delete ${selectedDocs.size} selected document(s)?`)) return;

    try {
      setBulkDeleteLoading(true);

      const ids = Array.from(selectedDocs);
      await ClaimsApi.bulkDeleteDocs(ids);

      await loadDocuments();
      setSelectedDocs(new Set());
    } catch (e) {
      console.error("Bulk delete failed:", e);
      alert("Failed to delete documents");
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
    const res = await fetch(`${API_BASE}/api/documents/${doc.id}/download`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = doc.fileName;
    a.click();
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
                          selectedDocs.size === filteredDocuments.length
                        }
                        indeterminate={
                          selectedDocs.size > 0 &&
                          selectedDocs.size < filteredDocuments.length
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

          {previewDoc?.mimeType?.includes("pdf") ? (
            <iframe
              src={`${API_BASE}/api/documents/${previewDoc?.id}/preview`}
              width="100%"
              height="500px"
            />
          ) : (
            <Typography>No preview</Typography>
          )}

          <Stack direction="row" spacing={2} mt={2}>
            <Button onClick={handleClosePreview}>Close</Button>
            <Button onClick={() => handleDownload(previewDoc)}>Download</Button>
          </Stack>
        </Paper>
      </Modal>
    </>
  );
}