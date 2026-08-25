import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const pw = await bcrypt.hash("Password1", 10);
  const owner = await prisma.user.upsert({
    where: { email: "owner@clockit.local" },
    update: {},
    create: { email: "owner@clockit.local", name: "Owner", passwordHash: pw, role: "OWNER" },
  });
  const client = await prisma.client.upsert({
    where: { name: "ACME Corp" },
    update: {},
    create: { name: "ACME Corp" },
  });
  await prisma.project.upsert({
    where: { name: "Website Redesign" },
    update: {},
    create: { name: "Website Redesign", clientId: client.id },
  });
  console.log("Seeded:", owner.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
