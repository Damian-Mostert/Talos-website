"use client";

import { useEffect } from "react";
import "./globals.css";
import bootBrain from "../core/index";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        await bootBrain();
      } catch (err) {
        if (!cancelled) console.error('bootBrain failed', err);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <html
      lang="en"
    >
      <body>{children}</body>
    </html>
  );
}
