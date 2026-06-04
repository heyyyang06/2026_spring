import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Next.js 방식으로 viewport 설정
// maximumScale 은 의도적으로 생략 — 접근성 pinch-zoom 허용
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",   // iPhone 노치/Dynamic Island 대응
};

export const metadata: Metadata = {
  title: "여행 플래너",
  description: "여행 일정, 경비, 다이어리, 준비물을 한 곳에서 관리하세요",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "여행 플래너",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
