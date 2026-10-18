import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "StudyForge — flashcards from your notes, tuned to your exam",
  description: "Turn your notes into exam-ready flashcards. StudyForge detects what you're studying and writes cards in that exam's language.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#4f46e5" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-slate-200/70 py-6 text-center text-xs text-slate-500">
          StudyForge MVP · Your notes stay on this machine (SQLite).
        </footer>
      </body>
    </html>
  );
}
