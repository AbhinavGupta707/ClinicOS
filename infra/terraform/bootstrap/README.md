# Singleton backend bootstrap

This root is the only owner of the dedicated KMS-encrypted ClinicOS Terraform state bucket and DynamoDB lock table. Its default plan creates nothing. A named approval enables the one-time bootstrap; workers must never apply it.

The initial state is intentionally local because a backend cannot create itself. After a reviewed apply, the master records the KMS ARN, adds it to every `backend.hcl`, and separately runs `terraform init -migrate-state` for this root and each existing environment. Backend migration, state copying, and lock-table changes are state mutations and remain master-authorized only.

The former SSE-S3 backend is not silently reused. Existing state must be inventoried, backed up, migrated to the dedicated CMK bucket, and verified before CI roles are switched.
