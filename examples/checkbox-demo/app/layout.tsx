import type { Metadata } from "next";

import "./styles.css";

export const metadata: Metadata = {
  title: "FON Checkbox Demo",
  description: "A small hosted-app demo for FON mountable principles.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
