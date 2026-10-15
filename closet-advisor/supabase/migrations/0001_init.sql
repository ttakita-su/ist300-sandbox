-- Rotation: production schema, row-level security and access helpers.
--
-- Production counterpart of the prototype's data model (ARCHITECTURE.md section 4) and of
-- the access rules in js/server/policy.js. Targets Supabase Postgres 15 or later. Not run by
-- the prototype; see supabase/README.md for how it was checked and how to apply it.
--
-- Access model:
-- - Every table has row-level security on. Client roles start with no grants and get back
--   only what they need; service_role keeps Supabase's default grant and bypasses RLS, so it
--   is used only by server code.
-- - People read and write their own rows.
-- - Stylists get no table policy on anyone's inventory. RLS filters rows, not columns, so a
--   policy would expose purchase prices, serial numbers and notes. Stylists read through
--   security-definer functions in the private schema that check a live (not revoked)
--   request and an active assignment, and that build an allowlisted copy of each item.
-- - Admins (user_role claim, confirmed against accounts.role) manage the catalog, offers
--   and operations. No policy lets an admin read inventories, photos, profiles, match jobs
--   or stylist requests.
-- - Identity that rests on evidence (match results, identifier support) is written by the
--   server with the service role after it has checked that evidence. Clients can only
--   create items they confirmed themselves or entered manually.

-- ============================================================================
-- 0. Extensions and schemas
-- ============================================================================

create extension if not exists vector with schema extensions;
create extension if not exists pg_jsonschema with schema extensions;

-- Helpers called by policies. Keep this schema out of the API's exposed schemas: nothing
-- here is reachable over the Data API except through the public wrappers in section 12.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ============================================================================
-- 1. Vocabulary (js/data/schema.js, ARCHITECTURE.md 4.1)
-- ============================================================================

-- Money is an integer number of minor units plus an ISO 4217 code. Unknown is null.
create domain public.money_minor as bigint check (value >= 0);
create domain public.currency_code as char(3) check (value ~ '^[A-Z]{3}$');

create type public.category as enum ('sneaker', 'watch', 'clothing');
create type public.retrieval_status as enum ('candidate_found', 'similar_result', 'no_match', 'processing_error', 'not_run');
create type public.identity_resolution as enum ('unconfirmed', 'user_confirmed', 'identifier_supported', 'manual');
create type public.variant_state as enum ('confirmed', 'incomplete', 'conflicting', 'not_applicable');
create type public.owned_condition as enum ('new', 'like_new', 'good', 'well_worn');
create type public.offer_condition as enum ('new', 'used_like_new', 'used_good', 'used_fair');
create type public.wish_condition as enum ('new_only', 'new_or_used');
create type public.wish_reason as enum ('want_exact', 'like_style', 'too_expensive', 'find_alternatives', 'match_owned');
create type public.wish_intent as enum ('exact', 'inspiration', 'complement');
create type public.wishlist_status as enum ('active', 'purchased', 'removed');
create type public.size_system as enum ('US-M', 'US-W', 'EU', 'UK', 'ALPHA', 'WAIST-INSEAM', 'ONE-SIZE');
create type public.app_role as enum ('user', 'stylist', 'admin');
create type public.style_tag as enum ('minimal', 'classic', 'street', 'sporty', 'outdoor', 'workwear', 'preppy', 'tech', 'vintage', 'dressy', 'bold');
create type public.intended_use as enum ('everyday', 'work', 'running', 'training', 'outdoors', 'going_out', 'formal');
create type public.feedback_type as enum ('too_expensive', 'wrong_style', 'too_similar', 'more_like_this', 'saved');
create type public.evidence_kind as enum ('visual', 'color', 'identifier', 'brand_text', 'product_link', 'catalog_search', 'user_selection');
create type public.evidence_source as enum ('image_features', 'ocr', 'barcode', 'user_entered', 'url', 'catalog');
create type public.text_source as enum ('ocr', 'barcode', 'user_entered');
create type public.color_name as enum (
  'white', 'off-white', 'bone', 'light-grey', 'grey', 'charcoal', 'black', 'navy', 'blue', 'light-blue',
  'teal', 'green', 'forest', 'olive', 'sage', 'khaki', 'tan', 'gum', 'camel', 'brown', 'rust', 'burgundy',
  'red', 'orange', 'mustard', 'yellow', 'pink', 'purple', 'silver', 'steel', 'gunmetal', 'gold', 'rose-gold', 'bronze'
);
create type public.color_family as enum ('light-neutral', 'mid-neutral', 'dark-neutral', 'cool', 'earth', 'warm', 'metal-cool', 'metal-warm');
create type public.ui_theme as enum ('system', 'light', 'dark');

-- Category attribute vocabularies (ATTRIBUTE_RULES in js/data/schema.js).
create type public.sneaker_closure as enum ('laces', 'slip-on', 'strap');
create type public.sneaker_cut as enum ('low', 'mid', 'high');
create type public.watch_movement as enum ('automatic', 'manual', 'quartz', 'solar', 'digital');
create type public.strap_attachment as enum ('spring_bar', 'quick_release', 'integrated');
create type public.clothing_fit as enum ('slim', 'regular', 'relaxed', 'oversized');

-- Catalog images. 'licensed' is a production addition for images used under a direct
-- agreement with the brand or photographer.
create type public.image_license as enum ('owned', 'licensed', 'feed-terms');
create type public.image_status as enum ('active', 'expired', 'taken_down');

-- Retailers and offers.
create type public.retailer_kind as enum ('retailer', 'marketplace');
create type public.affiliate_status as enum ('approved', 'pending', 'none');
create type public.seller_type as enum ('retailer', 'authorized_dealer', 'independent_dealer', 'marketplace_seller', 'private_seller');
create type public.stock_status as enum ('in_stock', 'low_stock', 'out_of_stock');
create type public.shipping_kind as enum ('free', 'flat', 'unknown', 'calculated_at_checkout');
create type public.fee_kind as enum ('none', 'known', 'unknown');
create type public.tax_kind as enum ('unknown', 'estimate');
create type public.warranty_kind as enum ('manufacturer', 'seller', 'none', 'unknown');
create type public.listing_status as enum ('active', 'removed');

-- User data.
create type public.photo_kind as enum ('original', 'processing', 'cleaned', 'label');
create type public.display_choice as enum ('catalog', 'original', 'cleaned');
create type public.owner_change_part as enum ('strap', 'bracelet', 'other');
create type public.match_dest as enum ('owned', 'wishlist');
create type public.match_job_status as enum ('queued', 'processing', 'done', 'error', 'timeout', 'rejected', 'confirmed');
create type public.candidate_kind as enum ('match', 'similar');
create type public.candidate_strength as enum ('strong', 'possible', 'weak');
create type public.ask_for_kind as enum ('style_code', 'size_tag_photo', 'brand_label', 'barcode', 'reference', 'caseback_photo', 'product_link');
create type public.rec_mode as enum ('similar', 'matching', 'alternatives', 'feed');
create type public.rec_seed_type as enum ('owned', 'wishlist', 'variant');

-- Commerce, stylist and operations.
create type public.conversion_status as enum ('pending', 'approved', 'reversed', 'paid');
create type public.conversion_source as enum ('network_report', 'webhook', 'admin', 'demo');
create type public.stylist_request_status as enum ('open', 'answered', 'closed', 'revoked');
create type public.correction_status as enum ('open', 'accepted', 'rejected');
create type public.import_status as enum ('running', 'succeeded', 'partial', 'failed');

-- ============================================================================
-- 2. Pure validation functions used by check constraints
-- ============================================================================
-- These live in public with the default execute grant because a check constraint runs
-- with the rights of whoever writes the row. They read no tables.

-- Mirrors validateSize() in js/data/schema.js: a size always carries its system and a value
-- in that system's format.
create function public.is_valid_size(size_value text, size_system public.size_system)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case size_system
    when 'US-M' then size_value ~ '^[0-9]{1,2}(\.5)?$'
    when 'US-W' then size_value ~ '^[0-9]{1,2}(\.5)?$'
    when 'UK' then size_value ~ '^[0-9]{1,2}(\.5)?$'
    when 'EU' then size_value ~ '^[0-9]{2}(\.5)?$'
    when 'ALPHA' then size_value ~ '^(XXS|XS|S|M|L|XL|XXL|[2-5]XL)$'
    when 'WAIST-INSEAM' then size_value ~ '^[0-9]{2}x[0-9]{2}$'
    when 'ONE-SIZE' then size_value ~ '^[A-Za-z0-9 ./-]{1,16}$'
  end
$$;

-- GS1 check digit for GTIN-8, -12, -13 and -14: weights 3, 1, 3, ... from the right.
create function public.is_valid_gtin(code text)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when code ~ '^([0-9]{8}|[0-9]{12,14})$' then (
      select (10 - sum(substr(lpad(code, 14, '0'), i, 1)::integer * case when i % 2 = 1 then 3 else 1 end) % 10) % 10
      from generate_series(1, 13) as i
    ) = substr(lpad(code, 14, '0'), 14, 1)::integer
    else false
  end
$$;

