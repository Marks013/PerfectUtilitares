import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enforceRateLimit,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  path: z
    .string()
    .trim()
    .max(180)
    .regex(/^\/(dashboard|jornada\/validar|fotos|pdf(?:\/[^?#]*)?|privacidade|cookies|termos|contato)$/),
  metric: z.enum(["CLS", "FCP", "INP", "LCP", "TTFB"]),
  value: z.number().finite().min(0).max(10_000_000),
  rating: z.enum(["good", "needs-improvement", "poor"]),
  navigationType: z.string().trim().max(40).optional(),
});

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limited = enforceRateLimit(request, {
    keyPrefix: "seo-web-vitals",
    limit: 150,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;

  const lengthError = requireMaxContentLength(request, 4_096);
  if (lengthError) return lengthError;

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = bodySchema.safeParse(parsedBody.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_METRIC", message: "Métrica de desempenho inválida." } },
      { status: 400 },
    );
  }

  await prisma.seoWebVital.create({ data: parsed.data });

  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}

export function GET() {
  return methodNotAllowed(["POST"]);
}
