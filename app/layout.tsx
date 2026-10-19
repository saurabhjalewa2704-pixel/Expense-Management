import type { Metadata, Viewport } from "next";
import { APP_NAME } from "@/lib/env";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "A private money journal in pounds, built for one hand.",
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  icons: { icon: [{ url: "/icon-192.png", sizes: "192x192" }, { url: "/icon-512.png", sizes: "512x512" }], apple: "/apple-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0C0D0C",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" style={{ colorScheme: "dark" }}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