-- True when every key of a JSON object is in the allowed list (affiliate parameters).
create function public.jsonb_keys_within(doc jsonb, allowed text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when jsonb_typeof(doc) = 'object' then array(select jsonb_object_keys(doc)) <@ allowed
    else false
  end
$$;

-- ============================================================================
-- 3. Reference vocabulary tables
-- ============================================================================

-- Named colors for catalog facts, photo color naming and preferences (js/data/colors.js).
-- Hex values are naming reference points, not exact product colors.
create table public.colors (
  name public.color_name primary key,
  label text not null check (char_length(label) between 1 and 40),
  hex char(7) not null check (hex ~ '^#[0-9a-f]{6}$'),
  family public.color_family not null
);

-- Product types per category. Products reference (category, type), so a watch can't be a runner.
create table public.product_types (
  category public.category not null,
  type text not null check (type ~ '^[a-z]+(-[a-z]+)*$'),
  label text not null check (char_length(label) between 1 and 40),
  primary key (category, type)
);

insert into public.colors (name, label, hex, family) values
  ('white', 'White', '#f5f5f2', 'light-neutral'),
  ('off-white', 'Off-white', '#ece6d6', 'light-neutral'),
  ('bone', 'Bone', '#ddd3bd', 'light-neutral'),
  ('light-grey', 'Light grey', '#c4c6c4', 'light-neutral'),
  ('grey', 'Grey', '#8e9092', 'mid-neutral'),
  ('charcoal', 'Charcoal', '#45484c', 'dark-neutral'),
  ('black', 'Black', '#1e1f21', 'dark-neutral'),
  ('navy', 'Navy', '#1f2a44', 'dark-neutral'),
  ('blue', 'Blue', '#2f5fa8', 'cool'),
  ('light-blue', 'Light blue', '#9dbbdb', 'cool'),
  ('teal', 'Teal', '#2c7470', 'cool'),
  ('green', 'Green', '#3d8a4f', 'cool'),
  ('forest', 'Forest green', '#2b4532', 'earth'),
  ('olive', 'Olive', '#5d6136', 'earth'),
  ('sage', 'Sage', '#9aa58a', 'earth'),
  ('khaki', 'Khaki', '#b6a77c', 'earth'),
  ('tan', 'Tan', '#c09a6b', 'earth'),
  ('gum', 'Gum', '#b37a43', 'earth'),
  ('camel', 'Camel', '#a87a4c', 'earth'),
  ('brown', 'Brown', '#6b4a32', 'earth'),
  ('rust', 'Rust', '#a24d27', 'warm'),
  ('burgundy', 'Burgundy', '#6d2333', 'warm'),
  ('red', 'Red', '#c0322e', 'warm'),
  ('orange', 'Orange', '#e2742c', 'warm'),
  ('mustard', 'Mustard', '#c9a032', 'warm'),
  ('yellow', 'Yellow', '#ecd04a', 'warm'),
  ('pink', 'Pink', '#e3a3b1', 'warm'),
  ('purple', 'Purple', '#5d4382', 'cool'),
  ('silver', 'Silver', '#b9bcc0', 'metal-cool'),
  ('steel', 'Steel', '#9ca1a6', 'metal-cool'),
  ('gunmetal', 'Gunmetal', '#55595e', 'metal-cool'),
  ('gold', 'Gold', '#c7a254', 'metal-warm'),
  ('rose-gold', 'Rose gold', '#c69078', 'metal-warm'),
  ('bronze', 'Bronze', '#94714a', 'metal-warm');

insert into public.product_types (category, type, label) values
  ('sneaker', 'runner', 'Runner'),
  ('sneaker', 'court', 'Court'),
  ('sneaker', 'trail', 'Trail'),
  ('sneaker', 'skate', 'Skate'),
  ('sneaker', 'high-top', 'High-top'),
  ('sneaker', 'slip-on', 'Slip-on'),
  ('watch', 'field', 'Field watch'),
  ('watch', 'diver', 'Dive watch'),
  ('watch', 'dress', 'Dress watch'),
  ('watch', 'chronograph', 'Chronograph'),
  ('watch', 'gmt', 'GMT'),
  ('watch', 'digital', 'Digital'),
  ('watch', 'strap', 'Strap'),
  ('clothing', 'tee', 'T-shirt'),
  ('clothing', 'oxford-shirt', 'Oxford shirt'),
  ('clothing', 'overshirt', 'Overshirt'),
  ('clothing', 'chore-jacket', 'Chore jacket'),
  ('clothing', 'field-jacket', 'Field jacket'),
  ('clothing', 'bomber', 'Bomber jacket'),
  ('clothing', 'hoodie', 'Hoodie'),
  ('clothing', 'crewneck', 'Crewneck sweater'),
  ('clothing', 'chinos', 'Chinos'),
  ('clothing', 'trousers', 'Trousers'),
  ('clothing', 'jeans', 'Jeans'),
  ('clothing', 'shorts', 'Shorts');

-- ============================================================================
-- 4. Accounts and profiles
-- ============================================================================

-- One row per Supabase Auth user, created by the trigger in section 10. Email stays in
-- auth.users. The role changes only through the service role: no client grant covers it.
create table public.accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  role public.app_role not null default 'user',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pseudonymous id written on click records. Kept outside the exposed schema, so nobody
-- (admins included) can join clicks back to an account through the API.
create table private.account_analytics (
  user_id uuid primary key references public.accounts (id) on delete cascade,
  analytics_id uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Server-side values no client may read, such as the salt behind admin job hashes.
create table private.settings (
  name text primary key check (name ~ '^[a-z_]{1,40}$'),
  value text not null
);

insert into private.settings (name, value) values ('job_hash_salt', gen_random_uuid()::text);

-- Preferences used for cold-start recommendations. Budgets are per category in minor units.
create table public.profiles (
  user_id uuid primary key references public.accounts (id) on delete cascade,
  onboarded_at timestamptz,
  shoe_size_value text,
  shoe_size_system public.size_system,
  top_size_value text,
  top_size_system public.size_system,
  bottom_size_value text,
  bottom_size_system public.size_system,
  budget_currency public.currency_code not null default 'USD',
  sneaker_budget_minor public.money_minor check (sneaker_budget_minor > 0),
  watch_budget_minor public.money_minor check (watch_budget_minor > 0),
  clothing_budget_minor public.money_minor check (clothing_budget_minor > 0),
  styles public.style_tag[] not null default '{}' check (cardinality(styles) <= 6),
  colors_liked public.color_name[] not null default '{}',
  colors_avoided public.color_name[] not null default '{}',
  uses public.intended_use[] not null default '{}',
  categories public.category[] not null default '{sneaker,watch,clothing}' check (cardinality(categories) >= 1),
  theme public.ui_theme not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_shoe_size check (
    num_nulls(shoe_size_value, shoe_size_system) in (0, 2)
    and (shoe_size_system is null or (shoe_size_system in ('US-M', 'US-W') and public.is_valid_size(shoe_size_value, shoe_size_system)))
  ),
  constraint profiles_top_size check (
    num_nulls(top_size_value, top_size_system) in (0, 2)
    and (top_size_system is null or (top_size_system = 'ALPHA' and public.is_valid_size(top_size_value, top_size_system)))
  ),
  constraint profiles_bottom_size check (
    num_nulls(bottom_size_value, bottom_size_system) in (0, 2)
    and (bottom_size_system is null or (bottom_size_system = 'WAIST-INSEAM' and public.is_valid_size(bottom_size_value, bottom_size_system)))
  ),
  -- A color can't be both liked and avoided (applyProfilePatch), and metals aren't pickable.
  constraint profiles_colors_disjoint check (not (colors_liked && colors_avoided)),
  constraint profiles_colors_pickable check (
    not ((colors_liked || colors_avoided) && '{silver,steel,gunmetal,gold,rose-gold,bronze}'::public.color_name[])
  )
);

-- ============================================================================
-- 5. Catalog: shared product facts
-- ============================================================================
-- Readable by every signed-in account, managed by admins. Catalog ids are stable slugs.
-- Rows are retired (retired_at) rather than deleted, because owned items point at them.

create table public.catalog_imports (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  source_name text not null check (char_length(source_name) between 1 and 200),
  status public.import_status not null default 'running',
  accepted_count integer not null default 0 check (accepted_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references public.accounts (id) on delete set null,
  constraint catalog_imports_finished check ((status = 'running') = (finished_at is null))
);

-- Why a feed row was not imported (validated against the category attribute rules).
create table public.catalog_import_rejections (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.catalog_imports (id) on delete cascade,
  source_id text check (char_length(source_id) <= 200),
  problems text[] not null check (cardinality(problems) between 1 and 50)
);

create table public.brands (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 80),
  categories public.category[] not null check (cardinality(categories) >= 1),
  country char(2) check (country ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category public.category not null,
  type text not null,
  brand_id text not null references public.brands (id),
  name text not null check (char_length(name) between 1 and 120),
  style_tags public.style_tag[] not null default '{}',
  materials text[] not null default '{}',
  features text[] not null default '{}',
  description text not null default '' check (char_length(description) <= 2000),
  sizing_system public.size_system,
  sizing_sizes text[],
  sizing_widths text[],
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, category),
  foreign key (category, type) references public.product_types (category, type),
  constraint products_sizing_pair check ((sizing_system is null) = (sizing_sizes is null)),
  constraint products_widths_need_sizing check (sizing_widths is null or sizing_system is not null)
);

-- Category-specific facts live in typed tables instead of one unvalidated JSON blob. A check
-- plus a composite foreign key pin each row's category, so a watch can't carry sneaker
-- facts, and a deferred trigger (section 10) makes sure each product has its row, which is
-- where required facts such as a sneaker's cut live.
create table public.sneaker_products (
  product_id text primary key,
  category public.category not null default 'sneaker' check (category = 'sneaker'),
  upper_material text check (char_length(upper_material) <= 120),
  sole_type text check (char_length(sole_type) <= 120),
  closure public.sneaker_closure,
  cut public.sneaker_cut not null,
  foreign key (product_id, category) references public.products (id, category) on delete cascade
);

create table public.watch_products (
  product_id text primary key,
  category public.category not null default 'watch' check (category = 'watch'),
  movement public.watch_movement,
  water_resistance_m integer check (water_resistance_m > 0 and water_resistance_m <= 12000),
  crystal text check (char_length(crystal) <= 80),
  attachment public.strap_attachment,
  foreign key (product_id, category) references public.products (id, category) on delete cascade
);

create table public.clothing_products (
  product_id text primary key,
  category public.category not null default 'clothing' check (category = 'clothing'),
  fit public.clothing_fit,
  material text check (char_length(material) <= 120),
  weight text check (char_length(weight) <= 60),
  foreign key (product_id, category) references public.products (id, category) on delete cascade
);

-- One version of a product (colorway for sneakers and clothing, reference for watches).
create table public.variants (
  id text primary key check (id ~ '^[a-z0-9]+(-{1,2}[a-z0-9]+)*$'),
  product_id text not null,
  category public.category not null,
  name text not null check (char_length(name) between 1 and 120),
  style_code text check (style_code ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]{1,39}$'),
  reference text check (reference ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]{1,39}$'),
  msrp_minor public.money_minor,
  msrp_currency public.currency_code,
  release_date date,
  release_source text check (char_length(release_source) <= 80),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, product_id),
  unique (id, category),
  foreign key (product_id, category) references public.products (id, category),
  constraint variants_msrp_pair check (num_nulls(msrp_minor, msrp_currency) in (0, 2)),
  constraint variants_release_source check (release_date is not null or release_source is null)
);

create table public.sneaker_variants (
  variant_id text primary key,
  category public.category not null default 'sneaker' check (category = 'sneaker'),
  colorway text not null check (char_length(colorway) between 1 and 80),
  foreign key (variant_id, category) references public.variants (id, category) on delete cascade
);

-- Watch dimensions are sourced catalog facts. They are never inferred from a photo.
create table public.watch_variants (
  variant_id text primary key,
  category public.category not null default 'watch' check (category = 'watch'),
  dial_color text check (char_length(dial_color) <= 60),
  case_material text check (char_length(case_material) <= 80),
  diameter_mm numeric(5, 2) check (diameter_mm > 0 and diameter_mm < 100),
  thickness_mm numeric(5, 2) check (thickness_mm > 0 and thickness_mm < 50),
  lug_to_lug_mm numeric(5, 2) check (lug_to_lug_mm > 0 and lug_to_lug_mm < 100),
  lug_width_mm numeric(4, 1) check (lug_width_mm between 8 and 30),
  bracelet text check (char_length(bracelet) <= 120),
  strap_width_mm numeric(4, 1) check (strap_width_mm between 8 and 30),
  foreign key (variant_id, category) references public.variants (id, category) on delete cascade
);

create table public.clothing_variants (
  variant_id text primary key,
  category public.category not null default 'clothing' check (category = 'clothing'),
  color text not null check (char_length(color) between 1 and 60),
  foreign key (variant_id, category) references public.variants (id, category) on delete cascade
);

-- Barcodes that identify one version. A GTIN maps to exactly one version.
create table public.variant_gtins (
  gtin text primary key check (public.is_valid_gtin(gtin)),
  variant_id text not null references public.variants (id) on delete cascade,
  source text not null default 'catalog' check (source ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create table public.variant_colors (
  variant_id text not null references public.variants (id) on delete cascade,
  position smallint not null check (position between 0 and 7),
  color public.color_name not null references public.colors (name),
  role text not null check (role ~ '^[a-z]{1,20}$'),
  weight numeric(4, 3) not null check (weight > 0 and weight <= 1),
  primary key (variant_id, position)
);

-- Where each fact came from, keyed by the provider's own stable id.
create table public.product_sources (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  source_id text not null check (char_length(source_id) between 1 and 200),
  retrieved_at timestamptz not null,
  import_id uuid references public.catalog_imports (id) on delete set null,
  unique (provider, source_id)
);

create table public.variant_sources (
  id uuid primary key default gen_random_uuid(),
  variant_id text not null references public.variants (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  source_id text not null check (char_length(source_id) between 1 and 200),
  retrieved_at timestamptz not null,
  import_id uuid references public.catalog_imports (id) on delete set null,
  unique (provider, source_id)
);

-- Catalog image provenance, one or more per version (engine/provenance.js reads these
-- permissions). An image is shown only where its row allows it; the person's own photo is
-- the fallback and is never replaced.
create table public.catalog_images (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  variant_id text not null references public.variants (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  source_id text check (char_length(source_id) <= 200),
  source_url text not null check (source_url ~ '^(https://|generated:)' and char_length(source_url) <= 2048),
  attribution text check (char_length(attribution) <= 300),
  license public.image_license not null,
  inventory_display boolean not null,
  requires_active_offer boolean not null,
  -- Null means the terms set no cache limit (owned or licensed images).
  cache_ttl_hours integer check (cache_ttl_hours > 0),
  attribution_required boolean not null,
  -- Production addition: whether the source's terms allow computing a retrieval embedding.
  allow_retrieval_index boolean not null default false,
  status public.image_status not null default 'active',
  status_reason text check (char_length(status_reason) <= 300),
  status_changed_at timestamptz not null default now(),
  fetched_at timestamptz not null,
  expires_at timestamptz,
  storage_bucket text check (storage_bucket in ('catalog-assets', 'catalog-restricted')),
  storage_path text check (char_length(storage_path) between 1 and 512),
  width integer check (width > 0),
  height integer check (height > 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, variant_id),
  constraint catalog_images_attribution check (not attribution_required or attribution is not null),
  constraint catalog_images_expiry check (expires_at is null or expires_at > fetched_at),
  constraint catalog_images_storage_pair check (num_nulls(storage_bucket, storage_path) in (0, 2)),
  -- The public bucket serves a file to anyone holding its URL, so only images we may show
  -- unconditionally can be stored there (0002_storage.sql).
  constraint catalog_images_public_bucket check (
    storage_bucket is distinct from 'catalog-assets'
    or (license in ('owned', 'licensed') and inventory_display and not requires_active_offer)
  )
);

-- Retrieval embeddings of catalog images. The column has no fixed dimension, so a second
-- model can be added next to the first; each model gets its own partial expression indexes
-- (section 14), since a pgvector index needs one dimension. Rows exist only for active
-- images whose terms allow indexing (triggers in section 10).
create table public.catalog_image_embeddings (
  image_id text not null,
  model text not null check (model ~ '^[a-z0-9@._-]{1,64}$'),
  variant_id text not null,
  category public.category not null,
  dims integer not null check (dims between 1 and 4000),
  embedding extensions.vector not null,
  computed_at timestamptz not null default now(),
  primary key (image_id, model),
  foreign key (image_id, variant_id) references public.catalog_images (id, variant_id) on delete cascade,
  foreign key (variant_id, category) references public.variants (id, category) on delete cascade,
  constraint catalog_image_embeddings_dims check (extensions.vector_dims(embedding) = dims)
);

create table public.retailers (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 80),
  domain text not null unique check (domain ~ '^([a-z0-9-]+\.)+[a-z]{2,}$'),
  kind public.retailer_kind not null,
  categories public.category[] not null check (cardinality(categories) >= 1),
  returns_policy text check (char_length(returns_policy) <= 500),
  url_pattern text check (url_pattern ~ '^/'),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Affiliate program terms per retailer. Admin-only: the server builds outbound links, so
-- clients never need program ids or parameter values.
create table public.affiliate_programs (
  retailer_id text primary key references public.retailers (id) on delete cascade,
  network_id text not null check (network_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  program_id text not null check (char_length(program_id) between 1 and 64),
  status public.affiliate_status not null,
  allowed_params text[] not null default '{}',
  param_values jsonb not null default '{}'
    check (extensions.jsonb_matches_schema('{"type":"object","maxProperties":20,"additionalProperties":{"type":"string","maxLength":200}}', param_values)),
  updated_at timestamptz not null default now(),
  constraint affiliate_programs_params_allowed check (public.jsonb_keys_within(param_values, allowed_params))
);

-- One listing per retailer and version, with its condition. Unknown costs stay unknown:
-- each cost has a kind, and an amount exists only when the kind says it is known.
create table public.offers (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  retailer_id text not null references public.retailers (id),
  listing_id text not null check (char_length(listing_id) between 1 and 120),
  variant_id text not null references public.variants (id),
  condition public.offer_condition not null,
  seller_type public.seller_type not null,
  -- Null when not stated; an empty array means the watch comes alone.
  included_components text[],
  -- Sized offers keep price and stock per size in offer_sizes; unsized ones (watches) here.
  is_sized boolean not null,
  price_minor public.money_minor,
  stock public.stock_status,
  currency public.currency_code not null,
  shipping_kind public.shipping_kind not null default 'unknown',
  shipping_minor public.money_minor,
  fee_kind public.fee_kind not null default 'unknown',
  fee_minor public.money_minor,
  fee_label text check (char_length(fee_label) <= 80),
  tax_kind public.tax_kind not null default 'unknown',
  tax_minor public.money_minor,
  delivery_min_days smallint check (delivery_min_days >= 0),
  delivery_max_days smallint,
  returns text check (char_length(returns) <= 500),
  warranty_kind public.warranty_kind not null default 'unknown',
  warranty_months smallint check (warranty_months > 0),
  warranty_provider text check (char_length(warranty_provider) <= 80),
  url text not null check (url ~ '^https://' and char_length(url) <= 2048),
  listing_status public.listing_status not null default 'active',
  last_checked_at timestamptz not null,
  source_provider text not null check (source_provider ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  source_offer_id text check (char_length(source_offer_id) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (retailer_id, listing_id),
  unique (id, is_sized),
  constraint offers_unsized_fields check (not is_sized or (price_minor is null and stock is null)),
  constraint offers_shipping check ((shipping_kind = 'flat') = (shipping_minor is not null)),
  constraint offers_fees check ((fee_kind = 'known') = (fee_minor is not null)),
  constraint offers_fee_label check (fee_kind <> 'none' or fee_label is null),
  constraint offers_tax check ((tax_kind = 'estimate') = (tax_minor is not null)),
  constraint offers_delivery check (
    num_nulls(delivery_min_days, delivery_max_days) in (0, 2)
    and (delivery_min_days is null or delivery_min_days <= delivery_max_days)
  ),
  constraint offers_warranty check (warranty_kind in ('manufacturer', 'seller') or (warranty_months is null and warranty_provider is null))
);

-- Price and stock per size for sized offers. The composite key only accepts sized offers.
create table public.offer_sizes (
  offer_id text not null,
  is_sized boolean not null default true check (is_sized),
  size_value text not null,
  size_system public.size_system not null,
  price_minor public.money_minor,
  stock public.stock_status not null,
  primary key (offer_id, size_system, size_value),
  foreign key (offer_id, is_sized) references public.offers (id, is_sized) on delete cascade,
  constraint offer_sizes_valid check (public.is_valid_size(size_value, size_system))
);

-- A person's proposed fix to a shared catalog fact. Never applied without admin review.
create table public.catalog_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.accounts (id) on delete set null,
  product_id text not null references public.products (id),
  variant_id text,
  field text not null check (field ~ '^[a-zA-Z][a-zA-Z0-9_.]{0,63}$'),
  proposed_value text not null check (char_length(proposed_value) between 1 and 500),
  note text not null default '' check (char_length(note) <= 1000),
  status public.correction_status not null default 'open',
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.accounts (id) on delete set null,
  reviewed_at timestamptz,
  foreign key (variant_id, product_id) references public.variants (id, product_id),
  constraint catalog_corrections_review check ((status = 'open') = (reviewed_at is null))
);

-- ============================================================================
-- 6. Private user data
-- ============================================================================
-- Child tables repeat user_id and use composite foreign keys on (id, user_id), so a row can
-- only point at the same person's rows and policies stay a single column comparison.

-- Photo metadata. Bytes live in the private user-photos bucket under <user id>/
-- (0002_storage.sql). Rows are written by the server after it re-encodes the upload, which
-- drops EXIF and GPS data; normalized_at records when that happened.
create table public.photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.accounts (id) on delete cascade,
  kind public.photo_kind not null,
  -- The original a processing or cleaned copy was made from. Deleting the original deletes
  -- its copies' rows; the server removes the files through the Storage API.
  source_photo_id uuid,
  storage_path text not null unique check (char_length(storage_path) <= 512),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  width integer not null check (width between 200 and 4096),
  height integer not null check (height between 200 and 4096),
  bytes integer not null check (bytes between 1 and 15728640),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  normalized_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (source_photo_id, user_id) references public.photos (id, user_id) on delete cascade,
  constraint photos_path_prefix check (split_part(storage_path, '/', 1) = user_id::text),
  constraint photos_derived check ((kind in ('processing', 'cleaned')) = (source_photo_id is not null))
);

-- One photo-to-product match attempt (matchJob). Written by the matching worker with the
-- service role; the owner reads it.
create table public.match_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.accounts (id) on delete cascade,
  dest public.match_dest not null,
  category public.category not null,
  photo_id uuid,
  -- Normalized 0..1 crop; rotation in 90 degree steps.
  crop_x real,
  crop_y real,
  crop_w real,
  crop_h real,
  crop_rotate smallint not null default 0 check (crop_rotate in (0, 90, 180, 270)),
  product_url text check (product_url ~ '^https?://' and char_length(product_url) <= 2048),
  status public.match_job_status not null default 'queued',
  attempts smallint not null default 0 check (attempts between 0 and 3),
  error_code text check (error_code ~ '^[a-z_]{1,40}$'),
  error_message text check (char_length(error_message) <= 300),
  latency_ms integer check (latency_ms >= 0),
  retrieval public.retrieval_status,
  -- MatchResult.features: named colors and aspect computed from the photo. No embedding of
  -- the person's photo is kept.
  result_features jsonb check (result_features is null or extensions.jsonb_matches_schema(
    '{"type":"object","additionalProperties":false,"required":["colors"],"properties":{"colors":{"type":"array","maxItems":8,"items":{"type":"object","additionalProperties":false,"required":["name","hex","weight"],"properties":{"name":{"type":"string","maxLength":20},"hex":{"type":"string","pattern":"^#[0-9a-f]{6}$"},"weight":{"type":"number","minimum":0,"maximum":1}}}},"aspect":{"type":["number","null"],"minimum":0},"category":{"enum":["sneaker","watch","clothing",null]}}}',
    result_features)),
  matcher_version text check (char_length(matcher_version) <= 64),
  catalog_version text check (char_length(catalog_version) <= 64),
  confirmed_owned_id uuid,
  confirmed_wishlist_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (photo_id, user_id) references public.photos (id, user_id) on delete set null (photo_id),
  constraint match_jobs_crop check (
    num_nulls(crop_x, crop_y, crop_w, crop_h) in (0, 4)
    and (crop_x is null or (crop_x >= 0 and crop_y >= 0 and crop_w > 0 and crop_h > 0
      and crop_x + crop_w <= 1.0001 and crop_y + crop_h <= 1.0001))
  ),
  constraint match_jobs_error check ((status in ('error', 'timeout')) = (error_code is not null)),
  constraint match_jobs_result check (status <> 'done' or retrieval is not null),
  constraint match_jobs_confirmed check (
    num_nonnulls(confirmed_owned_id, confirmed_wishlist_id) <= 1
    and (status = 'confirmed' or num_nonnulls(confirmed_owned_id, confirmed_wishlist_id) = 0)
  )
);

-- Text evidence attached to a job: OCR from a label photo, a scanned barcode or a typed code.
create table public.match_job_texts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  user_id uuid not null,
  text text not null check (char_length(text) between 1 and 200),
  source public.text_source not null,
  added_at timestamptz not null default now(),
  foreign key (job_id, user_id) references public.match_jobs (id, user_id) on delete cascade
);

create table public.match_job_label_photos (
  job_id uuid not null,
  photo_id uuid not null,
  user_id uuid not null,
  primary key (job_id, photo_id),
  foreign key (job_id, user_id) references public.match_jobs (id, user_id) on delete cascade,
  foreign key (photo_id, user_id) references public.photos (id, user_id) on delete cascade
);

-- At most five candidates per job, best first. A 'similar' candidate is a lookalike: it can
-- become an item's identity only when the person picks it, and is labeled as similar.
create table public.match_candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  user_id uuid not null,
  rank smallint not null check (rank between 1 and 5),
  product_id text not null references public.products (id),
  kind public.candidate_kind not null,
  strength public.candidate_strength not null,
  -- Internal ordering only. Screens show strength in words, never a percentage.
  score real not null,
  variant_id text,
  variant_ambiguous boolean not null default false,
  unique (job_id, rank),
  unique (id, user_id),
  foreign key (job_id, user_id) references public.match_jobs (id, user_id) on delete cascade,
  foreign key (variant_id, product_id) references public.variants (id, product_id)
);

create table public.match_candidate_variant_options (
  candidate_id uuid not null,
  user_id uuid not null,
  variant_id text not null references public.variants (id),
  score real not null,
  note text check (char_length(note) <= 200),
  primary key (candidate_id, variant_id),
  foreign key (candidate_id, user_id) references public.match_candidates (id, user_id) on delete cascade
);

create table public.match_candidate_evidence (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null,
  user_id uuid not null,
  kind public.evidence_kind not null,
  source public.evidence_source not null,
  detail text not null check (char_length(detail) between 1 and 300),
  foreign key (candidate_id, user_id) references public.match_candidates (id, user_id) on delete cascade
);

create table public.match_candidate_conflicts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null,
  user_id uuid not null,
  kind text not null check (kind ~ '^[a-z_]{1,40}$'),
  detail text not null check (char_length(detail) between 1 and 300),
  foreign key (candidate_id, user_id) references public.match_candidates (id, user_id) on delete cascade
);

-- What the matcher asks the person for next (MatchResult.askFor).
create table public.match_job_asks (
  job_id uuid not null,
  user_id uuid not null,
  kind public.ask_for_kind not null,
  reason text not null check (char_length(reason) between 1 and 200),
  primary key (job_id, kind),
  foreign key (job_id, user_id) references public.match_jobs (id, user_id) on delete cascade
);

-- The person's private record of one physical item. Shared facts stay in the catalog; this
-- row only points at them. Several rows may share a version (several physical copies).
create table public.owned_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.accounts (id) on delete cascade,
  category public.category not null,
  product_id text,
  variant_id text,
  custom_brand text check (char_length(custom_brand) between 1 and 120),
  custom_name text check (char_length(custom_name) between 1 and 120),
  custom_variant_name text check (char_length(custom_variant_name) between 1 and 120),
  custom_type text check (char_length(custom_type) between 1 and 40),
  custom_colors public.color_name[] check (cardinality(custom_colors) <= 4),
  -- Identity: retrieval, resolution and variant state are stored separately.
  retrieval public.retrieval_status not null default 'not_run',
  resolution public.identity_resolution not null,
  variant_state public.variant_state not null,
  confirmed_by uuid,
  confirmed_at timestamptz,
  match_job_id uuid,
  -- Private details. Size, condition and authenticity are never inferred from a photo.
  size_value text,
  size_system public.size_system,
  size_width text check (char_length(size_width) between 1 and 8),
  condition public.owned_condition,
  purchase_price_minor public.money_minor,
  purchase_currency public.currency_code,
  purchase_date date,
  purchase_from text check (char_length(purchase_from) <= 120),
  notes text not null default '' check (char_length(notes) <= 2000),
  -- Watches only, private, and never treated as a product identifier.
  serial_number text check (char_length(serial_number) between 1 and 64),
  photo_original_id uuid,
  photo_cleaned_id uuid,
  display public.display_choice not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, category),
  foreign key (product_id, category) references public.products (id, category),
  foreign key (variant_id, product_id) references public.variants (id, product_id),
  foreign key (match_job_id, user_id) references public.match_jobs (id, user_id) on delete set null (match_job_id),
  foreign key (photo_original_id, user_id) references public.photos (id, user_id) on delete set null (photo_original_id),
  foreign key (photo_cleaned_id, user_id) references public.photos (id, user_id) on delete set null (photo_cleaned_id),
  -- A custom record has no catalog identity, and a catalog record has no custom fields.
  constraint owned_items_manual check ((resolution = 'manual') = (product_id is null)),
  constraint owned_items_custom check (
    case when product_id is null then custom_brand is not null and custom_name is not null
    else num_nonnulls(custom_brand, custom_name, custom_variant_name, custom_type, custom_colors) = 0 end
  ),
  constraint owned_items_variant_needs_product check (variant_id is null or product_id is not null),
  constraint owned_items_variant_state check (
    case when resolution = 'manual' then variant_state = 'not_applicable'
    when variant_state = 'confirmed' then variant_id is not null
    else variant_state <> 'not_applicable' end
  ),
  -- Confirmation is the owner's own act and is labeled as theirs, never as verification.
  constraint owned_items_confirmation check (
    case when resolution in ('user_confirmed', 'identifier_supported') then confirmed_by = user_id and confirmed_at is not null
    else confirmed_by is null and confirmed_at is null end
  ),
  constraint owned_items_size check (
    num_nulls(size_value, size_system) in (0, 2)
    and (size_value is null or public.is_valid_size(size_value, size_system))
    and (category <> 'watch' or size_system is null or size_system = 'ONE-SIZE')
    and (size_width is null or size_value is not null)
  ),
  constraint owned_items_purchase check (purchase_price_minor is null or purchase_currency is not null),
  constraint owned_items_serial check (serial_number is null or category = 'watch')
);

