import React, { useEffect, useState } from "react";
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
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";

const statusColor = {
  DRAFT: "default",
  READY: "info",
  SUBMITTED: "warning",
  PAID: "success",
  REJECTED: "error",
};

export default function ClaimsList() {
  const [claims, setClaims] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    loadClaims();
  }, []);

  async function loadClaims() {
    try {
      const data = await ClaimsApi.list();
      setClaims(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to load claims:", e);
      setClaims([]);
    }
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5">All Claims</Typography>
        <Box display="flex" gap={1}>
          <Button variant="outlined" onClick={loadClaims}>
            Refresh
          </Button>
          <Button
            variant="contained"
            onClick={() => navigate("/claims/new")}
          >
            New Claim
          </Button>
        </Box>
      </Box>

      <Paper>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Patient</TableCell>
              <TableCell>Payer</TableCell>
              <TableCell>Amount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {claims.map((c) => (
              <TableRow
                key={c.id}
                hover
                sx={{ cursor: "pointer" }}
                onClick={() => navigate(`/claims/${c.id}`)}
              >
                <TableCell>{c.patientName}</TableCell>
                <TableCell>{c.payerName}</TableCell>
                <TableCell>₹{c.amount}</TableCell>
                <TableCell>
                  <Chip
                    label={c.status}
                    color={statusColor[c.status]}
                  />
                </TableCell>
                <TableCell>
                  {new Date(c.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}
