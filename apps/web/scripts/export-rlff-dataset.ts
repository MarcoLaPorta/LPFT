import { config } from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");

config({ path: path.join(webRoot, ".env.local") });
config({ path: path.join(webRoot, ".env") });

const prisma = new PrismaClient();

type CliOptions = {
  stdout: boolean;
  outFile: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    stdout: false,
    outFile: path.join(webRoot, "data", "rlff-export.jsonl"),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--stdout") {
      options.stdout = true;
      continue;
    }
    if (arg === "--out" && argv[i + 1]) {
      options.outFile = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = await prisma.executionLog.findMany({
    where: {
      strategyMetrics: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      userPrompt: true,
      aiReasoning: true,
      actionType: true,
      executionStatus: true,
      marketRoutingMode: true,
      modelId: true,
      promptVersion: true,
      strategyMetrics: true,
      payloadJson: true,
      pnlResult: true,
      userFeedback: true,
      feedbackAt: true,
    },
  });

  const lines = rows.map((row) =>
    JSON.stringify({
      executionLogId: row.id,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      userPrompt: row.userPrompt,
      aiReasoning: row.aiReasoning,
      actionType: row.actionType,
      executionStatus: row.executionStatus,
      marketRoutingMode: row.marketRoutingMode,
      modelId: row.modelId,
      promptVersion: row.promptVersion,
      strategyMetrics: row.strategyMetrics,
      payloadJson: row.payloadJson,
      pnlResult: row.pnlResult,
      userFeedback: row.userFeedback,
      feedbackAt: row.feedbackAt?.toISOString() ?? null,
    }),
  );
  const content = lines.join("\n");

  if (options.stdout) {
    process.stdout.write(content + (content ? "\n" : ""));
    return;
  }

  await fs.mkdir(path.dirname(options.outFile), { recursive: true });
  await fs.writeFile(options.outFile, content + (content ? "\n" : ""), "utf8");
  process.stderr.write(`Exported ${rows.length} rows to ${options.outFile}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
