import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://drainguard-ai-earth.vercel.app"),
  title: "DrainGuard AI — See a drain. Stop a flood.",
  description: "Explainable AI-assisted storm-drain inspection, cleanup prioritization, and before/after verification.",
  applicationName: "DrainGuard AI",
  keywords: ["climate tech", "storm drains", "computer vision", "smart cities", "flood resilience"],
  authors: [{ name: "Bhavya Keerthi", url: "https://github.com/bhavyakeerthi3" }],
  alternates: { canonical: "/" },
  openGraph: {
    title: "DrainGuard AI",
    description: "Turn one street photo into an explainable drain-cleanup priority.",
    type: "website",
    url: "/",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "DrainGuard AI storm-drain risk map" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "DrainGuard AI",
    description: "See a drain. Stop a flood.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