alter table public.match_jobs
  add constraint match_jobs_confirmed_owned_fk foreign key (confirmed_owned_id, user_id)
  references public.owned_items (id, user_id) on delete set null (confirmed_owned_id);

create table public.owned_item_label_photos (
  item_id uuid not null,
  photo_id uuid not null,
  user_id uuid not null,
  primary key (item_id, photo_id),
  foreign key (item_id, user_id) references public.owned_items (id, user_id) on delete cascade,
  foreign key (photo_id, user_id) references public.photos (id, user_id) on delete cascade
);

-- Owner changes to a watch, such as a new strap. The composite key on category only accepts
-- watches.
create table public.owned_item_changes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  user_id uuid not null,
  category public.category not null default 'watch' check (category = 'watch'),
  position smallint not null check (position between 0 and 4),
  part public.owner_change_part not null,
  description text not null default '' check (char_length(description) <= 200),
  width_mm numeric(4, 1) check (width_mm between 8 and 30),
  unique (item_id, position),
  foreign key (item_id, user_id, category) references public.owned_items (id, user_id, category) on delete cascade
);

create table public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.accounts (id) on delete cascade,
  status public.wishlist_status not null default 'active',
  category public.category not null,
  product_id text,
  variant_id text,
  custom_brand text check (char_length(custom_brand) between 1 and 120),
  custom_name text check (char_length(custom_name) between 1 and 120),
  custom_variant_name text check (char_length(custom_variant_name) between 1 and 120),
  custom_type text check (char_length(custom_type) between 1 and 40),
  custom_colors public.color_name[] check (cardinality(custom_colors) <= 4),
  retrieval public.retrieval_status not null default 'not_run',
  resolution public.identity_resolution not null,
  variant_state public.variant_state not null,
  confirmed_by uuid,
  confirmed_at timestamptz,
  match_job_id uuid,
  reason public.wish_reason not null,
  reason_note text not null default '' check (char_length(reason_note) <= 280),
  intent public.wish_intent not null,
  desired_size_value text,
  desired_size_system public.size_system,
  desired_condition public.wish_condition not null default 'new_only',
  variant_flexible boolean not null,
  target_price_minor public.money_minor check (target_price_minor > 0),
  target_currency public.currency_code,
  source_url text check (source_url ~ '^https?://' and char_length(source_url) <= 2048),
  -- Saved from a photo while matching is still running: no identity yet.
  match_pending boolean not null default false,
  photo_original_id uuid,
  -- Set by markPurchased, the only way a wishlist item becomes owned. A click never does it.
  purchased_owned_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (product_id, category) references public.products (id, category),
  foreign key (variant_id, product_id) references public.variants (id, product_id),
  foreign key (match_job_id, user_id) references public.match_jobs (id, user_id) on delete set null (match_job_id),
  foreign key (photo_original_id, user_id) references public.photos (id, user_id) on delete set null (photo_original_id),
  foreign key (purchased_owned_id, user_id) references public.owned_items (id, user_id) on delete set null (purchased_owned_id),
  constraint wishlist_items_manual check ((resolution = 'manual') = (product_id is null)),
  constraint wishlist_items_custom check (
    case when product_id is null then (custom_brand is not null and custom_name is not null) or match_pending
    else num_nonnulls(custom_brand, custom_name, custom_variant_name, custom_type, custom_colors) = 0 end
  ),
  constraint wishlist_items_variant_needs_product check (variant_id is null or product_id is not null),
  constraint wishlist_items_variant_state check (
    case when resolution = 'manual' then variant_state = 'not_applicable'
    when variant_state = 'confirmed' then variant_id is not null
    else variant_state <> 'not_applicable' end
  ),
  constraint wishlist_items_confirmation check (
    case when resolution in ('user_confirmed', 'identifier_supported') then confirmed_by = user_id and confirmed_at is not null
    else confirmed_by is null and confirmed_at is null end
  ),
  constraint wishlist_items_desired_size check (
    num_nulls(desired_size_value, desired_size_system) in (0, 2)
    and (desired_size_value is null or public.is_valid_size(desired_size_value, desired_size_system))
    and (category <> 'watch' or desired_size_system is null or desired_size_system = 'ONE-SIZE')
  ),
  constraint wishlist_items_target check (num_nulls(target_price_minor, target_currency) in (0, 2)),
  constraint wishlist_items_purchased check (purchased_owned_id is null or status = 'purchased')
);

