-- Runs once, when the postgres volume is first created.
-- The test suite migrates and wipes this database; never point it at real data.
CREATE DATABASE cpm_test;
-- Browser tests (Playwright) wipe and reseed this one on every run.
-- (Created on demand too, for volumes made before it was added.)
CREATE DATABASE cpm_e2e;
