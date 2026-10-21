import { createTheme } from '@mui/material/styles';
export const makeTheme = (dark: boolean) => createTheme({
 palette: { mode: dark ? 'dark' : 'light', primary: { main: dark ? '#c9b5ff' : '#6c4eab' }, secondary: { main: dark ? '#8ed6c3' : '#287a69' }, background: { default: dark ? '#121116' : '#f7f6fa', paper: dark ? '#1e1c23' : '#ffffff' }, divider: dark ? '#38343f' : '#eae6ef' },
 typography: { fontFamily: '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif', h4: { fontWeight: 700 }, h5: { fontWeight: 650 }, h6: { fontWeight: 650 }, button: { textTransform: 'none', fontWeight: 600 }, fontSize: 13 },
 shape: { borderRadius: 16 },
 components: { MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 24, paddingInline: 20 } } }, MuiPaper: { defaultProps: { elevation: 0 } }, MuiTextField: { defaultProps: { size: 'small' } }, MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 12 } } }, MuiDialog: { styleOverrides: { paper: { borderRadius: 24 } } }, MuiTableCell: { styleOverrides: { head: { fontWeight: 650 }, root: { borderColor: dark ? '#38343f' : '#efebf4' } } }, MuiChip: { styleOverrides: { root: { fontSize: 11, height: 25 } } } },
});
