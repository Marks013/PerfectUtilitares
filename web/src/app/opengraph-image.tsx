import { ImageResponse } from "next/og";

export const alt = "PerfectUtilitares - ferramentas online";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#111916",
        color: "#f8faf9",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          width: 1020,
          display: "flex",
          flexDirection: "column",
          gap: 28,
          borderLeft: "12px solid #18b9aa",
          paddingLeft: 54,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#e95d4f",
              fontSize: 32,
              fontWeight: 900,
            }}
          >
            PU
          </div>
          <div style={{ fontSize: 58, fontWeight: 900 }}>PerfectUtilitares</div>
        </div>
        <div style={{ fontSize: 30, color: "#b9c9c3", lineHeight: 1.45 }}>
          Jornada, fotos 3x4 e manutenção de PDFs em um só lugar.
        </div>
        <div style={{ display: "flex", gap: 18, fontSize: 21, color: "#8ee7dd" }}>
          <span>Online</span>
          <span>•</span>
          <span>Prático</span>
          <span>•</span>
          <span>Responsivo</span>
        </div>
      </div>
    </div>,
    size,
  );
}
