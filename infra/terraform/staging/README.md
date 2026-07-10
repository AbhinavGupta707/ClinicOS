# Staging

This root owns the synthetic-only Mumbai staging environment and its Hyderabad recovery foundations. It is intentionally isolated in its own Terraform state and accepts a different `aws_account_id` when future account separation is available. It does not use AWS Organizations.

Public ingress and ECS runtime services are off until real DNS/TLS inputs and digest-pinned signed images are supplied. Alarm definitions still exist when no paging ARN is supplied, but `alert_delivery_configured` remains false. Those honest inactive states are not E4 evidence.

Safe local verification:

```sh
terraform init -backend=false
terraform validate
terraform test -test-directory=tests
```

Authorized remote-state initialization uses the existing backend only:

```sh
terraform init -backend-config=backend.hcl
```

Set `offline_validation_mode=false` for any authorized AWS plan/apply. Never apply the example values.
