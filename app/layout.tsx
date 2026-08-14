import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:4173";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;

  return {
    title: "DrainGuard AI — See a drain. Stop a flood.",
    description: "AI-powered storm-drain inspection and cleanup prioritization for flood-ready communities.",
    openGraph: {
      title: "DrainGuard AI",
      description: "See a drain. Stop a flood.",
      type: "website",
      images: [{ url: image, width: 1536, height: 1024, alt: "DrainGuard AI storm-drain risk map" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "DrainGuard AI",
      description: "See a drain. Stop a flood.",
      images: [image],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
