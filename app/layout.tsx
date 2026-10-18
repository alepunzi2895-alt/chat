import type { Metadata } from "next";
import "./globals.css";
import "./dark.css";

export const metadata: Metadata = {
  title: "Duetto — una chat tutta vostra",
  description: "Una chat semplice, privata e senza registrazione.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="it"><body>{children}</body></html>;
}
