# Singleton standalone-account baseline

This root is applied once per AWS account from the dedicated `clinicos/account-baseline/terraform.tfstate` key. Staging and pilot-prod must never instantiate these account-level services. It deliberately creates no AWS Organizations resources and is compatible with the current AWS Free account plan.

All controls are opt-in because CloudTrail delivery, Config recording, GuardDuty, Security Hub standards, and their retained logs can incur ongoing charges. A named authorization is mandatory. The full shape defines a validated multi-region CloudTrail, Config recorders in Mumbai and Hyderabad, and regional GuardDuty/Security Hub controls. A real saved plan and current AWS pricing review remain master prerequisites.

S3 object data events are a separate, higher-volume activation. The default selector set is empty. After an environment foundation is applied, manually copy its `cloudtrail_s3_object_event_arns` output into this root, remove any buckets not approved for the account, and enable `cloudtrail_s3_data_events` with named authorization. The input is a deduplicated set capped at 16 exact `arn:aws:s3:::bucket-name/*` scopes and must contain media and audit buckets; all-bucket wildcards are rejected. This root never reads environment remote state and never claims object-audit activation until the baseline selector is applied and operationally verified.

Shared-account apply order is therefore: backend bootstrap/migration; baseline boundary and management trail; each environment foundation; manual ARN review; then a second saved baseline plan/apply for S3 data events. Future separated accounts repeat the same sequence with only that account's bucket outputs.
