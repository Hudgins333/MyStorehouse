/**
 * Storehouse — Root Layout
 *
 * Wraps the single-page dashboard. Theme + toast only; no wallet context
 * (Storehouse is server-rendered and reads its state from the database —
 * it does not require a browser web3 wallet).
 */

import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Storehouse — Autonomous Finance Agent on Arc",
  description:
    "An autonomous financial agent that intercepts inbound USDC, reasons about your obligations, and routes funds automatically — explaining every decision in plain English. Built on Arc.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
