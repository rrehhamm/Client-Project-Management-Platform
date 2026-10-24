-- Runs once, when the postgres volume is first created.
-- The test suite migrates and wipes this database; never point it at real data.
CREATE DATABASE cpm_test;