alter table public.match_jobs
  add constraint match_jobs_confirmed_wishlist_fk foreign key (confirmed_wishlist_id, user_id)
  references public.wishlist_items (id, user_id) on delete set null (confirmed_wishlist_id);

-- Owned items a wishlist item would go with (linkedOwnedIds).
create table public.wishlist_links (
  wishlist_item_id uuid not null,
  owned_item_id uuid not null,
  user_id uuid not null,
  primary key (wishlist_item_id, owned_item_id),
  foreign key (wishlist_item_id, user_id) references public.wishlist_items (id, user_id) on delete cascade,
  foreign key (owned_item_id, user_id) references public.owned_items (id, user_id) on delete cascade
);

-- Evidence behind an item's identity and where it came from. Written by the server only,
-- so a client can't claim an identifier it never provided.
create table public.identity_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  owned_item_id uuid,
  wishlist_item_id uuid,
  kind public.evidence_kind not null,
  source public.evidence_source not null,
  detail text not null check (char_length(detail) between 1 and 300),
  created_at timestamptz not null default now(),
  foreign key (owned_item_id, user_id) references public.owned_items (id, user_id) on delete cascade,
  foreign key (wishlist_item_id, user_id) references public.wishlist_items (id, user_id) on delete cascade,
  constraint identity_evidence_one_item check (num_nonnulls(owned_item_id, wishlist_item_id) = 1)
);

-- Evidence that disagrees with the chosen version (variant state 'conflicting').
create table public.identity_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  owned_item_id uuid,
  wishlist_item_id uuid,
  kind text not null check (kind ~ '^[a-z_]{1,40}$'),
  detail text not null check (char_length(detail) between 1 and 300),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (owned_item_id, user_id) references public.owned_items (id, user_id) on delete cascade,
  foreign key (wishlist_item_id, user_id) references public.wishlist_items (id, user_id) on delete cascade,
  constraint identity_conflicts_one_item check (num_nonnulls(owned_item_id, wishlist_item_id) = 1)
);

create table public.rec_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.accounts (id) on delete cascade,
  mode public.rec_mode not null,
  seed_type public.rec_seed_type,
  seed_ids text[] not null default '{}' check (cardinality(seed_ids) <= 10),
  category public.category,
  constraints jsonb not null default '{}' check (extensions.jsonb_matches_schema(
    '{"type":"object","additionalProperties":false,"properties":{"maxPriceMinor":{"type":"integer","minimum":0},"currency":{"type":"string","pattern":"^[A-Z]{3}$"},"size":{"type":"object","additionalProperties":false,"required":["value","system"],"properties":{"value":{"type":"string","maxLength":16},"system":{"enum":["US-M","US-W","EU","UK","ALPHA","WAIST-INSEAM","ONE-SIZE"]}}},"condition":{"enum":["new_only","new_or_used","new","used_like_new","used_good","used_fair"]},"inStockOnly":{"type":"boolean"},"includeOwned":{"type":"boolean"},"includeUnknownPrice":{"type":"boolean"}}}',
    constraints)),
  -- The person's typed request, kept private like any other note.
  request_text text check (char_length(request_text) <= 500),
  result_variant_ids text[] not null default '{}' check (cardinality(result_variant_ids) <= 100),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  constraint rec_requests_seeds check ((seed_type is null) = (cardinality(seed_ids) = 0))
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.accounts (id) on delete cascade,
  product_id text not null references public.products (id),
  variant_id text,
  type public.feedback_type not null,
  context_owned_id uuid,
  context_wishlist_id uuid,
  request_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  foreign key (variant_id, product_id) references public.variants (id, product_id),
  foreign key (context_owned_id, user_id) references public.owned_items (id, user_id) on delete set null (context_owned_id),
  foreign key (context_wishlist_id, user_id) references public.wishlist_items (id, user_id) on delete set null (context_wishlist_id),
  foreign key (request_id, user_id) references public.rec_requests (id, user_id) on delete set null (request_id),
  constraint feedback_context check (num_nonnulls(context_owned_id, context_wishlist_id) <= 1),
  constraint feedback_removed check (active = (removed_at is null))
);

-- A repeated call with the same key returns the first result (ARCHITECTURE.md section 5).
create table public.idempotency_keys (
  user_id uuid not null references public.accounts (id) on delete cascade,
  op text not null check (op ~ '^[a-zA-Z]{1,64}$'),
  key text not null check (key ~ '^[A-Za-z0-9_-]{8,128}$'),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  primary key (user_id, op, key),
  constraint idempotency_keys_size check (pg_column_size(result) <= 65536)
);

-- ============================================================================
-- 7. Clicks and conversions
-- ============================================================================

