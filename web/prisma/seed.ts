import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaAdapter } from "../src/lib/prisma-adapter";
import { DEFAULT_JORNADA_RULES } from "../src/lib/jornada/default-rules";
import { ensureBootstrapAdmin } from "../src/lib/system/seed-admin";
import { DEFAULT_UNIMED_EXCLUSION_REASONS } from "../src/lib/unimed/defaults";

const prisma = new PrismaClient({ adapter: createPrismaAdapter() });
const LEGACY_JORNADA_RULE_NAMES = [
  "Jornada Parcial 04:00",
  "Jornada de 04:20",
  "Jornada de 05:00",
  "Jornada Reduzida 05:50",
  "Jornada de 06:00",
];

const UNIMED_BRANCH_DOCUMENT_METADATA = [
  {
    code: "MATRIZ",
    name: "Matriz",
    cnpj: "76361807000111",
    addressLine: "Av. Paraná",
    number: "5080",
    district: "Centro",
    postalCode: "87502000",
    city: "Umuarama",
    state: "PR",
    stateRegistration: "822.01018-01",
  },
  {
    code: "ICARAIMA",
    name: "Icaraíma",
    cnpj: "76361807000707",
    addressLine: "Av. Raul Barbosa Dias",
    number: "720",
    district: "Centro",
    postalCode: "87530000",
    city: "Icaraíma",
    state: "PR",
    stateRegistration: "823.00001-40",
  },
  {
    code: "HIPER",
    name: "Hiper",
    cnpj: "76361807000898",
    addressLine: "Av. Brasil",
    number: "3045",
    district: "Centro",
    postalCode: "87503420",
    city: "Umuarama",
    state: "PR",
    stateRegistration: "822.00418-09",
  },
  {
    code: "BIG",
    name: "Big Planalto",
    cnpj: "76361807000979",
    addressLine: "Av. Rolândia",
    number: "4000",
    district: "Centro",
    postalCode: "87502170",
    city: "Umuarama",
    state: "PR",
    stateRegistration: "822.06840-50",
  },
  {
    code: "TIRADENTES",
    name: "Tiradentes",
    cnpj: "76361807001002",
    addressLine: "Av. Tiradentes",
    number: "2950",
    district: "Centro",
    postalCode: "87505090",
    city: "Umuarama",
    state: "PR",
    stateRegistration: "822.06839-16",
  },
  {
    code: "ATACADO",
    name: "Atacado",
    cnpj: "76361807001274",
    addressLine: "Praça Papa Paulo VI",
    number: "3015",
    district: "Centro",
    postalCode: "87503690",
    city: "Umuarama",
    state: "PR",
    stateRegistration: "822.00477-69",
  },
  {
    code: "CASTELO",
    name: "Castelo Branco",
    cnpj: "76361807001436",
    addressLine: "Av. Presidente Castelo Branco",
    number: "3700",
    district: "Centro",
    postalCode: "87501170",
    city: "Umuarama",
    state: "PR",
    stateRegistration: "901.86830-13",
  },
  {
    code: "MULTI ATACADO",
    name: "Multi Atacado e Varejo",
    cnpj: "76361807001860",
    addressLine: "Rodovia PR-323, km 307",
    number: "S/N",
    district: "Parque Industrial I",
    postalCode: "87507013",
    city: "Umuarama",
    state: "PR",
    stateRegistration: "907.51391-25",
  },
  {
    code: "ANCHIETA",
    name: "Anchieta",
    cnpj: "76361807002084",
    addressLine: "Av. Apucarana",
    number: "5170",
    district: "Zona I",
    postalCode: "87501230",
    city: "Umuarama",
    state: "PR",
    stateRegistration: "907.95991-04",
  },
] as const;

const UNIMED_COMPANY_NAME = "J.MARTINS SUPERMERCADOS PLANALTO LTDA";
const UNIMED_COMPANY_PHONE = "44-3621-3100";

async function main() {
  const adminEmail = (
    process.env.ADMIN_EMAIL ??
    process.env.SEED_ADMIN_EMAIL ??
    "admin@local.test"
  )
    .trim()
    .toLowerCase();
  const adminPassword =
    process.env.ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  const tenant = await prisma.tenant.upsert({
    where: { slug: process.env.DEFAULT_TENANT_SLUG ?? "principal" },
    create: {
      name: process.env.DEFAULT_TENANT_NAME ?? "Principal",
      slug: process.env.DEFAULT_TENANT_SLUG ?? "principal",
    },
    update: {
      name: process.env.DEFAULT_TENANT_NAME ?? "Principal",
    },
  });

  const { user: admin } = await ensureBootstrapAdmin(prisma, {
    email: adminEmail,
    password: adminPassword,
    tenantId: tenant.id,
  });

  if (admin.role === "ADMIN" && admin.status === "ACTIVE") {
    await prisma.unimedUserAccess.upsert({
      where: { userId: admin.id },
      create: {
        userId: admin.id,
        tenantId: tenant.id,
        level: "ADMIN",
      },
      update: {
        tenantId: tenant.id,
        level: "ADMIN",
      },
    });
  }

  for (const branch of UNIMED_BRANCH_DOCUMENT_METADATA) {
    await prisma.unimedBranch.upsert({
      where: {
        tenantId_code: { tenantId: tenant.id, code: branch.code },
      },
      create: {
        tenantId: tenant.id,
        ...branch,
        companyName: UNIMED_COMPANY_NAME,
        phone: UNIMED_COMPANY_PHONE,
      },
      update: {
        ...branch,
        companyName: UNIMED_COMPANY_NAME,
        phone: UNIMED_COMPANY_PHONE,
      },
    });
  }

  for (const reason of DEFAULT_UNIMED_EXCLUSION_REASONS) {
    await prisma.unimedExclusionReason.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code: reason.code,
        },
      },
      create: {
        tenantId: tenant.id,
        code: reason.code,
        label: reason.label,
        documentKind: reason.documentKind,
      },
      update: {},
    });
  }

  for (const { id: _id, ...rule } of DEFAULT_JORNADA_RULES) {
    await prisma.jornadaRule.upsert({
      where: { nome: rule.nome },
      create: rule,
      update: { ...rule, active: true },
    });
  }

  await prisma.jornadaRule.deleteMany({
    where: { nome: { in: LEGACY_JORNADA_RULE_NAMES } },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
