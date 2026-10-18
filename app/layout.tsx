import type { Metadata } from "next";
import "./globals.css";
import "./dark.css";

export const metadata: Metadata = {
  title: "Taccuino",
  description: "Uno spazio personale.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="it"><body>{children}</body></html>;
}
