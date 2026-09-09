import { FaceDetector, FilesetResolver } from "/mediapipe/tasks-vision/vision_bundle.mjs";

function postResult(source, origin, requestId, payload) {
  source.postMessage(
    { type: "photo-3x4:face-detection-result", requestId, ...payload },
    origin,
  );
}

function normalizeDetections(detections, width, height) {
  return (detections || []).map((detection) => ({
    boundingBox: {
      xCenter: (detection.boundingBox.originX + detection.boundingBox.width / 2) / width,
      yCenter: (detection.boundingBox.originY + detection.boundingBox.height / 2) / height,
      width: detection.boundingBox.width / width,
      height: detection.boundingBox.height / height,
    },
  }));
}

async function loadImageBitmap(file) {
  if ("createImageBitmap" in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () =>
        reject(new Error("Nao foi possivel ler a imagem para deteccao."));
      element.src = url;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      close() {},
      draw(context) {
        context.drawImage(image, 0, 0);
      },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function drawFileToCanvas(file) {
  const bitmap = await loadImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Nao foi possivel preparar a imagem para deteccao.");
  }
  if (typeof bitmap.draw === "function") bitmap.draw(context);
  else context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

async function detectFace(file) {
  const canvas = await drawFileToCanvas(file);
  const vision = await FilesetResolver.forVisionTasks("/mediapipe/tasks-vision/wasm");
  const detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: "/mediapipe/models/blaze_face_short_range.tflite", delegate: "CPU" },
    runningMode: "IMAGE",
    minDetectionConfidence: 0.55,
  });
  try {
    const results = detector.detect(canvas);
    return {
      detections: normalizeDetections(results.detections, canvas.width, canvas.height),
      imageWidth: canvas.width,
      imageHeight: canvas.height,
    };
  } finally {
    detector.close();
  }
}

window.addEventListener("message", async (event) => {
  if (event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || message.type !== "photo-3x4:detect-face" || !event.source)
    return;
  try {
    const result = await detectFace(message.file);
    postResult(event.source, event.origin, message.requestId, {
      ok: true,
      result,
    });
  } catch (error) {
    postResult(event.source, event.origin, message.requestId, {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Falha ao detectar rosto automaticamente.",
    });
  }
});
