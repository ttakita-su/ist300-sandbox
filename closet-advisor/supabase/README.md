# Supabase migrations

The production database for Rotation: the data model in [ARCHITECTURE.md](../ARCHITECTURE.md)
section 4 as Postgres tables, with row-level security that mirrors
[`js/server/policy.js`](../js/server/policy.js). The prototype doesn't use these files; they
are the starting point for the production build in [docs/PLAN.md](../docs/PLAN.md).

| File | What it creates |
| --- | --- |
| `migrations/0001_init.sql` | Extensions, enums and domains, every table, triggers, access helpers in the `private` schema, the functions exposed over the Data API, row-level security, grants and indexes |
| `migrations/0002_storage.sql` | Storage buckets (`user-photos`, `catalog-assets`, `catalog-restricted`) and the policies on `storage.objects` |

## How these were checked

**The migrations parse, but they have not been run against a Supabase project or any
Postgres 15 or 17 server.** What was done, in a scratch directory outside the repo:

- **Parsed with the real PostgreSQL parser** (`libpg-query` 18.1.5, the PostgreSQL 18 grammar):
  all 522 statements in `0001_init.sql` and 12 in `0002_storage.sql`, plus all 38 function
  bodies (PL/pgSQL bodies with the PL/pgSQL parser, SQL bodies as SQL).
- **Executed in PGlite** 0.5.10 (PostgreSQL 18.6 compiled to WebAssembly) with pgvector,
  after a stand-in for what Supabase provides: the `anon`, `authenticated`, `service_role` and
  `supabase_auth_admin` roles, Supabase's default grants, `auth.users` with `auth.uid()` and
  `auth.jwt()`, and the `storage` schema with `storage.foldername()`. PGlite has no
  `pg_jsonschema`, so a small validator for the JSON Schema keywords the migration uses stood in
  for `jsonb_matches_schema`. Both migrations applied without errors.
- **46 behavioral tests passed** against that database, acting as each role through
  `set role` and JWT claims: two people never see or change each other's rows, ids can't be
  probed; clients can't claim identifier support or write evidence; "identifier supported"
  without identifier evidence fails at commit; manual items carry no catalog identity; sizes
  carry their system; unknown shipping, fees and tax can't carry an amount; stylists read only
  live, assigned requests, get the redacted copy (no purchase price, serial number, notes or
  photos unless shared) and every read is audited; revocation and ending an assignment cut
  access at once, including to photo files; admins manage the catalog but read no personal
  table; a demoted admin loses access before the token expires; clicks hold no user id;
  conversions keep their status history; the audit log is append-only; deleting an account
  removes every private row. Structural checks also passed: row-level security is on for every
  table, every foreign key has an index, `anon` holds no table grant, no security-definer
  function sits in the exposed schema, and every one pins `search_path`.
- **The JSON Schemas** in the check constraints compile in Ajv's strict mode under drafts
  2020-12 and 07, and Ajv and the stand-in agree on 18 sample documents. The HNSW index for
  catalog embeddings is used by the search query (checked with `EXPLAIN`).

**Not exercised:** the real `pg_jsonschema` extension, Supabase's actual grants and roles, the
Auth hook as called by Supabase Auth, the Storage API (uploads, signed URLs), and Postgres 15
or 17. Run the steps below on a local Supabase stack before relying on any of it. The tests
above should be ported to pgTAP files in `supabase/tests/` so `supabase test db` runs them in
CI; they were not added to the repo.

## Apply with the Supabase CLI

From the `closet-advisor/` folder:

```sh
# Local stack (needs Docker). Applies every migration to a fresh local database.
supabase init          # only if supabase/config.toml doesn't exist yet
supabase start
supabase db reset

# A hosted project
supabase login
supabase link --project-ref <project-ref>
supabase db push --dry-run   # review what will run
supabase db push
```

Then, once per project:

1. **Turn on the role claim.** In the dashboard, Authentication > Hooks > Customize Access Token
   (JWT) Claims, choose `public.custom_access_token_hook`. For the local stack, add to
   `supabase/config.toml`:

   ```toml
   [auth.hook.custom_access_token]
   enabled = true
   uri = "pg-functions://postgres/public/custom_access_token_hook"
   ```

2. **Keep `private` unexposed.** Under Settings > API, the exposed schemas should stay `public`
   and `graphql_public`. The security-definer helpers live in `private` and must never be
   reachable directly.
3. **Make the first admin** in the SQL editor:
   `update public.accounts set role = 'admin' where id = '<user uuid>';`
   New accounts are always role `user`. The claim updates at the next token refresh; demotion
   takes effect immediately, because `private.has_role` also checks the `accounts` row.
