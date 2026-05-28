import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth";
import { NO_FLASH_INIT } from "@/lib/theme";
import Shell from "@/components/Shell";
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
    // `data-theme="dark"` is a safe SSR default; the inline script below
    // resets it to the user's stored choice / OS preference before paint.
    <html lang="en" data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_INIT }} />
      </head>
      <body className="h-screen overflow-hidden bg-bg text-text antialiased">
        <AuthProvider>
          <Shell>{children}</Shell>
        </AuthProvider>
      </body>
    </html>
  );
}
