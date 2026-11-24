import type { Metadata } from "next";
import "./globals.css";
import "./design-system.css";
import "./typography.css";
export const metadata: Metadata = {
  title: "FitiFy — Your experience, precisely aligned",
  description:
    "Tailor your resume to the next opportunity. Preserve your design. Keep every claim truthful.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
