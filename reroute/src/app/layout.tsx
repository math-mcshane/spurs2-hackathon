import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PULSE × REROUTE · Rights-checked campaigns",
  description:
    "From a business objective to real match moments, a campaign proposal and a rights verdict per channel and territory — with an alternative when restricted, human review and an audit receipt.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider delay={150}>{children}</TooltipProvider>
        <Toaster theme="dark" position="top-center" offset={64} duration={2800} richColors closeButton />
      </body>
    </html>
  );
}
