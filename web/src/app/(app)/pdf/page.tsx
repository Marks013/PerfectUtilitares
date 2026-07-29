import {
  Combine,
  Crop,
  FileClock,
  FileImage,
  FileOutput,
  FilePenLine,
  FileSpreadsheet,
  FileText,
  ImagePlus,
  Layers3,
  Minimize2,
  RotateCw,
  Scissors,
  Sheet,
  Split,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { requirePageModuleAccess } from "@/lib/modules/access";

const toolGroups = [
  {
    title: "Comprimir",
    tone: "compress",
    tools: [
      {
        label: "Comprimir PDF",
        description: "Reduza o tamanho com controle de qualidade.",
        href: "/pdf/comprimir",
        icon: Minimize2,
        available: true,
      },
    ],
  },
  {
    title: "Organizar",
    tone: "organize",
    tools: [
      {
        label: "Juntar PDF",
        description: "Combine documentos em uma ordem definida.",
        href: "/pdf/juntar",
        icon: Combine,
        available: true,
      },
      {
        label: "Dividir PDF",
        description: "Separe intervalos ou páginas individuais.",
        href: "/pdf/dividir",
        icon: Split,
        available: true,
      },
      {
        label: "Girar PDF",
        description: "Corrija a orientação das páginas.",
        href: "/pdf/girar",
        icon: RotateCw,
        available: true,
      },
      {
        label: "Excluir páginas",
        description: "Remova páginas com seleção visual.",
        href: "/pdf/excluir-paginas",
        icon: Trash2,
        available: true,
      },
      {
        label: "Extrair páginas",
        description: "Crie um novo arquivo com a seleção.",
        href: "/pdf/extrair-paginas",
        icon: Scissors,
        available: true,
      },
      {
        label: "Organizar PDF",
        description: "Arraste, selecione, gire e reorganize.",
        href: "/pdf/organizar",
        icon: Layers3,
        available: true,
      },
    ],
  },
  {
    title: "Visualizar e editar",
    tone: "edit",
    tools: [
      {
        label: "Editar PDF",
        description: "Adicione textos, destaques e formas.",
        href: "/pdf/editar",
        icon: FilePenLine,
        available: true,
      },
      {
        label: "Anotar PDF",
        description: "Destaque, desenhe e registre observações.",
        href: "/pdf/anotar",
        icon: FileText,
        available: true,
      },
      {
        label: "Recortar PDF",
        description: "Ajuste visualmente a área das páginas.",
        href: "/pdf/recortar",
        icon: Crop,
        available: true,
      },
    ],
  },
  {
    title: "Converter PDF",
    tone: "export",
    tools: [
      {
        label: "PDF para Word",
        description: "Transforme o conteúdo em documento editável.",
        href: "/pdf/para-word",
        icon: FileText,
        available: true,
      },
      {
        label: "PDF para Excel",
        description: "Extraia tabelas para uma planilha.",
        href: "/pdf/para-excel",
        icon: FileSpreadsheet,
        available: true,
      },
      {
        label: "PDF para JPG",
        description: "Exporte páginas como imagens.",
        href: "/pdf/para-jpg",
        icon: FileImage,
        available: true,
      },
    ],
  },
  {
    title: "Converter para PDF",
    tone: "import",
    tools: [
      {
        label: "Word para PDF",
        description: "Converta documentos preservando o layout.",
        href: "/pdf/word-para-pdf",
        icon: FileOutput,
        available: true,
      },
      {
        label: "Excel para PDF",
        description: "Converta planilhas em documentos PDF.",
        href: "/pdf/excel-para-pdf",
        icon: Sheet,
        available: true,
      },
      {
        label: "JPG para PDF",
        description: "Monte um PDF a partir de imagens.",
        href: "/pdf/jpg-para-pdf",
        icon: ImagePlus,
        available: true,
      },
    ],
  },
] as const;

export default async function PdfPage() {
  await requirePageModuleAccess("pdf");

  return (
    <div className="pdf-hub">
      <header className="pdf-hub__header">
        <div>
          <p className="pdf-eyebrow">Central de documentos</p>
          <h1>Ferramentas PDF</h1>
        </div>
        <div className="pdf-hub__summary">
          <p>
            Escolha uma ação e trabalhe em uma área visual, mantendo sempre o
            arquivo original preservado.
          </p>
          <Link href="/pdf/historico" className="pdf-history-link">
            <FileClock className="size-4" aria-hidden="true" />
            Ver histórico
          </Link>
        </div>
      </header>

      <section className="pdf-tool-groups" aria-label="Ferramentas PDF">
        {toolGroups.map((group) => (
          <section
            key={group.title}
            className="pdf-tool-group"
            data-tone={group.tone}
          >
            <h2>{group.title}</h2>
            <div className="pdf-tool-list">
              {group.tools.map((tool) => {
                const Icon = tool.icon;
                const content = (
                  <>
                    <span className="pdf-tool-item__icon">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{tool.label}</strong>
                      <small>{tool.description}</small>
                    </span>
                  </>
                );

                return (
                  <Link
                    key={tool.href}
                    href={tool.href}
                    className="pdf-tool-item"
                  >
                    {content}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </section>
    </div>
  );
}