-- One outbound click through the disclosed redirect. There is no user id: analytics_id is
-- pseudonymous and its link to an account lives in private.account_analytics, which only
-- the service role reads. A click never marks anything purchased and never counts as revenue.
create table public.outbound_clicks (
  id uuid primary key default gen_random_uuid(),
  click_ref text not null unique check (click_ref ~ '^[A-Za-z0-9_-]{8,64}$'),
  analytics_id uuid not null,
  offer_id text references public.offers (id) on delete set null,
  retailer_id text not null references public.retailers (id),
  network_id text check (network_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  destination text not null check (destination ~ '^https://' and char_length(destination) <= 4096),
  tracked boolean not null,
  created_at timestamptz not null default now(),
  constraint outbound_clicks_network check (tracked or network_id is null)
);

-- Conversions as an affiliate network reports them, linked to clicks only by click_ref.
create table public.conversions (
  id uuid primary key default gen_random_uuid(),
  network text not null check (network ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  event_id text not null check (char_length(event_id) between 1 and 128),
  click_ref text check (click_ref ~ '^[A-Za-z0-9_-]{8,64}$'),
  status public.conversion_status not null,
  last_source public.conversion_source not null default 'network_report',
  order_amount_minor public.money_minor,
  commission_minor public.money_minor,
  currency public.currency_code not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_demo boolean not null default false,
  unique (network, event_id)
);

-- Every status a conversion has had, written by trigger (pending, approved, reversed, paid).
create table public.conversion_status_history (
  id bigint generated always as identity primary key,
  conversion_id uuid not null references public.conversions (id) on delete cascade,
  status public.conversion_status not null,
  source public.conversion_source not null,
  changed_at timestamptz not null default now()
);

-- ============================================================================
-- 8. Human stylist: assignments, scoped requests, recommendations
-- ============================================================================

create table public.stylist_assignments (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null references public.accounts (id) on delete cascade,
  assigned_by uuid references public.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint stylist_assignments_distinct check (stylist_id <> user_id),
  constraint stylist_assignments_dates check (ended_at is null or ended_at >= created_at)
);

-- What a person shares with an assigned stylist, and how. Revocation is final: a revoked
-- request can't be reopened, and stylist access ends at once.
create table public.stylist_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.accounts (id) on delete cascade,
  stylist_id uuid not null references public.accounts (id) on delete cascade,
  status public.stylist_request_status not null default 'open',
  revoked_at timestamptz,
  share_snapshot boolean not null default false,
  include_photos boolean not null default false,
  include_notes boolean not null default false,
  message text not null default '' check (char_length(message) <= 1000),
  budget_minor public.money_minor check (budget_minor > 0),
  budget_currency public.currency_code,
  category public.category,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint stylist_requests_revoked check ((status = 'revoked') = (revoked_at is not null)),
  constraint stylist_requests_budget check (num_nulls(budget_minor, budget_currency) in (0, 2)),
  constraint stylist_requests_distinct check (stylist_id <> user_id)
);

-- The items a request shares. The composite keys mean only the requester's own items can
-- be listed.
create table public.stylist_request_items (
  request_id uuid not null,
  owned_item_id uuid not null,
  user_id uuid not null,
  primary key (request_id, owned_item_id),
  foreign key (request_id, user_id) references public.stylist_requests (id, user_id) on delete cascade,
  foreign key (owned_item_id, user_id) references public.owned_items (id, user_id) on delete cascade
);

-- Redacted copies taken at share time when the person chose a snapshot (trigger in
-- section 10). The schema is an allowlist: purchase details, serial numbers, identity
-- evidence and raw photo ids can't be stored here, and notes or photo paths appear only
-- when the request shared them.
create table public.stylist_request_snapshots (
  request_id uuid not null,
  owned_item_id uuid not null,
  user_id uuid not null,
  redacted jsonb not null check (extensions.jsonb_matches_schema(
    '{"type":"object","additionalProperties":false,"required":["id","category","productId","variantId","custom","brandName","productName","variantName","code","details","ownerChanges","identity","shared","photoPaths"],"properties":{"id":{"type":"string","maxLength":64},"category":{"enum":["sneaker","watch","clothing"]},"productId":{"type":["string","null"],"maxLength":128},"variantId":{"type":["string","null"],"maxLength":128},"custom":{"type":["object","null"],"additionalProperties":false,"properties":{"brand":{"type":"string","maxLength":120},"name":{"type":"string","maxLength":120},"variantName":{"type":["string","null"],"maxLength":120},"type":{"type":["string","null"],"maxLength":40},"colors":{"type":"array","maxItems":4,"items":{"type":"string","maxLength":20}}}},"brandName":{"type":["string","null"],"maxLength":120},"productName":{"type":["string","null"],"maxLength":120},"variantName":{"type":["string","null"],"maxLength":120},"code":{"type":["string","null"],"maxLength":40},"details":{"type":"object","additionalProperties":false,"required":["size","condition","notes"],"properties":{"size":{"type":["object","null"],"additionalProperties":false,"required":["value","system"],"properties":{"value":{"type":"string","maxLength":16},"system":{"enum":["US-M","US-W","EU","UK","ALPHA","WAIST-INSEAM","ONE-SIZE"]}}},"condition":{"enum":["new","like_new","good","well_worn",null]},"notes":{"type":["string","null"],"maxLength":2000}}},"ownerChanges":{"type":"array","maxItems":5,"items":{"type":"object","additionalProperties":false,"required":["part","description"],"properties":{"part":{"enum":["strap","bracelet","other"]},"description":{"type":"string","maxLength":200},"widthMm":{"type":["number","null"],"minimum":8,"maximum":30}}}},"identity":{"type":"object","additionalProperties":false,"required":["resolution","variant"],"properties":{"resolution":{"enum":["unconfirmed","user_confirmed","identifier_supported","manual"]},"variant":{"enum":["confirmed","incomplete","conflicting","not_applicable"]}}},"shared":{"type":"object","additionalProperties":false,"required":["photos","notes"],"properties":{"photos":{"type":"boolean"},"notes":{"type":"boolean"}}},"photoPaths":{"type":["object","null"],"additionalProperties":false,"properties":{"original":{"type":["string","null"],"maxLength":512},"cleaned":{"type":["string","null"],"maxLength":512}}}}}',
    redacted)),
  created_at timestamptz not null default now(),
  primary key (request_id, owned_item_id),
  foreign key (request_id, owned_item_id) references public.stylist_request_items (request_id, owned_item_id) on delete cascade,
  foreign key (request_id, user_id) references public.stylist_requests (id, user_id) on delete cascade,
  constraint stylist_request_snapshots_notes check (
    (redacted #>> '{shared,notes}') = 'true' or jsonb_typeof(redacted #> '{details,notes}') = 'null'
  ),
  constraint stylist_request_snapshots_photos check (
    (redacted #>> '{shared,photos}') = 'true' or jsonb_typeof(redacted -> 'photoPaths') = 'null'
  )
);

-- A stylist's answer, labeled as human advice wherever it appears. Products must exist in
-- the catalog. client_key makes a retried submission return the first answer.
create table public.stylist_recs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid not null,
  stylist_id uuid references public.accounts (id) on delete set null,
  message text not null default '' check (char_length(message) <= 2000),
  client_key text check (client_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (stylist_id, client_key),
  foreign key (request_id, user_id) references public.stylist_requests (id, user_id) on delete cascade
);

create table public.stylist_rec_items (
  rec_id uuid not null,
  user_id uuid not null,
  position smallint not null check (position between 0 and 11),
  product_id text not null references public.products (id),
  variant_id text,
  note text not null default '' check (char_length(note) <= 500),
  primary key (rec_id, position),
  foreign key (rec_id, user_id) references public.stylist_recs (id, user_id) on delete cascade,
  foreign key (variant_id, product_id) references public.variants (id, product_id)
);

-- ============================================================================
-- 9. Operations: audit log, metrics, configuration
-- ============================================================================

-- Append-only (trigger in section 10). subject_user_id names the person an entry is about,
-- who can read it; entries about the catalog and operations have no subject and only admins
-- read them.
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  target_type text not null check (target_type ~ '^[a-z_]{1,40}$'),
  target_id text not null check (char_length(target_id) between 1 and 128),
  subject_user_id uuid references public.accounts (id) on delete cascade,
  meta jsonb not null default '{}' check (extensions.jsonb_matches_schema('{"type":"object","maxProperties":20}', meta))
);

-- Product metrics. No user ids and no free text: values are scalars of at most 32
-- characters, too short to hold a user id.
create table public.metric_events (
  id bigint generated always as identity primary key,
  type text not null check (type ~ '^[a-z_]{1,40}$'),
  at timestamptz not null default now(),
  data jsonb not null default '{}' check (extensions.jsonb_matches_schema(
    '{"type":"object","maxProperties":12,"propertyNames":{"pattern":"^[a-zA-Z_]{1,32}$"},"additionalProperties":{"type":["number","boolean","string","null"],"maxLength":32}}',
    data))
);

-- Admin settings: ranking weights, freshness window, match timeout, and provider
-- simulation (staging only). Each key's value is validated by its own schema.
create table public.app_config (
  key text primary key check (key in ('rankingWeights', 'providerSimulation', 'offerFreshnessHours', 'matchTimeoutMs')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.accounts (id) on delete set null,
  constraint app_config_value check (case key
    when 'rankingWeights' then extensions.jsonb_matches_schema('{"type":"object","minProperties":1,"maxProperties":40,"propertyNames":{"pattern":"^[a-zA-Z]{1,40}$"},"additionalProperties":{"type":"number","minimum":0,"maximum":10}}', value)
    when 'providerSimulation' then extensions.jsonb_matches_schema('{"type":"object","additionalProperties":false,"properties":{"vision":{"enum":["ok","timeout","error"]},"offers":{"enum":["ok","down"]},"ocr":{"enum":["ok","off"]}}}', value)
    when 'offerFreshnessHours' then extensions.jsonb_matches_schema('{"type":"integer","minimum":1,"maximum":168}', value)
    when 'matchTimeoutMs' then extensions.jsonb_matches_schema('{"type":"integer","minimum":1000,"maximum":60000}', value)
    else false end)
);

-- ============================================================================
-- 10. Triggers
-- ============================================================================

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger accounts_touch before update on public.accounts for each row execute function private.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger brands_touch before update on public.brands for each row execute function private.touch_updated_at();
create trigger products_touch before update on public.products for each row execute function private.touch_updated_at();
create trigger variants_touch before update on public.variants for each row execute function private.touch_updated_at();
create trigger catalog_images_touch before update on public.catalog_images for each row execute function private.touch_updated_at();
create trigger retailers_touch before update on public.retailers for each row execute function private.touch_updated_at();
create trigger affiliate_programs_touch before update on public.affiliate_programs for each row execute function private.touch_updated_at();
create trigger offers_touch before update on public.offers for each row execute function private.touch_updated_at();
create trigger match_jobs_touch before update on public.match_jobs for each row execute function private.touch_updated_at();
create trigger owned_items_touch before update on public.owned_items for each row execute function private.touch_updated_at();
create trigger wishlist_items_touch before update on public.wishlist_items for each row execute function private.touch_updated_at();
create trigger conversions_touch before update on public.conversions for each row execute function private.touch_updated_at();
create trigger stylist_requests_touch before update on public.stylist_requests for each row execute function private.touch_updated_at();
create trigger app_config_touch before update on public.app_config for each row execute function private.touch_updated_at();

-- Every new Auth user gets an account (role 'user'), a pseudonymous analytics id and an
-- empty profile.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.accounts (id, display_name)
  values (new.id, coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'display_name'), 60), ''), 'Member'));
  insert into private.account_analytics (user_id) values (new.id);
  insert into public.profiles (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

-- Identity rule: 'identifier_supported' needs an identifier from a label, a barcode or a
-- typed entry that matches the chosen version. Checked at commit, after the server has
-- written the evidence rows in the same transaction.
create function private.check_identifier_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolution public.identity_resolution;
begin
  if tg_table_name = 'owned_items' then
    select resolution into v_resolution from public.owned_items where id = new.id;
  else
    select resolution into v_resolution from public.wishlist_items where id = new.id;
  end if;
  if v_resolution is distinct from 'identifier_supported' then
    return null;
  end if;
  if not exists (
    select 1 from public.identity_evidence e
    where e.kind = 'identifier'
      and e.source in ('ocr', 'barcode', 'user_entered')
      and (case when tg_table_name = 'owned_items' then e.owned_item_id else e.wishlist_item_id end) = new.id
  ) then
    raise exception 'Item % is marked identifier-supported without identifier evidence', new.id using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger owned_items_identifier_evidence
  after insert or update of resolution on public.owned_items
  deferrable initially deferred
  for each row execute function private.check_identifier_evidence();

create constraint trigger wishlist_items_identifier_evidence
  after insert or update of resolution on public.wishlist_items
  deferrable initially deferred
  for each row execute function private.check_identifier_evidence();

-- Every product and version has the attribute row its category calls for. Checked at commit
-- so an import can insert parent and attribute rows in either order.
create function private.check_category_attributes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
  v_category public.category;
  v_ok boolean;
begin
  if tg_table_name in ('products', 'variants') then
    v_id := new.id;
  elsif tg_table_name in ('sneaker_products', 'watch_products', 'clothing_products') then
    v_id := old.product_id;
  else
    v_id := old.variant_id;
  end if;

  if tg_table_name in ('products', 'sneaker_products', 'watch_products', 'clothing_products') then
    select category into v_category from public.products where id = v_id;
    if not found then
      return null;
    end if;
    v_ok := case v_category
      when 'sneaker' then exists (select 1 from public.sneaker_products where product_id = v_id)
      when 'watch' then exists (select 1 from public.watch_products where product_id = v_id)
      when 'clothing' then exists (select 1 from public.clothing_products where product_id = v_id)
    end;
  else
    select category into v_category from public.variants where id = v_id;
    if not found then
      return null;
    end if;
    v_ok := case v_category
      when 'sneaker' then exists (select 1 from public.sneaker_variants where variant_id = v_id)
      when 'watch' then exists (select 1 from public.watch_variants where variant_id = v_id)
      when 'clothing' then exists (select 1 from public.clothing_variants where variant_id = v_id)
    end;
  end if;

  if not v_ok then
    raise exception '% has no % attribute row', v_id, v_category using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger products_attributes after insert or update of category on public.products
  deferrable initially deferred for each row execute function private.check_category_attributes();
create constraint trigger sneaker_products_attributes after delete on public.sneaker_products
  deferrable initially deferred for each row execute function private.check_category_attributes();
create constraint trigger watch_products_attributes after delete on public.watch_products
  deferrable initially deferred for each row execute function private.check_category_attributes();
create constraint trigger clothing_products_attributes after delete on public.clothing_products
  deferrable initially deferred for each row execute function private.check_category_attributes();
create constraint trigger variants_attributes after insert or update of category on public.variants
  deferrable initially deferred for each row execute function private.check_category_attributes();
create constraint trigger sneaker_variants_attributes after delete on public.sneaker_variants
  deferrable initially deferred for each row execute function private.check_category_attributes();
create constraint trigger watch_variants_attributes after delete on public.watch_variants
  deferrable initially deferred for each row execute function private.check_category_attributes();
create constraint trigger clothing_variants_attributes after delete on public.clothing_variants
  deferrable initially deferred for each row execute function private.check_category_attributes();

-- Assignments always join a stylist account to a user account.
create function private.check_assignment_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.accounts where id = new.stylist_id and role = 'stylist') then
    raise exception 'Assignments need a stylist account' using errcode = '23514';
  end if;
  if not exists (select 1 from public.accounts where id = new.user_id and role = 'user') then
    raise exception 'Stylists are assigned to user accounts' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger stylist_assignments_roles before insert or update of stylist_id, user_id on public.stylist_assignments
  for each row execute function private.check_assignment_roles();

create function private.forbid_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit entries are append-only' using errcode = '42501';
end;
$$;

create trigger audit_log_append_only before update on public.audit_log for each row execute function private.forbid_update();

create function private.record_conversion_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.conversion_status_history (conversion_id, status, source)
    values (new.id, new.status, new.last_source);
  end if;
  return null;
end;
$$;

create trigger conversions_status_history after insert or update of status on public.conversions
  for each row execute function private.record_conversion_status();

-- Retrieval only searches images we may still use: withdrawing or expiring an image, or
-- losing permission to index it, removes its embeddings, and no embedding can be added for
-- such an image.
create function private.drop_unusable_embeddings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' or not new.allow_retrieval_index then
    delete from public.catalog_image_embeddings where image_id = new.id;
  end if;
  return null;
end;
$$;

create trigger catalog_images_embeddings after update of status, allow_retrieval_index on public.catalog_images
  for each row execute function private.drop_unusable_embeddings();

create function private.check_embedding_allowed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.catalog_images i
    where i.id = new.image_id and i.status = 'active' and i.allow_retrieval_index
  ) then
    raise exception 'Image % may not be indexed for retrieval', new.image_id using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger catalog_image_embeddings_allowed before insert or update on public.catalog_image_embeddings
  for each row execute function private.check_embedding_allowed();

create function private.stamp_image_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger catalog_images_status_stamp before update of status on public.catalog_images
  for each row execute function private.stamp_image_status();

-- Marks cached images whose source cache period has ended. Schedule with pg_cron
-- (supabase/README.md). Returns how many images changed.
create function private.expire_catalog_images()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.catalog_images
  set status = 'expired', status_reason = 'Source cache period ended'
  where status = 'active' and expires_at is not null and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Audit entries for access changes and admin decisions. The stylist functions in section
-- 12 add their own entries for every read and answer.
create function private.audit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  case tg_table_name
    when 'stylist_requests' then
      if tg_op = 'INSERT' then
        insert into public.audit_log (actor_id, action, target_type, target_id, subject_user_id, meta)
        values (v_actor, 'stylist_request.created', 'stylist_request', new.id::text, new.user_id,
          jsonb_build_object('stylistId', new.stylist_id, 'snapshot', new.share_snapshot,
            'includePhotos', new.include_photos, 'includeNotes', new.include_notes));
      elsif new.status = 'revoked' and old.status <> 'revoked' then
        insert into public.audit_log (actor_id, action, target_type, target_id, subject_user_id, meta)
        values (v_actor, 'stylist_request.revoked', 'stylist_request', new.id::text, new.user_id,
          jsonb_build_object('stylistId', new.stylist_id));
      end if;
    when 'stylist_assignments' then
      if tg_op = 'INSERT' then
        insert into public.audit_log (actor_id, action, target_type, target_id, subject_user_id, meta)
        values (v_actor, 'stylist_assignment.created', 'stylist_assignment', new.id::text, new.user_id,
          jsonb_build_object('stylistId', new.stylist_id));
      elsif new.ended_at is not null and old.ended_at is null then
        insert into public.audit_log (actor_id, action, target_type, target_id, subject_user_id, meta)
        values (v_actor, 'stylist_assignment.ended', 'stylist_assignment', new.id::text, new.user_id,
          jsonb_build_object('stylistId', new.stylist_id));
      end if;
    when 'catalog_corrections' then
      if new.status is distinct from old.status then
        insert into public.audit_log (actor_id, action, target_type, target_id, meta)
        values (v_actor, 'catalog_correction.' || new.status::text, 'catalog_correction', new.id::text,
          jsonb_build_object('productId', new.product_id, 'field', new.field));
      end if;
    when 'catalog_images' then
      if new.status is distinct from old.status then
        insert into public.audit_log (actor_id, action, target_type, target_id, meta)
        values (v_actor, 'catalog_image.' || new.status::text, 'catalog_image', new.id,
          jsonb_build_object('variantId', new.variant_id, 'provider', new.provider));
      end if;
    when 'app_config' then
      insert into public.audit_log (actor_id, action, target_type, target_id, meta)
      values (v_actor, 'app_config.updated', 'app_config', new.key, '{}'::jsonb);
    else
      null;
  end case;
  return null;
