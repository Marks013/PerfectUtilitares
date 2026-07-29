import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
  PdfHistoryList,
  type PdfHistoryItem,
} from "@/components/pdf/pdf-history-list";
import { pdfJobAccessWhere } from "@/lib/pdf/access";
import { requirePageModuleAccess } from "@/lib/modules/access";
import { prisma } from "@/lib/prisma";

export default async function PdfHistoryPage() {
  const session = await requirePageModuleAccess("pdf");
  const jobs = await prisma.pdfJob.findMany({
    where: pdfJobAccessWhere(session),
    include: { artifacts: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const items: PdfHistoryItem[] = jobs.map((job) => ({
    id: job.id,
    operation: job.operation,
    status: job.status,
    progress: job.progress,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt.toISOString(),
    artifacts: job.artifacts
      .filter((artifact) => artifact.kind !== "PREVIEW")
      .map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind === "INPUT" ? ("INPUT" as const) : ("OUTPUT" as const),
        originalName: artifact.originalName,
        sizeBytes: artifact.sizeBytes.toString(),
      })),
  }));

  return (
    <div className="pdf-workspace">
      <header className="pdf-workspace__header">
        <div>
          <Link href="/pdf" className="pdf-back-link">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Ferramentas PDF
          </Link>
          <p className="pdf-eyebrow">Arquivos recentes</p>
          <h1>Histórico PDF</h1>
        </div>
        <p>
          Baixe novamente arquivos disponíveis ou remova trabalhos que não
          precisa mais.
        </p>
      </header>
      <PdfHistoryList initialItems={items} />
    </div>
  );
}
