import { createContext, useContext, useState } from "react";
import { Snackbar, Alert } from "@mui/material";

const ToastContext = createContext();

export function ToastProvider({ children }) {
  const [toast, setToast] = useState({
    open: false,
    message: "",
    severity: "success",
  });

  const show = (message, severity = "success") => {
    setToast({ open: true, message, severity });
  };

  const success = (message) => show(message, "success");
  const error = (message) => show(message, "error");
  const warning = (message) => show(message, "warning");

  // showToast(message, severity) for compatibility
  const showToast = (message, severity = "success") => show(message, severity);

  return (
    <ToastContext.Provider value={{ showToast, success, error, warning }}>
      {children}
      <Snackbar
        open={toast.open}
        autoHideDuration={4000}
        onClose={() => setToast({ ...toast, open: false })}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Alert
          severity={toast.severity}
          onClose={() => setToast({ ...toast, open: false })}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