end;
$$;

create trigger stylist_requests_audit after insert or update of status on public.stylist_requests
  for each row execute function private.audit_change();
create trigger stylist_assignments_audit after insert or update of ended_at on public.stylist_assignments
  for each row execute function private.audit_change();
create trigger catalog_corrections_audit after update of status on public.catalog_corrections
  for each row execute function private.audit_change();
create trigger catalog_images_audit after update of status on public.catalog_images
  for each row execute function private.audit_change();
create trigger app_config_audit after insert or update on public.app_config
  for each row execute function private.audit_change();

-- ============================================================================
-- 11. Access helpers (mirror js/server/policy.js)
-- ============================================================================

-- The role claim added by public.custom_access_token_hook (section 12).
create function private.claimed_role()
returns public.app_role
language sql
stable
set search_path = ''
as $$
  select case auth.jwt() ->> 'user_role'
    when 'user' then 'user'::public.app_role
    when 'stylist' then 'stylist'::public.app_role
    when 'admin' then 'admin'::public.app_role
  end
$$;

-- hasRole(). A claim alone isn't enough: the accounts row must agree, so a demotion takes
-- effect before the old token expires.
create function private.has_role(p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.claimed_role() = p_role, false)
    and exists (select 1 from public.accounts a where a.id = (select auth.uid()) and a.role = p_role)
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('admin')
$$;

create function private.is_stylist()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('stylist')
$$;

-- activeAssignment(): a live assignment between this stylist and this user.
create function private.has_live_assignment(p_stylist_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.stylist_assignments a
    where a.stylist_id = p_stylist_id and a.user_id = p_user_id and a.ended_at is null
  )
$$;

-- Accounts the caller may see by name: the other side of each live assignment.
create function private.assignment_counterparts()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.user_id from public.stylist_assignments a
  where a.stylist_id = (select auth.uid()) and a.ended_at is null
  union
  select a.stylist_id from public.stylist_assignments a
  where a.user_id = (select auth.uid()) and a.ended_at is null
$$;

-- stylistCanReadRequest(): sent to this stylist, not revoked, and the stylist is still assigned.
create function private.stylist_can_read_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_stylist() and exists (
    select 1 from public.stylist_requests r
    where r.id = p_request_id
      and r.stylist_id = (select auth.uid())
      and r.status <> 'revoked'
      and r.revoked_at is null
      and private.has_live_assignment(r.stylist_id, r.user_id)
  )
$$;

-- canAnswerRequest(): readable and not closed.
create function private.stylist_can_answer_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.stylist_can_read_request(p_request_id)
    and exists (select 1 from public.stylist_requests r where r.id = p_request_id and r.status <> 'closed')
$$;

-- redactForStylist(): an allowlisted copy of one owned item. A new private column stays
-- hidden unless it is added here on purpose. Runs with the caller's rights: owners can only
-- redact their own items, and stylists reach it only through the functions below.
create function private.redact_owned_item(p_item_id uuid, p_include_notes boolean, p_include_photos boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id,
    'category', i.category,
    'productId', i.product_id,
    'variantId', i.variant_id,
    'custom', case when i.product_id is null then jsonb_build_object(
      'brand', i.custom_brand,
      'name', i.custom_name,
      'variantName', i.custom_variant_name,
      'type', i.custom_type,
      'colors', to_jsonb(coalesce(i.custom_colors, '{}'::public.color_name[]))
    ) end,
    'brandName', coalesce(b.name, i.custom_brand),
    'productName', coalesce(p.name, i.custom_name),
    'variantName', coalesce(v.name, i.custom_variant_name),
    'code', coalesce(v.style_code, v.reference),
    'details', jsonb_build_object(
      'size', case when i.size_value is not null then jsonb_build_object('value', i.size_value, 'system', i.size_system) end,
      'condition', i.condition,
      'notes', case when p_include_notes then i.notes end
    ),
    'ownerChanges', coalesce((
      select jsonb_agg(jsonb_build_object('part', c.part, 'description', c.description, 'widthMm', c.width_mm) order by c.position)
      from public.owned_item_changes c
      where c.item_id = i.id
    ), '[]'::jsonb),
    'identity', jsonb_build_object('resolution', i.resolution, 'variant', i.variant_state),
    'shared', jsonb_build_object('photos', p_include_photos, 'notes', p_include_notes),
    'photoPaths', case when p_include_photos then jsonb_build_object(
      'original', (select ph.storage_path from public.photos ph where ph.id = i.photo_original_id),
      'cleaned', (select ph.storage_path from public.photos ph where ph.id = i.photo_cleaned_id)
    ) end
  )
  from public.owned_items i
  left join public.products p on p.id = i.product_id
  left join public.brands b on b.id = p.brand_id
  left join public.variants v on v.id = i.variant_id
  where i.id = p_item_id
$$;

-- Snapshot requests store a redacted copy of each item when it is shared.
create function private.snapshot_shared_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
begin
  select share_snapshot, include_notes, include_photos into v_request
  from public.stylist_requests where id = new.request_id;
  if v_request.share_snapshot then
    insert into public.stylist_request_snapshots (request_id, owned_item_id, user_id, redacted)
    values (new.request_id, new.owned_item_id, new.user_id,
      private.redact_owned_item(new.owned_item_id, v_request.include_notes, v_request.include_photos));
  end if;
  return null;
end;
$$;

create trigger stylist_request_items_snapshot after insert on public.stylist_request_items
  for each row execute function private.snapshot_shared_item();

-- getStylistRequest() for a stylist: the request, its shared items (redacted live, or the
-- stored snapshot) and the stylist's own answers. Returns null when the request isn't live
-- for this stylist, the same answer as for an id that doesn't exist, so ids can't be probed.
-- Every successful read is audited.
create function private.stylist_request_payload(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.stylist_requests%rowtype;
  v_name text;
  v_items jsonb;
  v_recs jsonb;
begin
  if not private.stylist_can_read_request(p_request_id) then
    return null;
  end if;
  select * into v_request from public.stylist_requests where id = p_request_id;
  select display_name into v_name from public.accounts where id = v_request.user_id;

  if v_request.share_snapshot then
    select coalesce(jsonb_agg(s.redacted order by s.created_at), '[]'::jsonb) into v_items
    from public.stylist_request_snapshots s
    where s.request_id = v_request.id;
  else
    select coalesce(jsonb_agg(private.redact_owned_item(ri.owned_item_id, v_request.include_notes, v_request.include_photos)), '[]'::jsonb)
    into v_items
    from public.stylist_request_items ri
    where ri.request_id = v_request.id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', sr.id,
    'message', sr.message,
    'createdAt', sr.created_at,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object('productId', sri.product_id, 'variantId', sri.variant_id, 'note', sri.note) order by sri.position), '[]'::jsonb)
      from public.stylist_rec_items sri
      where sri.rec_id = sr.id
    )
  ) order by sr.created_at), '[]'::jsonb)
  into v_recs
  from public.stylist_recs sr
  where sr.request_id = v_request.id and sr.stylist_id = (select auth.uid());

  insert into public.audit_log (actor_id, action, target_type, target_id, subject_user_id, meta)
  values ((select auth.uid()), 'stylist_request.viewed', 'stylist_request', v_request.id::text, v_request.user_id,
    jsonb_build_object('items', jsonb_array_length(v_items)));

  return jsonb_build_object(
    'request', jsonb_build_object(
      'id', v_request.id,
      'userId', v_request.user_id,
      'userDisplayName', v_name,
      'status', v_request.status,
      'createdAt', v_request.created_at,
      'updatedAt', v_request.updated_at,
      'message', v_request.message,
      'budgetMinor', v_request.budget_minor,
      'budgetCurrency', v_request.budget_currency,
      'category', v_request.category,
      'share', jsonb_build_object(
        'snapshot', v_request.share_snapshot,
        'includePhotos', v_request.include_photos,
        'includeNotes', v_request.include_notes
      )
    ),
    'items', v_items,
    'recs', v_recs
  );
end;
$$;

