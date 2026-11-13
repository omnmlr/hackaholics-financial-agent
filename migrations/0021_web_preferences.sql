CREATE TABLE IF NOT EXISTS agus_web_preferences (
  owner TEXT PRIMARY KEY,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE
);
