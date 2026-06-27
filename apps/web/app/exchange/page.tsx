import { getAfxHealthPayload } from "../../lib/afxHealth";
import type { AfxHealthPayload } from "../../lib/afxHealthTypes";
import ExchangePageClient from "./ExchangePageClient";

export const dynamic = "force-dynamic";

function clonePayload(p: AfxHealthPayload): AfxHealthPayload {
  return JSON.parse(JSON.stringify(p)) as AfxHealthPayload;
}

export default async function ExchangePage() {
  try {
    const { ok, payload } = await getAfxHealthPayload();
    return <ExchangePageClient healthOk={ok} healthPayload={clonePayload(payload)} />;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return (
      <ExchangePageClient
        healthOk={false}
        healthPayload={{
          embedded: true,
          ok: false,
          service: "lpft-web",
          database: "error",
          error: message,
        }}
      />
    );
  }
}
