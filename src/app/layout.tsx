import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local AI Reels Generator",
  description: "Generate vertical reel scripts, captions, voiceover, and MP4s with free local tools.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
