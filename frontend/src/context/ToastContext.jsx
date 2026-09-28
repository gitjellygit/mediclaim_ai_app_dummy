import { createContext, useContext, useRef, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar
} from "@mui/material";

const ToastContext = createContext();

/**
 * Global feedback center.
 *
 * UX convention:
 * - success / lightweight informational feedback => toast
 * - blocking errors or warnings that users may need to read/screenshot => modal
 * - destructive actions => confirmation modal
 *
 * This keeps feedback consistent across the whole application and avoids
 * browser-native alert()/confirm() dialogs.
 */
export function ToastProvider({ children }) {
  const [toast, setToast] = useState({
    open: false,
    message: "",
    severity: "success"
  });

  const [dialog, setDialog] = useState({
    open: false,
    title: "",
    message: "",
    severity: "info",
    confirmLabel: "OK",
    cancelLabel: "",
    showCancel: false
  });

  const dialogResolverRef = useRef(null);

  const show = (message, severity = "success") => {
    setToast({ open: true, message, severity });
  };

  const success = (message) => show(message, "success");
  const warning = (message) => show(message, "warning");

  /**
   * Errors are persistent dialogs by default so users can read, acknowledge,
   * and screenshot the reason. Success/info feedback stays lightweight.
   */
  const error = (message) =>
    showDialog(message, {
      title: "Action could not be completed",
      severity: "error"
    });

  // showToast(message, severity) kept for compatibility with existing modules.
  // Existing error calls across the app automatically receive the modal UX.
  const showToast = (message, severity = "success") => {
    if (severity === "error") {
      showDialog(message, {
        title: "Action could not be completed",
        severity: "error"
      });
      return;
    }

    show(message, severity);
  };

  function showDialog(
    message,
    {
      title = "Message",
      severity = "info",
      confirmLabel = "OK"
    } = {}
  ) {
    // Resolve any older open dialog before replacing it.
    if (dialogResolverRef.current) {
      dialogResolverRef.current(false);
      dialogResolverRef.current = null;
    }

    setDialog({
      open: true,
      title,
      message,
      severity,
      confirmLabel,
      cancelLabel: "",
      showCancel: false
    });
  }

  function confirmDialog(
    message,
    {
      title = "Please confirm",
      severity = "warning",
      confirmLabel = "Continue",
      cancelLabel = "Cancel"
    } = {}
  ) {
    if (dialogResolverRef.current) {
      dialogResolverRef.current(false);
      dialogResolverRef.current = null;
    }

    setDialog({
      open: true,
      title,
      message,
      severity,
      confirmLabel,
      cancelLabel,
      showCancel: true
    });

    return new Promise((resolve) => {
      dialogResolverRef.current = resolve;
    });
  }

  function closeDialog(result = false) {
    setDialog((current) => ({ ...current, open: false }));

    if (dialogResolverRef.current) {
      dialogResolverRef.current(result);
      dialogResolverRef.current = null;
    }
  }

  return (
    <ToastContext.Provider
      value={{
        showToast,
        success,
        error,
        warning,
        showDialog,
        confirmDialog
      }}
    >
      {children}

      <Snackbar
        open={toast.open}
        autoHideDuration={4000}
        onClose={() => setToast((current) => ({ ...current, open: false }))}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Alert
          severity={toast.severity}
          onClose={() => setToast((current) => ({ ...current, open: false }))}
        >
          {toast.message}
        </Alert>
      </Snackbar>

      <Dialog
        open={dialog.open}
        onClose={() => closeDialog(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="global-feedback-dialog-title"
      >
        <DialogTitle id="global-feedback-dialog-title">
          {dialog.title}
        </DialogTitle>

        <DialogContent>
          <Alert severity={dialog.severity} sx={{ mb: 2 }}>
            {dialog.severity === "error"
              ? "The requested action could not be completed."
              : dialog.severity === "warning"
              ? "Please review the information below."
              : "Information"}
          </Alert>

          <DialogContentText
            component="div"
            sx={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word"
            }}
          >
            {dialog.message}
          </DialogContentText>
        </DialogContent>

        <DialogActions>
          {dialog.showCancel && (
            <Button onClick={() => closeDialog(false)}>
              {dialog.cancelLabel}
            </Button>
          )}

          <Button
            onClick={() => closeDialog(true)}
            color={dialog.severity === "error" ? "error" : "primary"}
            variant="contained"
            autoFocus
          >
            {dialog.confirmLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
