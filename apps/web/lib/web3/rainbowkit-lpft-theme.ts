import { darkTheme } from "@rainbow-me/rainbowkit";

/** Tema RainbowKit allineato al design system LPFT (viola, nero, bordi sottili). */
export function lpftRainbowTheme() {
  const base = darkTheme({
    accentColor: "#7c3aed",
    accentColorForeground: "#ffffff",
    borderRadius: "large",
    fontStack: "system",
    overlayBlur: "small",
  });

  return {
    ...base,
    colors: {
      ...base.colors,
      connectButtonBackground: "rgba(255, 255, 255, 0.04)",
      connectButtonInnerBackground: "transparent",
      connectButtonText: "#e5e7eb",
      connectButtonTextError: "#e5e7eb",
      actionButtonSecondaryBackground: "rgba(255, 255, 255, 0.04)",
      actionButtonBorder: "rgba(255, 255, 255, 0.08)",
      actionButtonBorderMobile: "rgba(255, 255, 255, 0.12)",
      generalBorder: "rgba(255, 255, 255, 0.08)",
      generalBorderDim: "rgba(255, 255, 255, 0.05)",
      menuItemBackground: "rgba(124, 58, 237, 0.14)",
      modalBackdrop: "rgba(0, 0, 0, 0.78)",
      modalBackground: "#050507",
      modalBorder: "rgba(255, 255, 255, 0.12)",
      modalText: "#e5e7eb",
      modalTextSecondary: "rgba(229, 231, 235, 0.72)",
      modalTextDim: "rgba(229, 231, 235, 0.5)",
      profileAction: "rgba(255, 255, 255, 0.04)",
      profileActionHover: "rgba(124, 58, 237, 0.18)",
      profileForeground: "rgba(0, 0, 0, 0.4)",
      selectedOptionBorder: "rgba(124, 58, 237, 0.45)",
      closeButton: "rgba(229, 231, 235, 0.55)",
      closeButtonBackground: "rgba(255, 255, 255, 0.06)",
      connectionIndicator: "#32d74b",
      downloadBottomCardBackground:
        "linear-gradient(135deg, rgba(124, 58, 237, 0.12) 0%, rgba(0, 0, 0, 0.65) 100%)",
      downloadTopCardBackground:
        "linear-gradient(135deg, rgba(88, 28, 135, 0.18) 0%, rgba(0, 0, 0, 0.75) 100%)",
      error: "#ff453a",
    },
    shadows: {
      ...base.shadows,
      connectButton: "none",
      dialog: "0 12px 40px rgba(0, 0, 0, 0.55), 0 0 64px rgba(124, 58, 237, 0.06)",
      selectedWallet: "0 0 0 1px rgba(124, 58, 237, 0.35)",
      selectedOption: "0 0 0 1px rgba(124, 58, 237, 0.25)",
      walletLogo: "0 4px 16px rgba(0, 0, 0, 0.35)",
    },
  };
}
