# Config Package

Typed environment parsing and shared runtime configuration.

`@clinic-os/config` is the shared runtime contract for app, API, worker, mobile, and integration packages.

Current guarantees:

- validates `.env.example` through `npm run check:env`;
- supports the five environment profiles: `local`, `dev`, `staging`, `pilot-prod`, and `prod`;
- permits provider simulators only for `local` and `dev`;
- permits `unconfigured` provider states in production-like environments so unavailable features fail honestly;
- requires credential fields when official providers such as Meta Cloud WhatsApp, Razorpay, Exotel, Fireworks, OpenAI, or Deepgram are selected;
- validates CP9 operations posture for AWS primary/DR regions, Terraform backend inputs, alerting destinations, and synthetic restore-drill guards;
- blocks destructive restore-drill execution outside `local`/`dev` and requires synthetic pilot inputs for local restore smoke tests.

CP9 operations fields are exposed under `config.operations`:

- `operations.cloud` - AWS profile, `ap-south-1` primary, `ap-south-2` DR, Terraform backend names, and KMS alias metadata.
- `operations.alerting` - alerting provider and destination settings without embedding secrets in source.
- `operations.backupRestore` - dry-run/local-execute mode, local target DB URL, RPO/RTO targets, and explicit destructive opt-in.

Package commands:

```sh
npm --workspace @clinic-os/config run typecheck
npm --workspace @clinic-os/config run lint
npm --workspace @clinic-os/config run test
npm --workspace @clinic-os/config run build
```
