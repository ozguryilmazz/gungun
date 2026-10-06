// Google'ın son trend listesindeki her aramanın filtre kararını gösterir: hangisi gündem konusu olur,
// hangisi neden elenir. Veritabanını DEĞİŞTİRMEZ.
// Kullanım: pnpm trends:filter
import { createDb } from "@gundemci/db";
import { sql } from "drizzle-orm";
import { loadConfig } from "../config.ts";
import { FILTER_REASON_LABELS, classifyTerm } from "../topics-pipeline/term-filter.ts";

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL, { max: 1 });
try {
  const rows = await db.execute<{ term: string; observed_at: Date | string }>(sql`
    select distinct ts.term, ts.observed_at from trend_signals ts
    join data_providers p on p.id = ts.provider_id and p.key = 'google_trends'
    where ts.observed_at = (
      select max(observed_at) from trend_signals t2 where t2.provider_id = ts.provider_id
    )
    order by ts.term
  `);
  if (rows.length === 0) {
    console.log("Trend verisi yok. Önce: pnpm fetch:once google_trends");
  } else {
    const groups = new Map<string, string[]>();
    for (const r of rows) {
      const v = classifyTerm(r.term);
      const label =
        v.verdict === "keep"
          ? "✔ Aday: açıklayan haber bulunursa listelenir"
          : `✖ ${FILTER_REASON_LABELS[v.reason!]}`;
      groups.set(label, [...(groups.get(label) ?? []), r.term]);
    }
    const when = new Date(rows[0]!.observed_at).toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
    });
    console.log(`Son trend listesi: ${when} · ${rows.length} arama\n`);
    for (const [label, terms] of [...groups.entries()].sort()) {
      console.log(`${label} (${terms.length})`);
      console.log(`  ${terms.join(", ")}\n`);
    }
  }
} finally {
  await close();
}
