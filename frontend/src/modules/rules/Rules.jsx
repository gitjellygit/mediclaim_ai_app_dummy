import React from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stack,
  Button,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Switch,
  FormControl,
  Select,
  MenuItem,
  Chip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useNavigate } from "react-router-dom";
import { ClaimsApi } from "../../api/claims.js";


const severityColor = {
  INFO: "default",
  WARN: "warning",
  BLOCK: "error"
};

export default function Rules() {
  const [rules, setRules] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState(null); // { id, name }
  const [deleting, setDeleting] = React.useState(false);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    try {
      const data = await ClaimsApi.listRules();
      setRules(data);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function deleteRule(id) {
    try {
      setDeleting(true);
      await ClaimsApi.deleteRule(id);
      await load();
    } catch (e) {
      // optionally surface error later
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto", p: 3 }}>
      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <div>
              <Typography variant="h5">Rules</Typography>
              <Typography variant="body2" color="text.secondary">
                Configure validation rules that affect claim readiness score.
              </Typography>
            </div>

            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={load}
                disabled={loading}
              >
                Refresh
              </Button>
              <Button
                variant="contained"
                onClick={() => navigate("/rules/new")}
              >
                Add Rule
              </Button>
            </Stack>
          </Stack>

          {loading ? (
            <Stack alignItems="center" sx={{ py: 6 }}>
              <CircularProgress />
              <Typography sx={{ mt: 2 }} color="text.secondary">
                Loading rules…
              </Typography>
            </Stack>
          ) : (
            <>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Code</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Severity</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Enabled</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Action</TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {rules.map((r) => (
                    <TableRow key={r.id} hover>
                      <TableCell sx={{ fontFamily: "monospace" }}>
                        {r.code}
                      </TableCell>

                      <TableCell>{r.name}</TableCell>

                      <TableCell>
                        <Chip
                          label={r.severity}
                          color={severityColor[r.severity] || "default"}
                          size="small"
                        />
                      </TableCell>

                      <TableCell>
                        <Switch checked={!!r.enabled} disabled />
                      </TableCell>

                      <TableCell>
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            variant="contained"
                            onClick={() => navigate(`/rules/${r.id}/edit`)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() => setDeleteTarget({ id: r.id, name: r.code })}
                          >
                            Delete
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}

                  {rules.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ textAlign: "center", color: "text.secondary", py: 4 }}>
                        No rules found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <Dialog
                open={!!deleteTarget}
                onClose={() => (deleting ? null : setDeleteTarget(null))}
              >
                <DialogTitle>Delete rule?</DialogTitle>
                <DialogContent>
                  <DialogContentText>
                    {`Are you sure you want to delete rule "${deleteTarget?.name}"? This cannot be undone.`}
                  </DialogContentText>
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
                    Cancel
                  </Button>
                  <Button
                    color="error"
                    variant="contained"
                    onClick={() => deleteRule(deleteTarget.id)}
                    disabled={deleting}
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </Button>
                </DialogActions>
              </Dialog>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
