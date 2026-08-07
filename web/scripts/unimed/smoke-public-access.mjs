const baseUrl = process.env.UNIMED_SMOKE_BASE_URL ?? "http://127.0.0.1:3002";

async function readCredentials() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const [standard, admin] = Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r/g, "")
    .split("\n");
  if (!standard || !admin) {
    throw new Error("As duas senhas são obrigatórias via stdin.");
  }
  return { standard, admin };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function unlock(password, expectedRole) {
  const response = await fetch(`${baseUrl}/api/unimed/access/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: JSON.stringify({ password }),
    redirect: "manual",
  });
  const payload = await response.json();
  assert(
    response.status === 200,
    `Login ${expectedRole} retornou ${response.status}.`,
  );
  assert(
    payload.access?.role === expectedRole,
    `Perfil ${expectedRole} não identificado.`,
  );

  const setCookie = response.headers.get("set-cookie") ?? "";
  assert(/HttpOnly/i.test(setCookie), "Cookie sem HttpOnly.");
  assert(/Secure/i.test(setCookie), "Cookie sem Secure.");
  assert(/SameSite=Strict/i.test(setCookie), "Cookie sem SameSite=Strict.");
  assert(!setCookie.includes(password), "Cookie expôs senha.");
  const cookie = setCookie.split(";", 1)[0];
  assert(
    cookie.includes("perfectutilitares.unimed-access="),
    "Cookie Unimed ausente.",
  );
  return cookie;
}

async function request(path, cookie, expectedStatus, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(init.method && init.method !== "GET" ? { origin: baseUrl } : {}),
      ...init.headers,
    },
    redirect: "manual",
  });
  assert(
    response.status === expectedStatus,
    `${path} retornou ${response.status}; esperado ${expectedStatus}.`,
  );
  return response;
}

async function logout(cookie) {
  const response = await fetch(`${baseUrl}/api/unimed/access/session`, {
    method: "DELETE",
    headers: { cookie, origin: baseUrl },
  });
  assert(response.status === 200, `Logout retornou ${response.status}.`);
  await request("/api/unimed/access/session", cookie, 401);
}

try {
  const credentials = await readCredentials();
  const lockedPage = await fetch(`${baseUrl}/unimed`, { redirect: "manual" });
  const streamedRedirect =
    lockedPage.status === 200 &&
    (await lockedPage.text()).includes("/unimed/acesso");
  const httpRedirect =
    lockedPage.status === 307 &&
    lockedPage.headers.get("location")?.endsWith("/unimed/acesso");
  assert(
    streamedRedirect || httpRedirect,
    "Módulo sem sessão não exibiu o bloqueio.",
  );

  const standardCookie = await unlock(
    credentials.standard,
    "STANDARD",
  );
  await request("/api/unimed/access/session", standardCookie, 200);
  await request("/api/unimed/beneficiaries?q=00000000000", standardCookie, 200);
  await request("/api/unimed/configuration", standardCookie, 200);
  await request("/api/unimed/imports", standardCookie, 403, { method: "POST" });
  await logout(standardCookie);

  const adminCookie = await unlock(
    credentials.admin,
    "ADMIN",
  );
  await request("/api/unimed/access/session", adminCookie, 200);
  await request("/api/unimed/configuration", adminCookie, 200);
  await request("/api/unimed/imports", adminCookie, 415, { method: "POST" });
  await logout(adminCookie);

  console.log("Unimed public access smoke: STANDARD/ADMIN/cookie/logout OK.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
