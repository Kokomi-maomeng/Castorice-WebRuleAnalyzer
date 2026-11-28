import { createTheme } from "@mui/material/styles";
import DialogMotion from "./DialogMotion";

const smallFieldHeight = 40;

export const makeTheme = (dark: boolean, reducedMotion = false) =>
  createTheme({
    transitions: {
      easing: {
        easeInOut: "cubic-bezier(0.2, 0, 0, 1)",
        easeOut: "cubic-bezier(0, 0, 0, 1)",
        easeIn: "cubic-bezier(0.3, 0, 1, 1)",
        sharp: "cubic-bezier(0.2, 0, 0, 1)",
      },
      duration: {
        shortest: reducedMotion ? 0 : 120,
        shorter: reducedMotion ? 0 : 160,
        short: reducedMotion ? 0 : 180,
        standard: reducedMotion ? 0 : 240,
        complex: reducedMotion ? 0 : 300,
        enteringScreen: reducedMotion ? 0 : 240,
        leavingScreen: reducedMotion ? 0 : 180,
      },
    },
    palette: {
      mode: dark ? "dark" : "light",
      primary: { main: dark ? "#c9b5ff" : "#6c4eab" },
      secondary: { main: dark ? "#8ed6c3" : "#287a69" },
      warning: { main: dark ? "#ffb86b" : "#974400" },
      background: {
        default: dark ? "#121116" : "#f7f6fa",
        paper: dark ? "#1e1c23" : "#ffffff",
      },
      divider: dark ? "#38343f" : "#eae6ef",
    },
    typography: {
      fontFamily: "var(--font-ui, system-ui, sans-serif)",
      h4: { fontWeight: 700 },
      h5: { fontWeight: 650 },
      h6: { fontWeight: 650 },
      button: { textTransform: "none", fontWeight: 600 },
      caption: { fontSize: "0.75rem", lineHeight: 1.5 },
      fontSize: 13,
    },
    shape: { borderRadius: 12 },
    components: {
      MuiTab: {
        styleOverrides: {
          root: { minHeight: 42, paddingBlock: 8, paddingInline: 14 },
        },
      },
      MuiTabs: { styleOverrides: { root: { minHeight: 42 } } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 10, paddingInline: 14 } },
      },
      MuiPaper: { defaultProps: { elevation: 0 } },
      MuiTextField: { defaultProps: { size: "small" } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            "&.MuiInputBase-sizeSmall": { minHeight: smallFieldHeight },
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            "&.MuiInputLabel-outlined.MuiInputLabel-sizeSmall:not(.MuiInputLabel-shrink)":
              {
                transform: `translate(14px, calc(${smallFieldHeight / 2}px - .5lh)) scale(1)`,
              },
          },
        },
      },
      MuiDialog: {
        defaultProps: { slots: { transition: DialogMotion } },
        styleOverrides: {
          container: {
            "&[data-dialog-motion='enter'] > .MuiDialog-paper": {
              animation: reducedMotion
                ? "none"
                : "dialog-paper-enter var(--motion-enter) var(--motion-ease)",
            },
            "&[data-dialog-motion='exit'] > .MuiDialog-paper": {
              animation: reducedMotion
                ? "none"
                : "dialog-paper-exit var(--motion-standard) var(--motion-exit-ease) both",
            },
          },
          paper: {
            borderRadius: 10,
            "@container application (max-width: 560px) or (max-height: 560px)":
              {
                margin: 8,
                maxHeight: "calc(100% - 16px)",
                "&.MuiDialog-paperFullWidth": { width: "calc(100% - 16px)" },
              },
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            minWidth: 0,
            overflowWrap: "anywhere",
            "@container application (max-width: 560px)": { paddingInline: 12 },
          },
        },
      },
      MuiDialogActions: {
        defaultProps: { disableSpacing: true },
        styleOverrides: {
          root: {
            gap: 6,
            flexWrap: "wrap",
            "@container application (max-width: 360px)": { padding: 6 },
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          message: { minWidth: 0, overflowWrap: "anywhere" },
          root: {
            "@container application (max-width: 480px)": {
              flexWrap: "wrap",
              "& .MuiAlert-message": { flex: "1 1 100px" },
              "& .MuiAlert-action": { paddingBlock: 2 },
            },
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            fontSize: "0.75rem",
            lineHeight: 1.5,
            borderRadius: 8,
            maxWidth: "min(340px, calc(var(--app-viewport-width) - 20px))",
            overflowWrap: "anywhere",
          },
        },
      },
      MuiMenu: {
        defaultProps: {
          transitionDuration: {
            enter: reducedMotion ? 0 : 165,
            exit: reducedMotion ? 0 : 135,
          },
        },
      },
      MuiPopover: {
        defaultProps: {
          transitionDuration: {
            enter: reducedMotion ? 0 : 165,
            exit: reducedMotion ? 0 : 135,
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          icon: {
            transition: reducedMotion
              ? "none"
              : "transform var(--motion-quick) var(--motion-ease)",
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: { whiteSpace: "normal", overflowWrap: "anywhere" },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: { fontWeight: 650 },
          root: { borderColor: dark ? "#38343f" : "#efebf4" },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontSize: "0.75rem", minHeight: 24, maxWidth: "100%" },
        },
      },
    },
  });
