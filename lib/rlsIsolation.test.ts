import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, rlsTx, tenantQuery, workerQuery } from "@/lib/db";

const schemaReady = await query<{ ready: boolean }>(
  `select exists(select 1 from pg_roles where rolname='investogenie_web')
       and exists(
         select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname='watchlists' and c.relrowsecurity
       ) as ready`,
).then((rows) => rows[0]?.ready === true, () => false);

const users = { a: crypto.randomUUID(), b: crypto.randomUUID() };
const lists = { a: crypto.randomUUID(), b: crypto.randomUUID() };
const suffix = crypto.randomUUID();

describe.skipIf(!schemaReady)("PostgreSQL tenant row-level security", () => {
  beforeAll(async () => {
    await rlsTx({ kind: "worker" }, async (client) => {
      await client.query(
        `insert into public.users(id,email,password_hash) values
         ($1,$3,'rls-test'),($2,$4,'rls-test')`,
        [users.a, users.b, `rls-a-${suffix}@example.test`, `rls-b-${suffix}@example.test`],
      );
      await client.query(
        `insert into public.watchlists(id,user_id,name) values
         ($1,$3,'A private list'),($2,$4,'B private list')`,
        [lists.a, lists.b, users.a, users.b],
      );
    });
  });

  afterAll(async () => {
    await workerQuery("delete from public.users where id=any($1::uuid[])", [[users.a, users.b]])
      .catch(() => undefined);
  });

  it("returns no tenant rows when identity context is absent", async () => {
    const rows = await rlsTx({ kind: "tenant", userId: crypto.randomUUID() }, async (client) =>
      (await client.query("select id from public.watchlists where id=any($1::uuid[])", [[lists.a, lists.b]])).rows,
    );
    expect(rows).toEqual([]);
  });

  it("shows only the current tenant even when SQL omits user_id", async () => {
    const rowsA = await tenantQuery<{ id: string }>(users.a,
      "select id from public.watchlists where id=any($1::uuid[]) order by id",
      [[lists.a, lists.b]],
    );
    const rowsB = await tenantQuery<{ id: string }>(users.b,
      "select id from public.watchlists where id=any($1::uuid[]) order by id",
      [[lists.a, lists.b]],
    );
    expect(rowsA.map((row) => row.id)).toEqual([lists.a]);
    expect(rowsB.map((row) => row.id)).toEqual([lists.b]);
  });

  it("rejects cross-tenant writes even when application SQL attempts one", async () => {
    await expect(tenantQuery(users.a,
      "insert into public.watchlists(user_id,name) values($1,'forged')",
      [users.b],
    )).rejects.toMatchObject({ code: "42501" });
  });

  it("allows an explicitly authenticated worker to traverse tenants", async () => {
    const rows = await workerQuery<{ id: string }>(
      "select id from public.watchlists where id=any($1::uuid[]) order by id",
      [[lists.a, lists.b]],
    );
    expect(rows.map((row) => row.id).sort()).toEqual([lists.a, lists.b].sort());
  });
});
