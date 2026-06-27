-- OAuth (GitHub, X) + guest_key para invitados persistentes

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'guest';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS oauth_subject VARCHAR(128);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS guest_key VARCHAR(64);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_oauth
  ON profiles (auth_provider, oauth_subject)
  WHERE oauth_subject IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_guest_key
  ON profiles (guest_key)
  WHERE guest_key IS NOT NULL;