4. **Schedule image expiry** (optional, after enabling pg_cron):
   `select cron.schedule('expire-catalog-images', '*/15 * * * *', $$select private.expire_catalog_images()$$);`

## How access works

- **Owners** read and write their own rows (`user_id = (select auth.uid())`). Child tables repeat
  `user_id` and use composite foreign keys on `(id, user_id)`, so a row can only point at the
  same person's rows.
- **Identity that rests on evidence is written by the server.** Clients may add items they
  confirmed from catalog search or entered by hand (`resolution` `user_confirmed` or `manual`,
  `retrieval` `not_run`). Identity columns are outside the client update grant, and evidence,
  match jobs and candidates are written with the service role.
- **Stylists** have no policy on any personal table, because row-level security filters rows,
  not columns. They call `public.stylist_list_requests()`, `public.stylist_get_request(id)` and
  `public.stylist_submit_recs(...)`. Each is a thin wrapper over a security-definer function in
  `private` that checks a live, unrevoked request and an active assignment, builds an
  allowlisted copy of each item (`private.redact_owned_item`), and writes an audit entry. When
  the check fails the answer is `null`, the same as for an id that doesn't exist.
- **Admins** are identified by the `user_role` claim and their `accounts` row together. They
  manage catalog, offer and operations tables, see accounts as id, name and role only, see match
  jobs only through `public.admin_list_match_jobs()` (with a salted hash in place of the user
  id), and have no policy on inventories, photos, profiles, match jobs or stylist requests.
- **Clicks** carry a pseudonymous `analytics_id` and no user id. The mapping to accounts lives in
  `private.account_analytics`, readable only by the service role, so it disappears when the
  account is deleted.
- **Storage.** `user-photos/<user id>/...` is private: owners use their own folder, and a
  stylist can read the original or cleaned photo of a shared item only while the request
  includes photos and the grant is live. `catalog-assets` is public and, by a check on
  `catalog_images`, can only hold images that are owned or licensed, allowed in collections and
  not tied to a live offer. `catalog-restricted` is read only by the server.
- **Signed URLs** stay valid until they expire and can't be revoked, so the server signs photo
  URLs for a few minutes at a time. Files are deleted through the Storage API, never with SQL.

## Rules for later migrations

- Supabase grants new tables to `anon` and `authenticated` by default. For every new table:
  enable row-level security, `revoke all ... from anon, authenticated`, grant back only what
  its policies use, and add a policy test.
- Index every foreign key; the tests check that each has an index led by its first column.
- Put security-definer functions in `private`, with `set search_path = ''` and
  schema-qualified names; expose them through security-invoker wrappers.
- Write `(select auth.uid())`, not `auth.uid()`, in policies, so it runs once per statement.
- Never read authorization from `user_metadata`; the person can change it.
- A second embedding model needs its own partial HNSW indexes and match function. Models above
  2,000 dimensions need `halfvec` (up to 4,000).
- Expect Supabase's performance advisor to report "multiple permissive policies" on the catalog
  tables: each has a read policy for every signed-in account and an admin policy `for all`.
  It costs one cached admin check per query. Splitting the admin policy into insert, update and
  delete policies silences it if you prefer.

## Differences from the prototype's data model

The schema follows ARCHITECTURE.md section 4, with these production changes:

- User records use `uuid` ids; catalog ids stay stable slugs.
- Nested objects become typed columns: sizes as value and system pairs (checked by
  `public.is_valid_size`), purchase details, crop, offer costs as kind plus amount, delivery and
  warranty. Budgets are one column per category with one currency.
- Category facts (`attributes`) live in per-category tables (`sneaker_products`,
  `watch_variants`, ...) instead of a JSON object; a deferred trigger requires each product and
  version to have its row.
- Arrays of related records become tables: identity evidence and conflicts, owner changes, label
  photos, wishlist links, match candidates with their evidence, conflicts, version options and
  requests (`match_job_asks`), variant colors, GTINs (with a GS1 check digit), sources, stylist
  request items, snapshots and recommendation items.
- Offers say whether they are sized (`is_sized`); per-size price and stock live in `offer_sizes`.
- Catalog images gain `allow_retrieval_index`, storage location, dimensions, a hash and a
  `licensed` license value; retrieval embeddings get their own table.
- Conversions keep `last_source` and a status history table; feedback splits its context item
  into owned and wishlist columns; stylist answers carry a `client_key` for retries; audit
  entries carry `subject_user_id`; configuration keys are a fixed list, each with a schema.
- Sessions, password hashes and email live in Supabase Auth, not in these tables.

The demo GTINs in `js/data/catalog.js` don't carry valid GS1 check digits, so importing the demo
catalog into this schema would reject them, as it would any invalid GTIN.
