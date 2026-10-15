-- Rotation: Storage buckets and access policies. Runs after 0001_init.sql, whose helper
-- functions (private.is_admin, private.is_stylist, private.stylist_can_read_request) it uses.
--
-- Buckets:
-- - user-photos (private): the person's own photos, under <user id>/... . Owners read,
--   upload and delete their own folder. A stylist reads a photo only while a live request
--   shares the item and its photos, and the stylist is still assigned.
-- - catalog-assets (public): catalog images we may show unconditionally (owned or licensed,
--   allowed in collections, not tied to a live offer; see the catalog_images_public_bucket
--   check in 0001_init.sql). Files in a public bucket are served to anyone with the URL.
-- - catalog-restricted (private): cached feed images whose terms limit where or how long
--   they may be shown. No client reads them directly; the server signs a short URL after
--   the display check passes, and deletes the file when its cache period ends.
--
-- Signed URLs: the server serves private files through signed URLs with a short expiry
-- (60 to 300 seconds, re-signed each time a screen renders). Supabase signed URLs stay
-- valid until they expire, whatever happens to the session or keys, and can't be revoked
-- self-serve. So revoking a stylist share takes effect at once for new reads and within
-- that window for a link already handed out. Never sign long-lived URLs for user photos.
--
-- Deleting: remove files through the Storage API, never with SQL on storage.objects (that
-- leaves the file orphaned in the bucket). Account deletion removes the user's folder
-- through the API before deleting the auth user.

-- ============================================================================
-- 1. Buckets
-- ============================================================================

-- 15 MB matches the upload limit in js/server/ops/photos.js. HEIC is accepted on upload and
-- converted by the server; the stored copies are JPEG, PNG or WebP.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('user-photos', 'user-photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  ('catalog-assets', 'catalog-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('catalog-restricted', 'catalog-restricted', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================================
-- 2. Stylist access to shared photos
-- ============================================================================

-- stylistCanReadPhoto(): the object is the original or cleaned photo of an item that a live
-- request shared with photos included. Label and processing photos are never shared.
create function private.stylist_can_read_photo_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_stylist() and exists (
    select 1
    from public.photos ph
    join public.owned_items i
      on i.user_id = ph.user_id and ph.id in (i.photo_original_id, i.photo_cleaned_id)
    join public.stylist_request_items ri on ri.owned_item_id = i.id
    join public.stylist_requests r on r.id = ri.request_id
    where ph.storage_path = p_name
      and ph.kind in ('original', 'cleaned')
      and r.include_photos
      and private.stylist_can_read_request(r.id)
  )
$$;

revoke all on function private.stylist_can_read_photo_object(text) from public;
grant execute on function private.stylist_can_read_photo_object(text) to authenticated;

-- ============================================================================
-- 3. Policies on storage.objects
-- ============================================================================

-- Owners: their own folder only. There is no update policy: photos are immutable, and a
-- replacement is a new file at a new path.
create policy "Owners read their photo files" on storage.objects for select to authenticated
  using (bucket_id = 'user-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "Owners upload to their photo folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'user-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "Owners delete their photo files" on storage.objects for delete to authenticated
  using (bucket_id = 'user-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- Stylists: read-only, per object, only through a live grant.
create policy "Stylists read photos shared with them" on storage.objects for select to authenticated
  using (bucket_id = 'user-photos' and (select private.is_stylist()) and private.stylist_can_read_photo_object(name));

-- Catalog files: admins upload and replace them. Reads of catalog-assets go through its
-- public URL; catalog-restricted is read only by the server with the service role.
create policy "Admins read catalog files" on storage.objects for select to authenticated
  using (bucket_id in ('catalog-assets', 'catalog-restricted') and (select private.is_admin()));

create policy "Admins upload catalog files" on storage.objects for insert to authenticated
  with check (bucket_id in ('catalog-assets', 'catalog-restricted') and (select private.is_admin()));

create policy "Admins replace catalog files" on storage.objects for update to authenticated
  using (bucket_id in ('catalog-assets', 'catalog-restricted') and (select private.is_admin()))
  with check (bucket_id in ('catalog-assets', 'catalog-restricted') and (select private.is_admin()));

create policy "Admins delete catalog files" on storage.objects for delete to authenticated
  using (bucket_id in ('catalog-assets', 'catalog-restricted') and (select private.is_admin()));
