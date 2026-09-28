import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Typography,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Paper,
  Checkbox,
  TextField,
  InputAdornment,
  IconButton,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress,
  Alert,
  Divider
} from "@mui/material";
import {
  Search as SearchIcon,
  Refresh,
  Visibility,
  Delete,
  AutoAwesome,
  CloudUpload,
  CheckCircle,
  ErrorOutline
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";
import { useToast } from "../../context/ToastContext.jsx";

const statusColor = {
  DRAFT: "default",
  READY: "info",
  SUBMITTED: "warning",
  PAID: "success",
  REJECTED: "error"
};

export default function ClaimsList() {
  const [claims, setClaims] = useState([]);
  const [selected, setSelected] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [aiCreateOpen, setAiCreateOpen] = useState(false);
  const [aiFiles, setAiFiles] = useState([]);
  const [aiCreating, setAiCreating] = useState(false);
  const [aiResults, setAiResults] = useState([]);
  const [aiCreatedClaimId, setAiCreatedClaimId] = useState("");
  const navigate = useNavigate();
  const { showToast, showDialog, confirmDialog } = useToast();

  useEffect(() => {
    loadClaims();
  }, []);

  async function loadClaims() {
    try {
      const data = await ClaimsApi.list();
      setClaims(Array.isArray(data) ? data : []);
      setSelected([]);
    } catch (e) {
      console.error("Failed to load claims:", e);
      setClaims([]);
    }
  }

  const filteredClaims = useMemo(() => {
    const search = searchTerm.toLowerCase().trim();

    if (!search) return claims;

    return claims.filter((claim) => {
      return (
        claim.patientName?.toLowerCase().includes(search) ||
        claim.payerName?.toLowerCase().includes(search) ||
        claim.status?.toLowerCase().includes(search) ||
        String(claim.amount || "").includes(search)
      );
    });
  }, [claims, searchTerm]);

  const allSelected =
    filteredClaims.length > 0 &&
    filteredClaims.every(c => selected.includes(c.id));

  const someSelected =
    filteredClaims.some(c => selected.includes(c.id)) && !allSelected;

  function handleSelectAll() {
    if (allSelected) {
      setSelected(prev =>
        prev.filter(id => !filteredClaims.some(c => c.id === id))
      );
    } else {
      const newIds = filteredClaims.map(c => c.id);
      setSelected(prev => [...new Set([...prev, ...newIds])]);
    }
  }

  function handleSelectOne(id) {
    setSelected(prev =>
      prev.includes(id)
        ? prev.filter(i => i !== id)
        : [...prev, id]
    );
  }

  async function handleDeleteClaim(id) {
    const ok = await confirmDialog(
      "This will permanently delete the claim and its associated documents. This action cannot be undone.",
      {
        title: "Delete claim?",
        severity: "warning",
        confirmLabel: "Delete",
        cancelLabel: "Cancel"
      }
    );
    if (!ok) return;

    try {
      await ClaimsApi.delete(id);
      await loadClaims();
    } catch (error) {
      console.error("Delete claim failed:", error);
      showDialog(
        error?.message || "Unable to delete claim. Please try again.",
        {
          title: "Claim could not be deleted",
          severity: "error"
        }
      );
    }
  }

  // Bulk deletion is intentionally sequential so each protected claim can
  // return its own lifecycle error without hiding which records were affected.
  async function handleBulkDelete() {
    const ok = await confirmDialog(
      `Delete ${selected.length} selected claim${selected.length === 1 ? "" : "s"}? Protected submitted/paid claims will not be removed.`,
      {
        title: "Delete selected claims?",
        severity: "warning",
        confirmLabel: "Delete",
        cancelLabel: "Cancel"
      }
    );
    if (!ok) return;

    const results = [];

    for (const id of selected) {
      const claim = claims.find((item) => item.id === id);

      try {
        await ClaimsApi.delete(id);
        results.push({
          id,
          name: claim?.patientName || "Claim",
          deleted: true
        });
      } catch (error) {
        console.error("Bulk claim delete item failed:", {
          claimId: id,
          status: error?.status,
          message: error?.message
        });

        results.push({
          id,
          name: claim?.patientName || "Claim",
          deleted: false,
          message: error?.message || "Delete failed"
        });
      }
    }

    const deleted = results.filter((item) => item.deleted);
    const failed = results.filter((item) => !item.deleted);

    setSelected([]);
    await loadClaims();

    if (failed.length === 0) {
      showToast(
        `${deleted.length} claim${deleted.length === 1 ? "" : "s"} deleted successfully.`,
        "success"
      );
      return;
    }

    if (deleted.length === 0 && failed.length === 1) {
      showDialog(
        `${failed[0].name}: ${failed[0].message}`,
        {
          title: "Claim could not be deleted",
          severity: "error"
        }
      );
      return;
    }

    const protectedSummary = failed
      .slice(0, 3)
      .map((item) => `${item.name}: ${item.message}`)
      .join(" | ");

    showDialog(
      `${deleted.length} deleted, ${failed.length} not deleted. ${protectedSummary}${
        failed.length > 3 ? ` | +${failed.length - 3} more` : ""
      }`,
      {
        title:
          deleted.length > 0
            ? "Bulk delete completed with warnings"
            : "Claims could not be deleted",
        severity: deleted.length > 0 ? "warning" : "error"
      }
    );
  }


  function openAiCreate() {
    setAiFiles([]);
    setAiResults([]);
    setAiCreatedClaimId("");
    setAiCreateOpen(true);
  }

  function closeAiCreate() {
    if (aiCreating) return;
    setAiCreateOpen(false);
  }

  function handleAiFiles(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const supported = files.filter((file) =>
      ["application/pdf", "image/png", "image/jpeg", "image/jpg"].includes(file.type)
    );

    if (supported.length !== files.length) {
      showDialog(
        "Only PDF, PNG, JPG, and JPEG files are supported for AI claim creation.",
        {
          title: "Unsupported document type",
          severity: "warning"
        }
      );
    }

    setAiFiles(supported);
    setAiResults([]);
    setAiCreatedClaimId("");
    event.target.value = "";
  }

  /**
   * Documents are processed sequentially so the first upload can create the
   * claim and later uploads can safely match/merge into the same encounter.
   * Mutating uploads are not auto-retried because a lost response could cause
   * duplicate side effects; duplicate detection on the backend remains the
   * final safety net.
   */
  async function createClaimFromDocuments() {
    if (aiFiles.length === 0) {
      showDialog(
        "Select at least one clinical or billing document before starting AI claim creation.",
        {
          title: "No documents selected",
          severity: "warning"
        }
      );
      return;
    }

    setAiCreating(true);
    setAiResults([]);
    setAiCreatedClaimId("");

    const results = [];
    let claimId = "";

    for (const file of aiFiles) {
      try {
        const result = await ClaimsApi.smartUploadDoc(file);

        claimId = result?.claim?.id || claimId;

        results.push({
          fileName: file.name,
          ok: true,
          matchStatus: result?.matchStatus || "NEW",
          message: result?.message || "Document processed",
          confidence: result?.document?.confidence ?? null,
          type: result?.document?.suggestedType || result?.document?.type || "OTHER",
          claimId: result?.claim?.id || ""
        });
      } catch (error) {
        console.error("AI claim creation document failed:", {
          fileName: file.name,
          status: error?.status,
          message: error?.message
        });

        results.push({
          fileName: file.name,
          ok: false,
          message: error?.message || "Document could not be processed"
        });
      }
    }

    setAiResults(results);
    setAiCreatedClaimId(claimId);
    setAiCreating(false);
    await loadClaims();

    const failed = results.filter((item) => !item.ok);
    const succeeded = results.filter((item) => item.ok);

    if (failed.length === 0 && succeeded.length > 0) {
      showToast(
        succeeded.length === 1
          ? "AI claim creation completed."
          : `AI processed ${succeeded.length} documents successfully.`,
        "success"
      );
    } else if (failed.length > 0) {
      showDialog(
        `${succeeded.length} document(s) processed successfully and ${failed.length} failed. Review the per-document results before continuing.`,
        {
          title: "AI claim creation completed with warnings",
          severity: "warning"
        }
      );
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" fontWeight={700} mb={3}>
        AI Claims ({filteredClaims.length})
      </Typography>

      <Stack direction="row" spacing={2} alignItems="center" mb={3}>
        <TextField
          placeholder="Search claims..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          sx={{ width: 320 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            )
          }}
        />

        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={loadClaims}
        >
          Refresh
        </Button>

        <Button
          variant="outlined"
          onClick={() => navigate("/claims/new")}
        >
          New Claim
        </Button>

        <Button
          variant="contained"
          startIcon={<AutoAwesome />}
          onClick={openAiCreate}
        >
          Create Claim from Documents
        </Button>

        {/* ✅ BULK DELETE BUTTON */}
        {selected.length > 0 && (
          <Button
            variant="contained"
            color="error"
            onClick={handleBulkDelete}
          >
            Delete Selected ({selected.length})
          </Button>
        )}
      </Stack>

      <Paper>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={handleSelectAll}
                />
              </TableCell>

              <TableCell><strong>Patient Name</strong></TableCell>
              <TableCell><strong>Insurance Company</strong></TableCell>
              <TableCell><strong>Amount</strong></TableCell>
              <TableCell><strong>Status</strong></TableCell>
              <TableCell><strong>Created Date</strong></TableCell>
              <TableCell><strong>Actions</strong></TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {filteredClaims.map((claim) => (
              <TableRow key={claim.id}>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selected.includes(claim.id)}
                    onChange={() => handleSelectOne(claim.id)}
                  />
                </TableCell>

                <TableCell>
                  {claim.patientName || "Unknown Patient"}
                </TableCell>

                <TableCell>
                  {claim.payerName || "Insurance"}
                </TableCell>

                <TableCell>
                  {claim.amount == null ? "—" : `${claim.amount}`}
                </TableCell>

                <TableCell>
                  <Chip
                    label={claim.status || "DRAFT"}
                    color={statusColor[claim.status] || "default"}
                    size="small"
                  />
                </TableCell>

                <TableCell>
                  {claim.createdAt
                    ? new Date(claim.createdAt).toLocaleDateString()
                    : "-"}
                </TableCell>

                <TableCell>
                  <IconButton onClick={() => navigate(`/claims/${claim.id}`)}>
                    <Visibility />
                  </IconButton>

                  <IconButton
                    color="error"
                    onClick={() => handleDeleteClaim(claim.id)}
                  >
                    <Delete />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}

            {filteredClaims.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  No claims found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Dialog
        open={aiCreateOpen}
        onClose={closeAiCreate}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          Create Claim with AI
        </DialogTitle>

        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Upload one or more clinical or billing documents. AI will classify the documents,
            extract structured claim data, detect duplicates, check for an existing patient
            encounter, and create or consolidate the claim.
          </Typography>

          <Alert severity="info" sx={{ mb: 2 }}>
            Processing sequence: OCR / document classification → field extraction → duplicate detection →
            patient & encounter matching → claim creation or merge.
          </Alert>

          <Button
            component="label"
            variant="outlined"
            startIcon={<CloudUpload />}
            disabled={aiCreating}
          >
            Select Documents
            <input
              hidden
              multiple
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              onChange={handleAiFiles}
            />
          </Button>

          {aiFiles.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Selected documents ({aiFiles.length})
              </Typography>
              <Stack spacing={0.75}>
                {aiFiles.map((file) => (
                  <Typography key={`${file.name}-${file.size}`} variant="body2">
                    • {file.name}
                  </Typography>
                ))}
              </Stack>
            </Paper>
          )}

          {aiCreating && (
            <Box sx={{ mt: 3 }}>
              <LinearProgress />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                AI is processing documents and building the claim. Please keep this window open.
              </Typography>
            </Box>
          )}

          {aiResults.length > 0 && (
            <>
              <Divider sx={{ my: 3 }} />
              <Typography variant="h6" sx={{ mb: 1.5 }}>
                Processing Results
              </Typography>

              <Stack spacing={1}>
                {aiResults.map((result) => (
                  <Paper
                    key={result.fileName}
                    variant="outlined"
                    sx={{ p: 1.5 }}
                  >
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      justifyContent="space-between"
                      spacing={1}
                    >
                      <Box>
                        <Stack direction="row" spacing={1} alignItems="center">
                          {result.ok ? (
                            <CheckCircle fontSize="small" color="success" />
                          ) : (
                            <ErrorOutline fontSize="small" color="error" />
                          )}
                          <Typography variant="body2" fontWeight={600}>
                            {result.fileName}
                          </Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {result.message}
                        </Typography>
                      </Box>

                      {result.ok && (
                        <Stack direction="row" spacing={1} flexWrap="wrap">
                          <Chip
                            size="small"
                            label={result.type}
                            variant="outlined"
                          />
                          <Chip
                            size="small"
                            label={result.matchStatus}
                            color={
                              result.matchStatus === "MERGED"
                                ? "success"
                                : result.matchStatus === "REVIEW"
                                ? "warning"
                                : "info"
                            }
                          />
                          {result.confidence != null && (
                            <Chip
                              size="small"
                              label={`${result.confidence}% confidence`}
                              variant="outlined"
                            />
                          )}
                        </Stack>
                      )}
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={closeAiCreate} disabled={aiCreating}>
            Close
          </Button>

          {aiCreatedClaimId && !aiCreating && (
            <Button
              variant="outlined"
              startIcon={<Visibility />}
              onClick={() => navigate(`/claims/${aiCreatedClaimId}`)}
            >
              Open Claim
            </Button>
          )}

          <Button
            variant="contained"
            startIcon={<AutoAwesome />}
            onClick={createClaimFromDocuments}
            disabled={aiCreating || aiFiles.length === 0}
          >
            {aiCreating ? "Processing..." : "Create Claim with AI"}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}