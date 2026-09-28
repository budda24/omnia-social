-- One-time cleanup for channels deleted before the credential-erasure fix.
-- Keep anonymous rows so post history and foreign keys remain valid.
BEGIN;
UPDATE "Integration"
   SET "token" = '',
       "refreshToken" = NULL,
       "tokenExpiration" = NULL,
       "internalId" = 'deleted_' || "id",
       "rootInternalId" = NULL,
       "name" = 'Deleted channel',
       "picture" = NULL,
       "profile" = NULL,
       "additionalSettings" = '[]',
       "customInstanceDetails" = NULL,
       "customerId" = NULL
 WHERE "deletedAt" IS NOT NULL;
COMMIT;
