export function oversizedMultipartRequest(path: string, limitMiB: number) {
  const boundary = "upload-test";
  const encoder = new TextEncoder();
  const start = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.xlsx"\r\n\r\n`,
  );
  const end = encoder.encode(`\r\n--${boundary}--\r\n`);
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === 0) controller.enqueue(start);
      else if (sent <= limitMiB) controller.enqueue(chunk);
      else {
        controller.enqueue(end);
        controller.close();
      }
      sent += 1;
    },
  });
  return new Request(
    `http://localhost${path}`,
    {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        origin: "http://localhost",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" },
  );
}
