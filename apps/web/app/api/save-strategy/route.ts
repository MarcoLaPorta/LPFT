import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      code?: string;
      reasoning?: string;
      spec?: unknown;
      params?: { symbol?: string; period?: string; timeframe?: string } | null;
    };

    if (!body.code || !body.code.trim()) {
      return new NextResponse("Missing code", { status: 400 });
    }

    const now = new Date();
    const datePart = now.toISOString().slice(0, 10);
    const symbol = body.params?.symbol || "strategy";
    const kind =
      body.spec && typeof body.spec === "object" && body.spec !== null && "kind" in (body.spec as Record<string, unknown>)
        ? String((body.spec as Record<string, unknown>).kind || "generated")
        : "generated";

    const folderName = `${datePart}_${slugify(symbol)}_${slugify(kind)}`;
    const strategiesRoot = path.resolve(process.cwd(), "../../strategies");
    const folder = path.join(strategiesRoot, folderName);

    await mkdir(folder, { recursive: true });

    const meta = {
      saved_at: now.toISOString(),
      params: body.params ?? null,
      spec: body.spec ?? null,
    };

    const notes = [
      "# Strategy Notes",
      "",
      "## Reasoning",
      body.reasoning?.trim() || "—",
      "",
      "## Save Info",
      `Saved at: ${now.toISOString()}`,
    ].join("\n");

    await Promise.all([
      writeFile(path.join(folder, "strategy.py"), body.code, "utf8"),
      writeFile(path.join(folder, "spec.json"), JSON.stringify(body.spec ?? null, null, 2), "utf8"),
      writeFile(path.join(folder, "meta.json"), JSON.stringify(meta, null, 2), "utf8"),
      writeFile(path.join(folder, "notes.md"), notes, "utf8"),
    ]);

    return NextResponse.json({
      ok: true,
      folder: `strategies/${folderName}`,
    });
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : "Save failed", { status: 500 });
  }
}
