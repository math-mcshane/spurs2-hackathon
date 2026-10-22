import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://clear-ugc-rights.dktrn9ne.chatgpt.site'),
  title: 'CLEAR — UGC Rights, Ready',
  description: 'Creator consent, licensing, and compliance decisions for sports UGC.',
  openGraph: {
    title: 'CLEAR — Fan content. Rights ready.',
    description: 'Creator consent, licensing, and compliance decisions for sports UGC.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CLEAR — Fan content. Rights ready.',
    description: 'Creator consent, licensing, and compliance decisions for sports UGC.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
