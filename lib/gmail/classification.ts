import { inferAmc } from "@/lib/funds/fundMapping";

export type GmailDocumentType = "nsdl_cas" | "amc_disclosure" | "unknown";

export function classifyGmailDocument(input: { filename: string; subject?: string | null; sender?: string | null }): GmailDocumentType {
  const text = `${input.sender ?? ""} ${input.subject ?? ""} ${input.filename}`.toLowerCase();
  const isPdf = /\.pdf(?:$|\?)/i.test(input.filename);
  if (isPdf && (/(?:nsdl|cdsl|e-?cas)/i.test(text) || /consolidated\s+(?:account|investment)\s+statement/i.test(text))) {
    return "nsdl_cas";
  }
  if (/\.(?:xlsx?|xlsm|csv|tsv|pdf)$/i.test(input.filename)
      && (/(?:monthly\s+)?portfolio|disclosure|holdings?/i.test(text) || inferAmc(text, null))) {
    return "amc_disclosure";
  }
  return "unknown";
}

export function inferSnapshotMonth(input: { filename: string; subject?: string | null; receivedAt?: string | Date | null }): string {
  const text = `${input.subject ?? ""} ${input.filename}`;
  const names: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const named = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\D{0,8}(20\d{2})\b/i);
  if (named) return `${named[2]}-${names[named[1].slice(0, 3).toLowerCase()]}-01`;
  const numeric = text.match(/\b(20\d{2})[-_. ](0?[1-9]|1[0-2])\b/);
  if (numeric) return `${numeric[1]}-${numeric[2].padStart(2, "0")}-01`;
  const received = input.receivedAt ? new Date(input.receivedAt) : new Date();
  return new Date(Date.UTC(received.getUTCFullYear(), received.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
}
