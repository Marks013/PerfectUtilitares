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
        overflow: "hidden",
        background: "#f2fff9",
        color: "#062b23",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 475,
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          overflow: "hidden",
          background: "#19b987",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 740,
            height: 740,
            borderRadius: 370,
            border: "54px solid #8af0cf",
            right: -460,
            top: -310,
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 520,
            height: 520,
            borderRadius: 260,
            border: "38px solid #087c5a",
            left: -330,
            bottom: -310,
          }}
        />
        <div
          style={{
            zIndex: 1,
            width: 306,
            height: 306,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "18px solid #ffffff",
            borderRadius: 76,
            background: "#083f32",
            color: "#ffffff",
            fontSize: 214,
            fontWeight: 900,
            lineHeight: 1,
          }}
        >
          P
        </div>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 28,
          padding: "74px 68px",
          background: "#f2fff9",
        }}
      >
        <div
          style={{
            color: "#087c5a",
            fontSize: 24,
            fontWeight: 800,
            letterSpacing: 3,
          }}
        >
          FERRAMENTAS ONLINE
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 84, fontWeight: 900, lineHeight: 0.94 }}>
          <span>Perfect</span>
          <span style={{ color: "#07966d" }}>Utilitares</span>
        </div>
        <div style={{ width: 210, height: 12, borderRadius: 6, background: "#19b987" }} />
      </div>
    </div>,
    size,
  );
}
