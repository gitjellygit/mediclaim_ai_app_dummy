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
  LinearProgress,
  InputAdornment,
  IconButton,
  Modal,
  Paper
} from "@mui/material";
import {
  Search as SearchIcon,
  CloudUpload,
  ExpandMore,
  ExpandLess,
  AttachFile,
  Visibility
} from "@mui/icons-material";
import { ClaimsApi } from "../../api/claims.js";

export default function DocumentIntelligence() {
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

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

  const documentsByPatient = useMemo(() => {
    return documents.reduce((acc, doc) => {
      const name = doc.patientName || "Unknown Patient";
      if (!acc[name]) acc[name] = [];
      acc[name].push(doc);
      return acc;
    }, {});
  }, [documents]);

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

  async function handleDownload(doc) {
    const res = await fetch(`/api/documents/${doc.id}/download`);
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

        {Object.entries(documentsByPatient).map(([patient, docs]) => (
          <Accordion key={patient}>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography>👤 {patient}</Typography>
            </AccordionSummary>

            <AccordionDetails>
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>File</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>

                  <TableBody>
                    {docs.map(doc => (
                      <TableRow key={doc.id}>
                        <TableCell>{doc.fileName}</TableCell>
                        <TableCell>{doc.type}</TableCell>

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
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>

      {/* Modal */}
      <Modal open={previewOpen} onClose={handleClosePreview}>
        <Paper sx={{ p: 3, maxWidth: 800, mx: "auto", mt: 5 }}>
          <Typography variant="h6">
            {previewDoc?.fileName}
          </Typography>

          {previewDoc?.mimeType?.includes("pdf") ? (
            <iframe
              src={`/api/documents/${previewDoc?.id}/preview`}
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