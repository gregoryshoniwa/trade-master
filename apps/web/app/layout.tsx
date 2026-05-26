import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradeMaster",
  description: "AI-orchestrated multi-model trading platform on Deriv",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text antialiased">
        <AuthProvider>
          <Nav />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
