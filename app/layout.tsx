import type { Metadata } from "next";
import "./globals.css";
import { MarketProvider } from "@/context/MarketProvider";

export const metadata: Metadata = {
  title: "InvestoGenie — Multi-Asset Financial Terminal",
  description:
    "A cinematic multi-asset terminal for the US & Indian markets: stocks, bonds, mutual funds, currencies, and derivatives with derivative-aware analytics.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <MarketProvider>{children}</MarketProvider>
      </body>
    </html>
  );
}
