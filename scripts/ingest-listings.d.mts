export interface ListingRow { ticker: string; name: string; exchange: string; country: string; currency: string }
export declare function fetchListingSources(
  sources: Array<[name: string, fetcher: () => Promise<ListingRow[]>]>,
): Promise<{ rows: ListingRow[]; counts: Record<string, number>; failures: Array<{ source: string; error: string }> }>;
