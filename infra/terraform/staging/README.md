# Staging

This root owns the synthetic-only Mumbai staging environment and its Hyderabad recovery foundations. It is intentionally isolated in its own Terraform state and accepts a different `aws_account_id` when future account separation is available. It does not use AWS Organizations.

The default `foundation` phase excludes NAT, endpoints, RDS, cache, backup plan, ECS, and load balancers. `data-plane`, `runtime`, and `edge` are explicit ordered activations. Runtime additionally requires a distinct internal Keycloak admin hostname/ALB contract, a DNS-owner-supplied private zone, TLS, restricted operator CIDRs, immutable images, and numeric non-root image users. Public auth ingress remains off until `edge`. Those honest inactive states are not E4 evidence.

Safe local verification:

```sh
terraform init -backend=false
terraform validate
terraform test -test-directory=tests
```

Authorized remote-state initialization uses the dedicated KMS backend only after the master completes bootstrap/migration:

```sh
terraform init -backend-config=backend.hcl
```

Set `offline_validation_mode=false` for any authorized AWS plan/apply. Never apply the example values.
