import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { MotionProvider } from "@/components/pulse/motion";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Editorial face: page titles, media titles and timecodes only. */
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "PULSE · Rights-aware sports campaigns",
  description: "From business goal to rights-aware campaign in seconds: real club moments, a campaign draft, a rights decision per channel and market, and an audit receipt.",
};

export const viewport: Viewport = { themeColor: "#111514", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <MotionProvider>
          <TooltipProvider delay={150}>{children}</TooltipProvider>
        </MotionProvider>
        <Toaster theme="dark" position="bottom-center" duration={2600} />
      </body>
    </html>
  );
}
