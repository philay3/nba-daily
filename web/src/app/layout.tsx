import "@fontsource-variable/archivo/wdth";
import "@fontsource-variable/big-shoulders-display/wght";
import "./globals.css";

import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: { default: "NBA Daily", template: "%s | NBA Daily" },
  description: "Tonight's slate, last night's box scores, team ratings and post-ready graphics.",
};

export const viewport: Viewport = {
  themeColor: "#0b1624",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
