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
        padding: "70px 84px",
        background: "#071c18",
        color: "#f5fff9",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 64,
          padding: "48px 56px",
          border: "2px solid #1d4d41",
          borderRadius: 42,
          background: "#0c2822",
        }}
      >
        <div
          style={{
            width: 276,
            height: 276,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 64,
            background: "#20c997",
            color: "#062820",
            fontSize: 184,
            fontWeight: 900,
            lineHeight: 1,
          }}
        >
          P
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              color: "#8ce7d2",
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 3,
            }}
          >
            FERRAMENTAS ONLINE
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 82, fontWeight: 900, lineHeight: 0.98 }}>
            <span>Perfect</span>
            <span style={{ color: "#20c997" }}>Utilitares</span>
          </div>
          <div style={{ color: "#c5ddd4", fontSize: 28, fontWeight: 600 }}>
            Jornada, fotos 3x4 e PDFs
          </div>
        </div>
      </div>
    </div>,
    size,
  );
}
