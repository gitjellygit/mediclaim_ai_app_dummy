import { createTheme } from "@mui/material/styles";

const prismTheme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#173B57",
      light: "#2B5878",
      dark: "#102A3E",
      contrastText: "#FFFFFF"
    },
    secondary: {
      main: "#2E7C86",
      light: "#4A959D",
      dark: "#215D64",
      contrastText: "#FFFFFF"
    },
    background: {
      default: "#EEF3F7",
      paper: "#FFFFFF"
    },
    text: {
      primary: "#1E2936",
      secondary: "#667384",
      disabled: "#98A2B1"
    },
    divider: "#DCE3EA",
    success: {
      main: "#2F7D5B"
    },
    warning: {
      main: "#B7791F"
    },
    error: {
      main: "#C0443E"
    },
    info: {
      main: "#3E718F"
    }
  },
  shape: {
    borderRadius: 7
  },
  typography: {
    fontFamily:
      '"Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h1: {
      fontSize: "1.75rem",
      lineHeight: 1.2,
      fontWeight: 700,
      letterSpacing: "-0.02em"
    },
    h2: {
      fontSize: "1.5rem",
      lineHeight: 1.25,
      fontWeight: 700,
      letterSpacing: "-0.015em"
    },
    h3: {
      fontSize: "1.375rem",
      lineHeight: 1.28,
      fontWeight: 700
    },
    h4: {
      fontSize: "1.25rem",
      lineHeight: 1.3,
      fontWeight: 700
    },
    h5: {
      fontSize: "1.125rem",
      lineHeight: 1.35,
      fontWeight: 700
    },
    h6: {
      fontSize: "1.05rem",
      lineHeight: 1.4,
      fontWeight: 700
    },
    subtitle1: {
      fontSize: "0.95rem",
      lineHeight: 1.45,
      fontWeight: 600
    },
    subtitle2: {
      fontSize: "0.80rem",
      lineHeight: 1.45,
      fontWeight: 600
    },
    body1: {
      fontSize: "0.86rem",
      lineHeight: 1.45
    },
    body2: {
      fontSize: "0.79rem",
      lineHeight: 1.42
    },
    button: {
      fontSize: "0.81rem",
      fontWeight: 650,
      lineHeight: 1.2,
      letterSpacing: "0.015em",
      textTransform: "none"
    },
    caption: {
      fontSize: "0.72rem",
      lineHeight: 1.4
    }
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#EEF3F7",
          color: "#1E2936",
          WebkitFontSmoothing: "antialiased"
        },
        "*": {
          boxSizing: "border-box"
        }
      }
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
        size: "medium"
      },
      styleOverrides: {
        root: {
          minHeight: 32,
          borderRadius: 6,
          padding: "5px 11px",
          boxShadow: "none"
        },
        sizeSmall: {
          minHeight: 28,
          padding: "4px 9px",
          fontSize: "0.73rem"
        },
        sizeLarge: {
          minHeight: 36,
          padding: "6px 13px",
          fontSize: "0.81rem"
        },
        containedPrimary: {
          "&:hover": {
            boxShadow: "none",
            backgroundColor: "#102F47"
          }
        }
      }
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 8
        },
        sizeSmall: {
          padding: 6
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: {
          height: 24,
          borderRadius: 12,
          fontWeight: 600,
          fontSize: "0.76rem"
        },
        sizeSmall: {
          height: 21,
          fontSize: "0.69rem"
        }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid #E1E7ED",
          borderRadius: 7,
          boxShadow: "0 1px 2px rgba(16, 42, 62, 0.04)"
        }
      }
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 12,
          "&:last-child": {
            paddingBottom: 12
          }
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        rounded: {
          borderRadius: 7
        },
        elevation1: {
          boxShadow: "0 1px 2px rgba(16, 42, 62, 0.06)"
        }
      }
    },
    MuiTextField: {
      defaultProps: {
        size: "small"
      }
    },
    MuiFormControl: {
      defaultProps: {
        size: "small"
      }
    },
    MuiInputBase: {
      styleOverrides: {
        root: {
          fontSize: "0.82rem"
        }
      }
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          minHeight: 34,
          backgroundColor: "#FFFFFF"
        },
        input: {
          padding: "7px 10px"
        }
      }
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: "0.86rem"
        }
      }
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontSize: "0.78rem",
          alignItems: "center"
        }
      }
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: {
          fontSize: "1.05rem",
          fontWeight: 700
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          fontSize: "0.78rem",
          padding: "7px 9px",
          borderColor: "#E5EAF0"
        },
        head: {
          fontWeight: 700,
          color: "#425466",
          backgroundColor: "#F8FAFC"
        }
      }
    },
    MuiTable: {
      defaultProps: {
        size: "small"
      }
    },
    MuiToolbar: {
      styleOverrides: {
        regular: {
          minHeight: 48
        }
      }
    },
    MuiDialogContent: {
      styleOverrides: {
        root: {
          padding: "12px 16px"
        }
      }
    },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: "8px 12px"
        }
      }
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontSize: "0.72rem"
        }
      }
    }
  }
});

export default prismTheme;
