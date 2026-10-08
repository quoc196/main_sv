-- The test suite TRUNCATEs tables, so it gets its own database and never
-- touches the data in main_sv_dev.
CREATE DATABASE main_sv_test;
