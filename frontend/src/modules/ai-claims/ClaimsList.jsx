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
  Stack
} from "@mui/material";
import {
  Search as SearchIcon,
  Refresh,
  Visibility,
  Delete
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";

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
  const navigate = useNavigate();

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
    const ok = window.confirm("Delete this claim?");
    if (!ok) return;

    try {
      await ClaimsApi.delete(id);
      await loadClaims();
    } catch (error) {
      console.error(error);
      alert("Delete failed");
    }
  }

  // ✅ BULK DELETE
  async function handleBulkDelete() {
    const ok = window.confirm(`Delete ${selected.length} claims?`);
    if (!ok) return;

    try {
      for (const id of selected) {
        await ClaimsApi.delete(id);
      }

      setSelected([]);
      await loadClaims();
    } catch (err) {
      console.error(err);
      alert("Bulk delete failed");
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
          variant="contained"
          onClick={() => navigate("/claims/new")}
        >
          New Claim
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
                  ${claim.amount || 0}
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
    </Box>
  );
}