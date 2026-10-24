-- Whether a person may be signed in on one device at a time at this store
-- (owner, 24 Oct 2026: "one user one device per store ... configurable dari
-- HO"). Head office's switch per store; carried to the store's server in the
-- auth policy's site profile (`SiteProfile::one_device`), where a sign-in on
-- a second device ends the first. Off by default, as the rule has been since
-- 29 Sep 2026.
ALTER TABLE site ADD COLUMN one_device_sign_in boolean NOT NULL DEFAULT false;
