export const metadata = {
  title: "QuickLot",
  description: "Turn a car on your dealership's website into a Marketplace listing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif",
          background: "#ffffff",
          color: "#111827",
        }}
      >
        {children}
      </body>
    </html>
  );
}
