import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./dark.css";

export const metadata: Metadata = {
  title: "Taccuino",
  description: "Uno spazio personale.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="it"><body>{children}</body></html>;
}