-- listStylistRequests() for a stylist: live requests addressed to them.
create function private.stylist_live_requests()
returns table (
  id uuid,
  user_id uuid,
  user_display_name text,
  status public.stylist_request_status,
  created_at timestamptz,
  message text,
  budget_minor public.money_minor,
  budget_currency public.currency_code,
  category public.category,
  share_snapshot boolean,
  include_photos boolean,
  include_notes boolean,
  item_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.user_id, a.display_name, r.status, r.created_at, r.message, r.budget_minor, r.budget_currency,
    r.category, r.share_snapshot, r.include_photos, r.include_notes,
    (select count(*)::integer from public.stylist_request_items ri where ri.request_id = r.id)
  from public.stylist_requests r
  join public.accounts a on a.id = r.user_id
  where private.is_stylist()
    and r.stylist_id = (select auth.uid())
    and r.status <> 'revoked'
    and r.revoked_at is null
    and private.has_live_assignment(r.stylist_id, r.user_id)
  order by r.created_at desc
$$;

-- submitStylistRecs(): only the stylist a live, unclosed request was sent to can answer,
-- and only with catalog products. Returns null when the request isn't answerable.
create function private.stylist_submit(p_request_id uuid, p_items jsonb, p_message text, p_client_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.stylist_requests%rowtype;
  v_rec_id uuid;
  v_item jsonb;
  v_position integer := 0;
begin
  if not private.stylist_can_answer_request(p_request_id) then
    return null;
  end if;
  if p_client_key is not null then
    select sr.id into v_rec_id from public.stylist_recs sr
    where sr.stylist_id = (select auth.uid()) and sr.client_key = p_client_key;
    if found then
      return v_rec_id;
    end if;
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 12 then
    raise exception 'Add between 1 and 12 recommendations.' using errcode = '22023';
  end if;

  select * into v_request from public.stylist_requests where id = p_request_id;
  insert into public.stylist_recs (request_id, user_id, stylist_id, message, client_key)
  values (v_request.id, v_request.user_id, (select auth.uid()), coalesce(left(p_message, 2000), ''), p_client_key)
  returning id into v_rec_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if not exists (select 1 from public.products where id = v_item ->> 'productId' and retired_at is null) then
      raise exception 'Recommend products that are in the catalog.' using errcode = '22023';
    end if;
    if nullif(v_item ->> 'variantId', '') is not null and not exists (
      select 1 from public.variants where id = v_item ->> 'variantId' and product_id = v_item ->> 'productId'
    ) then
      raise exception 'That version does not belong to this product.' using errcode = '22023';
    end if;
    insert into public.stylist_rec_items (rec_id, user_id, position, product_id, variant_id, note)
    values (v_rec_id, v_request.user_id, v_position, v_item ->> 'productId', nullif(v_item ->> 'variantId', ''),
      coalesce(left(v_item ->> 'note', 500), ''));
    v_position := v_position + 1;
  end loop;

  update public.stylist_requests set status = 'answered' where id = v_request.id and status = 'open';
  insert into public.audit_log (actor_id, action, target_type, target_id, subject_user_id, meta)
  values ((select auth.uid()), 'stylist_rec.submitted', 'stylist_request', v_request.id::text, v_request.user_id,
    jsonb_build_object('items', v_position));
  return v_rec_id;
end;
$$;

-- adminListJobs(): status only, with a salted hash in place of the user id. The salt is in
-- private.settings, so an admin can't recompute hashes from account ids.
create function private.admin_match_jobs(p_limit integer)
returns table (
  id uuid,
  user_hash text,
  status public.match_job_status,
  dest public.match_dest,
  category public.category,
  attempts smallint,
  retrieval public.retrieval_status,
  error_code text,
  latency_ms integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id,
    left(encode(sha256(convert_to((select s.value from private.settings s where s.name = 'job_hash_salt') || j.user_id::text, 'UTF8')), 'hex'), 10),
    j.status, j.dest, j.category, j.attempts, j.retrieval, j.error_code, j.latency_ms, j.created_at, j.updated_at
  from public.match_jobs j
  where private.is_admin()
  order by j.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

-- adminRetryJob(): requeues a job that ended in error or timeout, within the attempt limit.
create function private.admin_retry_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    return false;
  end if;
  update public.match_jobs
  set status = 'queued', error_code = null, error_message = null
  where id = p_job_id and status in ('error', 'timeout') and attempts < 3;
  if not found then
    return false;
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, meta)
  values ((select auth.uid()), 'match_job.retried', 'match_job', p_job_id::text, '{}'::jsonb);
  return true;
end;
$$;

-- ============================================================================
-- 12. Functions exposed over the Data API
-- ============================================================================
-- Thin security-invoker wrappers. The checks live in the private security-definer
-- functions above, so no security-definer function sits in an exposed schema.

create function public.stylist_get_request(p_request_id uuid)
returns jsonb
language sql
set search_path = ''
as $$
  select private.stylist_request_payload(p_request_id)
$$;

create function public.stylist_list_requests()
returns table (
  id uuid,
  user_id uuid,
  user_display_name text,
  status public.stylist_request_status,
  created_at timestamptz,
  message text,
  budget_minor public.money_minor,
  budget_currency public.currency_code,
  category public.category,
  share_snapshot boolean,
  include_photos boolean,
  include_notes boolean,
  item_count integer
)
language sql
stable
set search_path = ''
as $$
  select * from private.stylist_live_requests()
$$;

create function public.stylist_submit_recs(p_request_id uuid, p_items jsonb, p_message text, p_client_key text default null)
returns uuid
language sql
set search_path = ''
as $$
  select private.stylist_submit(p_request_id, p_items, p_message, p_client_key)
$$;

create function public.admin_list_match_jobs(p_limit integer default 100)
returns table (
  id uuid,
  user_hash text,
  status public.match_job_status,
  dest public.match_dest,
  category public.category,
  attempts smallint,
  retrieval public.retrieval_status,
  error_code text,
  latency_ms integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select * from private.admin_match_jobs(p_limit)
$$;

create function public.admin_retry_match_job(p_job_id uuid)
returns boolean
language sql
set search_path = ''
as $$
  select private.admin_retry_job(p_job_id)
$$;

-- Nearest catalog images for a query embedding from multimodalembedding@001 (1408
-- dimensions), within one category. Server-only: embeddings never reach the browser. One
-- statement per category, so each matches its partial index in section 14.
create function public.match_catalog_images_mm001(p_query extensions.vector, p_category public.category, p_limit integer default 20)
returns table (image_id text, variant_id text, distance double precision)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  if p_category = 'sneaker' then
    return query
      select e.image_id, e.variant_id, (e.embedding::extensions.vector(1408)) operator(extensions.<=>) (p_query::extensions.vector(1408))
      from public.catalog_image_embeddings e
      where e.model = 'multimodalembedding@001' and e.category = 'sneaker'
      order by (e.embedding::extensions.vector(1408)) operator(extensions.<=>) (p_query::extensions.vector(1408))
      limit v_limit;
  elsif p_category = 'watch' then
    return query
      select e.image_id, e.variant_id, (e.embedding::extensions.vector(1408)) operator(extensions.<=>) (p_query::extensions.vector(1408))
      from public.catalog_image_embeddings e
      where e.model = 'multimodalembedding@001' and e.category = 'watch'
      order by (e.embedding::extensions.vector(1408)) operator(extensions.<=>) (p_query::extensions.vector(1408))
      limit v_limit;
  else
    return query
      select e.image_id, e.variant_id, (e.embedding::extensions.vector(1408)) operator(extensions.<=>) (p_query::extensions.vector(1408))
      from public.catalog_image_embeddings e
      where e.model = 'multimodalembedding@001' and e.category = 'clothing'
      order by (e.embedding::extensions.vector(1408)) operator(extensions.<=>) (p_query::extensions.vector(1408))
      limit v_limit;
  end if;
end;
$$;

-- Supabase Auth hook: adds a user_role claim from accounts.role to each access token.
-- Enable it under Authentication > Hooks, or in config.toml (supabase/README.md).
create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  select a.role into v_role from public.accounts a where a.id = (event ->> 'user_id')::uuid;
  return jsonb_set(event, '{claims,user_role}', coalesce(to_jsonb(v_role), 'null'::jsonb));
end;
$$;

-- ============================================================================
-- 13. Row-level security, grants and policies
-- ============================================================================

alter table public.colors enable row level security;
alter table public.product_types enable row level security;
alter table public.accounts enable row level security;
alter table private.account_analytics enable row level security;
alter table private.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.catalog_imports enable row level security;
alter table public.catalog_import_rejections enable row level security;
alter table public.brands enable row level security;
alter table public.products enable row level security;
alter table public.sneaker_products enable row level security;
alter table public.watch_products enable row level security;
alter table public.clothing_products enable row level security;
alter table public.variants enable row level security;
alter table public.sneaker_variants enable row level security;
alter table public.watch_variants enable row level security;
alter table public.clothing_variants enable row level security;
alter table public.variant_gtins enable row level security;
alter table public.variant_colors enable row level security;
alter table public.product_sources enable row level security;
alter table public.variant_sources enable row level security;
alter table public.catalog_images enable row level security;
alter table public.catalog_image_embeddings enable row level security;
alter table public.retailers enable row level security;
alter table public.affiliate_programs enable row level security;
alter table public.offers enable row level security;
alter table public.offer_sizes enable row level security;
alter table public.catalog_corrections enable row level security;
alter table public.photos enable row level security;
alter table public.match_jobs enable row level security;
alter table public.match_job_texts enable row level security;
alter table public.match_job_label_photos enable row level security;
alter table public.match_candidates enable row level security;
alter table public.match_candidate_variant_options enable row level security;
alter table public.match_candidate_evidence enable row level security;
alter table public.match_candidate_conflicts enable row level security;
alter table public.match_job_asks enable row level security;
alter table public.owned_items enable row level security;
alter table public.owned_item_label_photos enable row level security;
alter table public.owned_item_changes enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.wishlist_links enable row level security;
alter table public.identity_evidence enable row level security;
alter table public.identity_conflicts enable row level security;
alter table public.rec_requests enable row level security;
alter table public.feedback enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.outbound_clicks enable row level security;
alter table public.conversions enable row level security;
alter table public.conversion_status_history enable row level security;
alter table public.stylist_assignments enable row level security;
alter table public.stylist_requests enable row level security;
alter table public.stylist_request_items enable row level security;
alter table public.stylist_request_snapshots enable row level security;
alter table public.stylist_recs enable row level security;
alter table public.stylist_rec_items enable row level security;
alter table public.audit_log enable row level security;
alter table public.metric_events enable row level security;
alter table public.app_config enable row level security;

-- Client roles start with nothing; each table gets back only what its policies use. New
-- tables in later migrations need the same treatment, because Supabase's default
-- privileges grant them to anon and authenticated.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;
grant select on private.account_analytics to service_role;

-- Functions: the private ones run only where a policy or a wrapper needs them.
revoke all on all functions in schema private from public;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_stylist() to authenticated;
grant execute on function private.has_live_assignment(uuid, uuid) to authenticated;
grant execute on function private.assignment_counterparts() to authenticated;
grant execute on function private.stylist_request_payload(uuid) to authenticated;
grant execute on function private.stylist_live_requests() to authenticated;
grant execute on function private.stylist_submit(uuid, jsonb, text, text) to authenticated;
grant execute on function private.admin_match_jobs(integer) to authenticated;
grant execute on function private.admin_retry_job(uuid) to authenticated;
grant execute on function private.expire_catalog_images() to service_role;

revoke execute on function public.stylist_get_request(uuid) from public, anon;
revoke execute on function public.stylist_list_requests() from public, anon;
revoke execute on function public.stylist_submit_recs(uuid, jsonb, text, text) from public, anon;
revoke execute on function public.admin_list_match_jobs(integer) from public, anon;
revoke execute on function public.admin_retry_match_job(uuid) from public, anon;
grant execute on function public.stylist_get_request(uuid) to authenticated;
grant execute on function public.stylist_list_requests() to authenticated;
grant execute on function public.stylist_submit_recs(uuid, jsonb, text, text) to authenticated;
grant execute on function public.admin_list_match_jobs(integer) to authenticated;
grant execute on function public.admin_retry_match_job(uuid) to authenticated;

revoke execute on function public.match_catalog_images_mm001(extensions.vector, public.category, integer) from public, anon, authenticated;
grant execute on function public.match_catalog_images_mm001(extensions.vector, public.category, integer) to service_role;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select (id, role) on public.accounts to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Catalog: every signed-in account reads it; admins manage it.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on
  public.colors, public.product_types, public.brands, public.products, public.sneaker_products,
  public.watch_products, public.clothing_products, public.variants, public.sneaker_variants,
  public.watch_variants, public.clothing_variants, public.variant_gtins, public.variant_colors,
  public.product_sources, public.variant_sources, public.catalog_images, public.retailers,
  public.offers, public.offer_sizes
to authenticated;

create policy "Signed-in accounts read colors" on public.colors for select to authenticated using (true);
create policy "Admins manage colors" on public.colors for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read product types" on public.product_types for select to authenticated using (true);
create policy "Admins manage product types" on public.product_types for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read brands" on public.brands for select to authenticated using (true);
create policy "Admins manage brands" on public.brands for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read products" on public.products for select to authenticated using (true);
create policy "Admins manage products" on public.products for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read sneaker facts" on public.sneaker_products for select to authenticated using (true);
create policy "Admins manage sneaker facts" on public.sneaker_products for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read watch facts" on public.watch_products for select to authenticated using (true);
create policy "Admins manage watch facts" on public.watch_products for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read clothing facts" on public.clothing_products for select to authenticated using (true);
create policy "Admins manage clothing facts" on public.clothing_products for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read versions" on public.variants for select to authenticated using (true);
create policy "Admins manage versions" on public.variants for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read sneaker version facts" on public.sneaker_variants for select to authenticated using (true);
create policy "Admins manage sneaker version facts" on public.sneaker_variants for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read watch version facts" on public.watch_variants for select to authenticated using (true);
create policy "Admins manage watch version facts" on public.watch_variants for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read clothing version facts" on public.clothing_variants for select to authenticated using (true);
create policy "Admins manage clothing version facts" on public.clothing_variants for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read GTINs" on public.variant_gtins for select to authenticated using (true);
create policy "Admins manage GTINs" on public.variant_gtins for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read version colors" on public.variant_colors for select to authenticated using (true);
create policy "Admins manage version colors" on public.variant_colors for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read product sources" on public.product_sources for select to authenticated using (true);
create policy "Admins manage product sources" on public.product_sources for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read version sources" on public.variant_sources for select to authenticated using (true);
create policy "Admins manage version sources" on public.variant_sources for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Withdrawn and expired images stay visible to admins only.
create policy "Signed-in accounts read active catalog images" on public.catalog_images for select to authenticated
  using (status = 'active');
create policy "Admins manage catalog images" on public.catalog_images for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read retailers" on public.retailers for select to authenticated using (true);
create policy "Admins manage retailers" on public.retailers for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read offers" on public.offers for select to authenticated using (true);
create policy "Admins manage offers" on public.offers for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Signed-in accounts read offer sizes" on public.offer_sizes for select to authenticated using (true);
create policy "Admins manage offer sizes" on public.offer_sizes for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Admin-only catalog operations. Embeddings and affiliate terms are written by the server.
grant select on public.catalog_image_embeddings to authenticated;
create policy "Admins read embeddings" on public.catalog_image_embeddings for select to authenticated
  using ((select private.is_admin()));

grant select, insert, update, delete on public.affiliate_programs to authenticated;
create policy "Admins manage affiliate programs" on public.affiliate_programs for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

grant select, insert, update on public.catalog_imports to authenticated;
create policy "Admins manage catalog imports" on public.catalog_imports for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

grant select, insert on public.catalog_import_rejections to authenticated;
create policy "Admins manage import rejections" on public.catalog_import_rejections for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Corrections: people propose, admins decide. Nobody edits a shared fact directly.
grant select, insert on public.catalog_corrections to authenticated;
grant update (status, reviewed_by, reviewed_at) on public.catalog_corrections to authenticated;
create policy "People read corrections they reported" on public.catalog_corrections for select to authenticated
  using (user_id = (select auth.uid()));
create policy "People report catalog issues" on public.catalog_corrections for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'open' and reviewed_by is null and reviewed_at is null);
create policy "Admins read corrections" on public.catalog_corrections for select to authenticated
  using ((select private.is_admin()));
create policy "Admins resolve corrections" on public.catalog_corrections for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()) and reviewed_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Accounts and profiles
-- ---------------------------------------------------------------------------

grant select on public.accounts to authenticated;
grant update (display_name) on public.accounts to authenticated;
create policy "People read their own account" on public.accounts for select to authenticated
  using (id = (select auth.uid()));
-- Names only cross a live assignment (listMyStylists, the stylist's client list).
create policy "People see names across a live assignment" on public.accounts for select to authenticated
  using (id in (select private.assignment_counterparts()));
-- Accounts hold id, name and role only (redactAccountForAdmin); email stays in auth.users.
create policy "Admins list accounts" on public.accounts for select to authenticated
  using ((select private.is_admin()));
create policy "People rename themselves" on public.accounts for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Auth hook reads roles" on public.accounts for select to supabase_auth_admin using (true);

grant select, insert, update on public.profiles to authenticated;
create policy "Owners read their profile" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners create their profile" on public.profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Owners update their profile" on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Private user data: owners only. No stylist or admin policy on any of these tables.
-- ---------------------------------------------------------------------------

-- Photos are registered by the server after normalization; owners read them. Deleting a
-- photo goes through the server, which removes the file with the Storage API first.
grant select on public.photos to authenticated;
create policy "Owners read their photos" on public.photos for select to authenticated
  using (user_id = (select auth.uid()));

-- Match jobs and their results are written by the matching worker.
grant select on
  public.match_jobs, public.match_job_texts, public.match_job_label_photos, public.match_candidates,
  public.match_candidate_variant_options, public.match_candidate_evidence, public.match_candidate_conflicts,
  public.match_job_asks
to authenticated;
create policy "Owners read their match jobs" on public.match_jobs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read their match texts" on public.match_job_texts for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read their label photo links" on public.match_job_label_photos for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read their candidates" on public.match_candidates for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read their variant options" on public.match_candidate_variant_options for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read their candidate evidence" on public.match_candidate_evidence for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read their candidate conflicts" on public.match_candidate_conflicts for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read what the matcher asked for" on public.match_job_asks for select to authenticated
  using (user_id = (select auth.uid()));

-- Owned items. Clients may add items they confirmed from catalog search or entered by hand,
-- and edit private details. Identity columns are not in the update grant: identity that rests
-- on matching or identifiers is written by the server.
grant select, insert, delete on public.owned_items to authenticated;
grant update (
  custom_brand, custom_name, custom_variant_name, custom_type, custom_colors,
  size_value, size_system, size_width, condition, purchase_price_minor, purchase_currency,
  purchase_date, purchase_from, notes, serial_number, photo_cleaned_id, display, archived_at
) on public.owned_items to authenticated;
create policy "Owners read their items" on public.owned_items for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners add confirmed or custom items" on public.owned_items for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and retrieval = 'not_run'
    and resolution in ('manual', 'user_confirmed')
    and match_job_id is null
  );
create policy "Owners update their items" on public.owned_items for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Owners delete their items" on public.owned_items for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.owned_item_label_photos to authenticated;
create policy "Owners read their item label photos" on public.owned_item_label_photos for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners link label photos" on public.owned_item_label_photos for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Owners unlink label photos" on public.owned_item_label_photos for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.owned_item_changes to authenticated;
create policy "Owners read their owner changes" on public.owned_item_changes for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners add owner changes" on public.owned_item_changes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Owners edit owner changes" on public.owned_item_changes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Owners remove owner changes" on public.owned_item_changes for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.wishlist_items to authenticated;
grant update (
  status, custom_brand, custom_name, custom_variant_name, custom_type, custom_colors,
  reason, reason_note, intent, desired_size_value, desired_size_system, desired_condition,
  variant_flexible, target_price_minor, target_currency, purchased_owned_id
) on public.wishlist_items to authenticated;
create policy "Owners read their wishlist" on public.wishlist_items for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners add confirmed or custom wishes" on public.wishlist_items for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'active'
    and purchased_owned_id is null
    and retrieval = 'not_run'
    and resolution in ('manual', 'user_confirmed')
    and match_job_id is null
  );
