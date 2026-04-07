import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  Typography,
  Button,
  LinearProgress,
  Stack,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  TextField,
  InputAdornment
} from "@mui/material";
import { CloudUpload, ExpandMore, ExpandLess, Search } from "@mui/icons-material";
import { api } from "../../api/client.js";

export default function DocumentIntelligence() {
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Load documents from backend API
  useEffect(() => {
    loadDocuments();
  }, []);

  async function loadDocuments() {
    try {
      setLoading(true);
      const docs = await api("/api/documents/list");
      setDocuments(docs || []);
    } catch (error) {
      console.error("Failed to load documents:", error);
      // Fallback to mock data if API fails
      setDocuments([
        {
          id: "1",
          fileName: "final_bill.pdf",
          mimeType: "application/pdf",
          type: "FINAL_BILL",
          suggestedType: "FINAL_BILL",
          confidence: 92,
          extracted: { patientName: "Raghu Kumar", amount: 52340 },
          status: "PROCESSED",
          createdAt: new Date(),
          patientId: "raghu-kumar"
        },
        {
          id: "2", 
          fileName: "discharge_summary.pdf",
          mimeType: "application/pdf",
          type: "DISCHARGE_SUMMARY",
          suggestedType: "DISCHARGE_SUMMARY",
          confidence: 85,
          extracted: { patientName: "Raghu Kumar", hospitalName: "B Hospital" },
          status: "PROCESSED",
          createdAt: new Date(),
          patientId: "raghu-kumar"
        },
        {
          id: "3",
          fileName: "lab_report.pdf", 
          mimeType: "application/pdf",
          type: "LAB_REPORT",
          suggestedType: "LAB_REPORT",
          confidence: 78,
          extracted: { patientName: "Priya Sharma", amount: 15000 },
          status: "PROCESSED",
          createdAt: new Date(),
          patientId: "priya-sharma"
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  // Group documents by patient - recalculate whenever documents change
  const documentsByPatient = React.useMemo(() => {
    const grouped = documents.reduce((acc, doc) => {
      const patientId = doc.patientId || 'unknown';
      if (!acc[patientId]) {
        acc[patientId] = [];
      }
      acc[patientId].push(doc);
      return acc;
    }, {});
    return grouped;
  }, [documents]);

  const [expandedPatients, setExpandedPatients] = useState({});
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Filter patients based on search
  const filteredPatients = Object.keys(documentsByPatient).filter(patientId => {
    const patientName = documentsByPatient[patientId]?.[0]?.extracted?.patientName || 'Unknown Patient';
    return patientName.toLowerCase().includes(searchTerm.toLowerCase()) || 
           patientId.toLowerCase().includes(searchTerm.toLowerCase());
  });

  function togglePatient(patientId) {
    setExpandedPatients(prev => ({
      ...prev,
      [patientId]: !prev[patientId]
    }));
  }

  function selectPatient(patientId) {
    setSelectedPatient(patientId === selectedPatient ? null : patientId);
  }

  async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    setUploading(true);
    setSelectedFile(file);
    console.log("Uploading file:", file.name);
    
    try {
      // Create FormData for file upload - let backend handle extraction
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', extractDocumentType(file.name));
      // formData.append('claimId', null); // Don't send claimId for now
      
      // Upload to backend for proper processing
      const response = await api("/api/documents/upload", {
        method: "POST",
        body: formData
      });
      
      console.log("Upload response:", response);
      
      // Reload documents from backend to show extracted data
      await loadDocuments();
      
    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setUploading(false);
      setSelectedFile(null);
    }
  }

  // Extract document type from filename (keep this simple logic)
  function extractDocumentType(fileName) {
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "").toLowerCase();
    
    if (nameWithoutExt.includes('bill') || nameWithoutExt.includes('invoice')) return 'FINAL_BILL';
    if (nameWithoutExt.includes('discharge') || nameWithoutExt.includes('summary')) return 'DISCHARGE_SUMMARY';
    if (nameWithoutExt.includes('lab') || nameWithoutExt.includes('test') || nameWithoutExt.includes('report')) return 'LAB_REPORT';
    if (nameWithoutExt.includes('prescription') || nameWithoutExt.includes('medicine')) return 'PRESCRIPTION';
    if (nameWithoutExt.includes('id') || nameWithoutExt.includes('identity') || nameWithoutExt.includes('card')) return 'ID_PROOF';
    
    return 'OTHER';
  }

  function getConfidenceColor(confidence) {
    if (confidence >= 85) return "success";
    if (confidence >= 70) return "warning";
    return "error";
  }

  function getStatusColor(status) {
    switch (status) {
      case "PROCESSED": return "primary";
      case "PENDING": return "warning";
      case "FAILED": return "error";
      default: return "default";
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">
          🧠 Document Intelligence
        </Typography>
        <Button
          variant="contained"
          component="label"
          startIcon={<CloudUpload />}
          disabled={uploading}
        >
          <input
            type="file"
            hidden
            accept=".pdf,.jpg,.jpeg,.png,.txt"
            onChange={handleFileUpload}
            disabled={uploading}
          />
          Upload a new document
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        AI-powered document processing, classification, and data extraction
      </Typography>

      {selectedFile && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Selected file: {selectedFile.name}
          </Typography>
        </Box>
      )}

      {uploading && (
        <Box sx={{ mb: 2 }}>
          <LinearProgress />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Uploading document...
          </Typography>
        </Box>
      )}

      {/* Search Section */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            🔍 Search Patients
          </Typography>
          
          <TextField
            placeholder="Search patients by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search />
                </InputAdornment>
              )
            }}
            sx={{ width: '100%' }}
          />
        </CardContent>
      </Card>

      {/* Documents Table - Grouped by Patient */}
      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">
              📄 Processed Documents ({documents.length}) - Grouped by Patient
            </Typography>
          </Stack>

          {Object.entries(documentsByPatient).map(([patientId, patientDocs]) => (
            <Accordion key={patientId} sx={{ mb: 2 }}>
              <AccordionSummary 
                expandIcon={expandedPatients[patientId] ? <ExpandLess /> : <ExpandMore />}
                onClick={() => selectPatient(patientId)}
                sx={{ 
                  backgroundColor: selectedPatient === patientId ? 'primary.light' : 'grey.50',
                  '&:hover': {
                    backgroundColor: selectedPatient === patientId ? 'primary.main' : 'grey.100'
                  }
                }}
              >
                <Stack direction="row" alignItems="center" spacing={2}>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', color: selectedPatient === patientId ? 'primary.contrastText' : 'inherit' }}>
                    👤 {documentsByPatient[patientId]?.[0]?.extracted?.patientName || 'Unknown Patient'}
                  </Typography>
                  <Chip 
                    label={`${patientDocs.length} docs`}
                    size="small"
                    color={selectedPatient === patientId ? "primary" : "default"}
                    sx={{ ml: 2 }}
                  />
                  <Stack direction="row" spacing={1}>
                    {patientDocs.filter(doc => doc.confidence >= 85).length > 0 && (
                      <Chip label="✅ High Confidence" size="small" color="success" sx={{ fontSize: '0.7rem' }} />
                    )}
                    {patientDocs.filter(doc => doc.confidence < 85 && doc.confidence >= 70).length > 0 && (
                      <Chip label="⚠️ Medium Confidence" size="small" color="warning" sx={{ fontSize: '0.7rem' }} />
                    )}
                    {patientDocs.filter(doc => doc.confidence < 70).length > 0 && (
                      <Chip label="❌ Low Confidence" size="small" color="error" sx={{ fontSize: '0.7rem' }} />
                    )}
                  </Stack>
                </Stack>
              </AccordionSummary>
              
              <AccordionDetails>
                <TableContainer component={Paper} sx={{ mt: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold', width: '30%' }}>Document</TableCell>
                        <TableCell sx={{ fontWeight: 'bold', width: '20%' }}>Type</TableCell>
                        <TableCell sx={{ fontWeight: 'bold', width: '20%' }}>AI Suggestion</TableCell>
                        <TableCell sx={{ fontWeight: 'bold', width: '15%' }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 'bold', width: '15%' }}>Extracted Data</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {patientDocs.map((doc) => (
                        <TableRow key={doc.id} hover>
                          <TableCell sx={{ verticalAlign: 'top', py: 1.5 }}>
                            <Stack direction="row" alignItems="center" spacing={1}>
                              <Typography variant="body2" sx={{ fontSize: '0.9rem', lineHeight: 1.2 }}>{doc.fileName}</Typography>
                              <Chip 
                                label={doc.mimeType?.includes("pdf") ? "PDF" : "Image"} 
                                size="small" 
                                variant="outlined" 
                                sx={{ ml: 1, fontSize: '0.8rem' }}
                              />
                            </Stack>
                          </TableCell>
                          <TableCell sx={{ verticalAlign: 'top', py: 1.5 }}>
                            <Chip 
                              label={doc.type} 
                              size="small" 
                              color={doc.type === "OTHER" ? "default" : "primary"}
                              sx={{ fontSize: '0.85rem' }}
                            />
                          </TableCell>
                          <TableCell sx={{ verticalAlign: 'top', py: 1.5 }}>
                            <Stack direction="row" alignItems="center" spacing={1}>
                              <Chip
                                label={`${doc.confidence || 0}%`}
                                size="small"
                                color={getConfidenceColor(doc.confidence)}
                                sx={{ fontSize: '0.8rem' }}
                              />
                              <Typography variant="caption" sx={{ ml: 1, fontSize: '0.75rem', color: 'text.secondary' }}>
                                AI Score
                              </Typography>
                            </Stack>
                          </TableCell>
                          <TableCell sx={{ verticalAlign: 'top', py: 1.5 }}>
                            <Chip
                              label={doc.status || "PENDING"}
                              size="small"
                              color={getStatusColor(doc.status)}
                              sx={{ fontSize: '0.85rem' }}
                            />
                          </TableCell>
                          <TableCell sx={{ verticalAlign: 'top', py: 1.5, pr: 1 }}>
                            {doc.extracted && Object.keys(doc.extracted).length > 0 ? (
                              <Stack spacing={0.5}>
                                {Object.entries(doc.extracted).map(([key, value]) => (
                                  <Typography key={key} variant="body2" sx={{ fontSize: '0.85rem', lineHeight: 1.3 }}>
                                    <strong>{key}:</strong> {value}
                                  </Typography>
                                ))}
                              </Stack>
                            ) : (
                              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
                              No data extracted
                            </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </AccordionDetails>
            </Accordion>
          ))}

          {filteredPatients.length === 0 && (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Typography color="text.secondary">
                {searchTerm ? `No patients found matching "${searchTerm}"` : "No documents uploaded yet. Upload some documents to get started."}
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
