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
      default: "#F4F7FA",
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
    borderRadius: 9
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
      fontSize: "0.86rem",
      lineHeight: 1.45,
      fontWeight: 600
    },
    body1: {
      fontSize: "0.9rem",
      lineHeight: 1.55
    },
    body2: {
      fontSize: "0.82rem",
      lineHeight: 1.5
    },
    button: {
      fontSize: "0.81rem",
      fontWeight: 650,
      lineHeight: 1.2,
      letterSpacing: "0.015em",
      textTransform: "none"
    },
    caption: {
      fontSize: "0.75rem",
      lineHeight: 1.45
    }
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#F4F7FA",
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
          minHeight: 36,
          borderRadius: 8,
          padding: "7px 14px",
          boxShadow: "none"
        },
        sizeSmall: {
          minHeight: 32,
          padding: "5px 10px",
          fontSize: "0.76rem"
        },
        sizeLarge: {
          minHeight: 40,
          padding: "8px 16px",
          fontSize: "0.84rem"
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
          height: 28,
          borderRadius: 14,
          fontWeight: 600,
          fontSize: "0.76rem"
        },
        sizeSmall: {
          height: 24,
          fontSize: "0.72rem"
        }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid #E1E7ED",
          borderRadius: 10,
          boxShadow: "0 1px 2px rgba(16, 42, 62, 0.05)"
        }
      }
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 18,
          "&:last-child": {
            paddingBottom: 18
          }
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        rounded: {
          borderRadius: 10
        },
        elevation1: {
          boxShadow: "0 1px 3px rgba(16, 42, 62, 0.08)"
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
          fontSize: "0.88rem"
        }
      }
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          minHeight: 40,
          backgroundColor: "#FFFFFF"
        },
        input: {
          padding: "9px 12px"
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
          borderRadius: 8,
          fontSize: "0.82rem",
          alignItems: "center"
        }
      }
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: {
          fontSize: "1.15rem",
          fontWeight: 700
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          fontSize: "0.82rem",
          padding: "10px 12px",
          borderColor: "#E5EAF0"
        },
        head: {
          fontWeight: 700,
          color: "#425466",
          backgroundColor: "#F8FAFC"
        }
      }
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontSize: "0.74rem"
        }
      }
    }
  }
});

export default prismTheme;