create policy "Owners update their wishlist" on public.wishlist_items for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Owners delete wishes" on public.wishlist_items for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.wishlist_links to authenticated;
create policy "Owners read their wishlist links" on public.wishlist_links for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners link wishes to items" on public.wishlist_links for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Owners unlink wishes" on public.wishlist_links for delete to authenticated
  using (user_id = (select auth.uid()));

-- Evidence and conflicts are written by the server; owners read them.
grant select on public.identity_evidence, public.identity_conflicts to authenticated;
create policy "Owners read their identity evidence" on public.identity_evidence for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read their identity conflicts" on public.identity_conflicts for select to authenticated
  using (user_id = (select auth.uid()));

grant select, insert on public.rec_requests to authenticated;
create policy "Owners read their recommendation requests" on public.rec_requests for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners record recommendation requests" on public.rec_requests for insert to authenticated
  with check (user_id = (select auth.uid()));

grant select, insert, delete on public.feedback to authenticated;
grant update (active, removed_at) on public.feedback to authenticated;
create policy "Owners read their feedback" on public.feedback for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners give feedback" on public.feedback for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Owners withdraw feedback" on public.feedback for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Owners delete feedback" on public.feedback for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert on public.idempotency_keys to authenticated;
create policy "Owners read their idempotency keys" on public.idempotency_keys for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners store idempotency keys" on public.idempotency_keys for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Clicks, conversions, metrics and configuration: admins read; the server writes.
-- ---------------------------------------------------------------------------

grant select on public.outbound_clicks, public.conversions, public.conversion_status_history, public.metric_events to authenticated;
create policy "Admins read clicks" on public.outbound_clicks for select to authenticated
  using ((select private.is_admin()));
create policy "Admins read conversions" on public.conversions for select to authenticated
  using ((select private.is_admin()));
create policy "Admins read conversion history" on public.conversion_status_history for select to authenticated
  using ((select private.is_admin()));
create policy "Admins read metrics" on public.metric_events for select to authenticated
  using ((select private.is_admin()));

grant select, insert, update on public.app_config to authenticated;
create policy "Admins manage configuration" on public.app_config for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Stylist workflow
-- ---------------------------------------------------------------------------

grant select, insert on public.stylist_assignments to authenticated;
grant update (ended_at) on public.stylist_assignments to authenticated;
create policy "People read their own assignments" on public.stylist_assignments for select to authenticated
  using (user_id = (select auth.uid()) or stylist_id = (select auth.uid()));
create policy "Admins read assignments" on public.stylist_assignments for select to authenticated
  using ((select private.is_admin()));
create policy "Admins assign stylists" on public.stylist_assignments for insert to authenticated
  with check ((select private.is_admin()) and assigned_by = (select auth.uid()) and ended_at is null);
create policy "Admins end assignments" on public.stylist_assignments for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- People share with a stylist assigned to them, and can close or revoke. Stylists have no
-- policy here: they use public.stylist_list_requests and public.stylist_get_request.
grant select, insert, delete on public.stylist_requests to authenticated;
grant update (status, revoked_at) on public.stylist_requests to authenticated;
create policy "Owners read their stylist requests" on public.stylist_requests for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners share with an assigned stylist" on public.stylist_requests for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'open'
    and revoked_at is null
    and private.has_live_assignment(stylist_id, user_id)
  );
-- A revoked request stays revoked; owners can only move a request to closed or revoked.
create policy "Owners close or revoke requests" on public.stylist_requests for update to authenticated
  using (user_id = (select auth.uid()) and status <> 'revoked')
  with check (user_id = (select auth.uid()) and status in ('closed', 'revoked'));
create policy "Owners delete their stylist requests" on public.stylist_requests for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.stylist_request_items to authenticated;
create policy "Owners read what they shared" on public.stylist_request_items for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners share items on a live request" on public.stylist_request_items for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.stylist_requests r
      where r.id = request_id and r.user_id = (select auth.uid()) and r.status in ('open', 'answered')
    )
  );
create policy "Owners unshare items" on public.stylist_request_items for delete to authenticated
  using (user_id = (select auth.uid()));

-- Snapshots are written by trigger at share time; owners can read what was copied.
grant select on public.stylist_request_snapshots to authenticated;
create policy "Owners read their snapshots" on public.stylist_request_snapshots for select to authenticated
  using (user_id = (select auth.uid()));

-- Stylist answers are written through public.stylist_submit_recs; recipients read them.
grant select on public.stylist_recs, public.stylist_rec_items to authenticated;
create policy "Recipients read stylist answers" on public.stylist_recs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Recipients read stylist picks" on public.stylist_rec_items for select to authenticated
  using (user_id = (select auth.uid()));

-- People read entries about their own data; admins read catalog and operations entries.
-- Nobody writes here directly.
grant select on public.audit_log to authenticated;
create policy "People read audit entries about them" on public.audit_log for select to authenticated
  using (subject_user_id = (select auth.uid()));
create policy "Admins read operations audit" on public.audit_log for select to authenticated
  using (subject_user_id is null and (select private.is_admin()));

-- ============================================================================
-- 14. Indexes
-- ============================================================================
-- Every foreign key has an index led by its first column, and the common reads have one.

create index brands_name_idx on public.brands (lower(name));
create index products_brand_idx on public.products (brand_id);
create index products_category_type_idx on public.products (category, type);
create index variants_product_idx on public.variants (product_id);
create index variants_style_code_idx on public.variants (lower(style_code)) where style_code is not null;
create index variants_reference_idx on public.variants (lower(reference)) where reference is not null;
create index variant_gtins_variant_idx on public.variant_gtins (variant_id);
create index variant_colors_color_idx on public.variant_colors (color);
create index product_sources_product_idx on public.product_sources (product_id);
create index product_sources_import_idx on public.product_sources (import_id);
create index variant_sources_variant_idx on public.variant_sources (variant_id);
create index variant_sources_import_idx on public.variant_sources (import_id);
create index catalog_imports_created_by_idx on public.catalog_imports (created_by);
create index catalog_import_rejections_import_idx on public.catalog_import_rejections (import_id);
create index catalog_images_variant_idx on public.catalog_images (variant_id);
create index catalog_images_expiry_idx on public.catalog_images (expires_at) where status = 'active' and expires_at is not null;
create index catalog_image_embeddings_variant_idx on public.catalog_image_embeddings (variant_id);
create index offers_variant_idx on public.offers (variant_id, listing_status);
create unique index offers_source_idx on public.offers (source_provider, source_offer_id) where source_offer_id is not null;
create index offers_last_checked_idx on public.offers (last_checked_at);
create index catalog_corrections_status_idx on public.catalog_corrections (status, created_at);
create index catalog_corrections_user_idx on public.catalog_corrections (user_id);
create index catalog_corrections_product_idx on public.catalog_corrections (product_id);
create index catalog_corrections_variant_idx on public.catalog_corrections (variant_id);
create index catalog_corrections_reviewed_by_idx on public.catalog_corrections (reviewed_by);

-- Exact nearest-neighbor search per category for the default embedding model. To add a
-- model, add its partial indexes and a match function; models above 2,000 dimensions need
-- halfvec (up to 4,000).
create index catalog_image_embeddings_mm001_sneaker_idx on public.catalog_image_embeddings
  using hnsw ((embedding::extensions.vector(1408)) extensions.vector_cosine_ops)
  where model = 'multimodalembedding@001' and category = 'sneaker';
create index catalog_image_embeddings_mm001_watch_idx on public.catalog_image_embeddings
  using hnsw ((embedding::extensions.vector(1408)) extensions.vector_cosine_ops)
  where model = 'multimodalembedding@001' and category = 'watch';
create index catalog_image_embeddings_mm001_clothing_idx on public.catalog_image_embeddings
  using hnsw ((embedding::extensions.vector(1408)) extensions.vector_cosine_ops)
  where model = 'multimodalembedding@001' and category = 'clothing';

create index photos_user_idx on public.photos (user_id, created_at desc);
create index photos_source_idx on public.photos (source_photo_id);
create index match_jobs_user_idx on public.match_jobs (user_id, created_at desc);
create index match_jobs_status_idx on public.match_jobs (status, updated_at) where status in ('queued', 'processing');
create index match_jobs_photo_idx on public.match_jobs (photo_id);
create index match_jobs_confirmed_owned_idx on public.match_jobs (confirmed_owned_id);
create index match_jobs_confirmed_wishlist_idx on public.match_jobs (confirmed_wishlist_id);
create index match_job_texts_job_idx on public.match_job_texts (job_id);
create index match_job_label_photos_photo_idx on public.match_job_label_photos (photo_id);
create index match_candidates_product_idx on public.match_candidates (product_id);
create index match_candidates_variant_idx on public.match_candidates (variant_id);
create index match_candidate_variant_options_variant_idx on public.match_candidate_variant_options (variant_id);
create index match_candidate_evidence_candidate_idx on public.match_candidate_evidence (candidate_id);
create index match_candidate_conflicts_candidate_idx on public.match_candidate_conflicts (candidate_id);
create index owned_items_user_idx on public.owned_items (user_id, archived_at, created_at desc);
create index owned_items_product_idx on public.owned_items (product_id, category);
create index owned_items_variant_idx on public.owned_items (variant_id);
create index owned_items_match_job_idx on public.owned_items (match_job_id);
create index owned_items_photo_original_idx on public.owned_items (photo_original_id);
create index owned_items_photo_cleaned_idx on public.owned_items (photo_cleaned_id);
create index owned_item_label_photos_photo_idx on public.owned_item_label_photos (photo_id);
create index wishlist_items_user_idx on public.wishlist_items (user_id, status, created_at desc);
create unique index wishlist_items_active_variant_idx on public.wishlist_items (user_id, variant_id)
  where status = 'active' and variant_id is not null;
create index wishlist_items_product_idx on public.wishlist_items (product_id, category);
create index wishlist_items_variant_idx on public.wishlist_items (variant_id);
create index wishlist_items_match_job_idx on public.wishlist_items (match_job_id);
create index wishlist_items_photo_idx on public.wishlist_items (photo_original_id);
create index wishlist_items_purchased_idx on public.wishlist_items (purchased_owned_id);
create index wishlist_links_owned_idx on public.wishlist_links (owned_item_id);
create index identity_evidence_owned_idx on public.identity_evidence (owned_item_id);
create index identity_evidence_wishlist_idx on public.identity_evidence (wishlist_item_id);
create index identity_conflicts_owned_idx on public.identity_conflicts (owned_item_id);
create index identity_conflicts_wishlist_idx on public.identity_conflicts (wishlist_item_id);
create index rec_requests_user_idx on public.rec_requests (user_id, created_at desc);
create index feedback_user_idx on public.feedback (user_id, active);
create index feedback_product_idx on public.feedback (product_id);
create index feedback_variant_idx on public.feedback (variant_id);
create index feedback_context_owned_idx on public.feedback (context_owned_id);
create index feedback_context_wishlist_idx on public.feedback (context_wishlist_id);
create index feedback_request_idx on public.feedback (request_id);
create index idempotency_keys_expiry_idx on public.idempotency_keys (expires_at);
create index outbound_clicks_analytics_idx on public.outbound_clicks (analytics_id);
create index outbound_clicks_offer_idx on public.outbound_clicks (offer_id);
create index outbound_clicks_retailer_idx on public.outbound_clicks (retailer_id, created_at desc);
create index conversions_click_ref_idx on public.conversions (click_ref);
create index conversion_status_history_conversion_idx on public.conversion_status_history (conversion_id, changed_at);
create index stylist_assignments_stylist_idx on public.stylist_assignments (stylist_id);
create index stylist_assignments_user_idx on public.stylist_assignments (user_id);
create index stylist_assignments_assigned_by_idx on public.stylist_assignments (assigned_by);
create unique index stylist_assignments_live_idx on public.stylist_assignments (stylist_id, user_id) where ended_at is null;
create index stylist_requests_user_idx on public.stylist_requests (user_id, created_at desc);
create index stylist_requests_stylist_idx on public.stylist_requests (stylist_id, status);
create index stylist_request_items_owned_idx on public.stylist_request_items (owned_item_id);
create index stylist_recs_request_idx on public.stylist_recs (request_id);
create index stylist_rec_items_product_idx on public.stylist_rec_items (product_id);
create index stylist_rec_items_variant_idx on public.stylist_rec_items (variant_id);
create index audit_log_subject_idx on public.audit_log (subject_user_id, at desc);
create index audit_log_target_idx on public.audit_log (target_type, target_id);
create index metric_events_type_idx on public.metric_events (type, at);
create index app_config_updated_by_idx on public.app_config (updated_by);
