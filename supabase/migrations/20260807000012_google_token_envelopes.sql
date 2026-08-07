-- Give each independently encrypted Google token its own AES-GCM envelope.
--
-- Access and refresh tokens are encrypted in separate operations. Reusing the
-- access token's IV/authentication tag for the refresh-token ciphertext makes
-- that ciphertext impossible to authenticate and decrypt. Existing refresh
-- ciphertexts therefore require one reconnect; all new grants are durable.

alter table public.connected_accounts
  add column if not exists refresh_token_initialisation_vector bytea,
  add column if not exists refresh_token_authentication_tag bytea;

comment on column public.connected_accounts.refresh_token_initialisation_vector is
  'AES-GCM IV for encrypted_refresh_token. Unique to that encryption operation.';

comment on column public.connected_accounts.refresh_token_authentication_tag is
  'AES-GCM authentication tag for encrypted_refresh_token.';

create or replace function private.protect_refresh_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.encrypted_refresh_token is not null
     and new.encrypted_refresh_token is null then
    raise exception
      'Refusing to erase a valid Google refresh token (account %).', old.id
      using errcode = 'P0001';
  end if;

  if old.refresh_token_initialisation_vector is not null
     and new.refresh_token_initialisation_vector is null then
    raise exception
      'Refusing to erase the Google refresh-token IV (account %).', old.id
      using errcode = 'P0001';
  end if;

  if old.refresh_token_authentication_tag is not null
     and new.refresh_token_authentication_tag is null then
    raise exception
      'Refusing to erase the Google refresh-token authentication tag (account %).', old.id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
