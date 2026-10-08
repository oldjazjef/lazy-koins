-- F5.25: a file read with a mapping but holding no record (0 bookings, 0 balances) had no
-- platform and was listed under "Ohne Plattform". From now on the analysis stores the mapping's
-- platform for it; this fills in the rows stored before. Data only — no schema change.
UPDATE "project_file"
SET "platform" = (
  SELECT json_extract("import_mapping"."spec", '$.platform')
  FROM "import_mapping"
  WHERE "import_mapping"."id" = "project_file"."mapping_id"
)
WHERE "status" = 'mapped'
  AND "platform" IS NULL
  AND "booking_count" = 0
  AND "holding_count" = 0
  AND "mapping_id" IS NOT NULL;
