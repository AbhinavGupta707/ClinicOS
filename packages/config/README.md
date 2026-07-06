# Config Package

Typed environment parsing and shared runtime configuration.

`@clinic-os/config` is the shared runtime contract for app, API, worker, mobile, and integration packages.

Current guarantees:

- validates `.env.example` through `npm run check:env`;
- supports the five environment profiles: `local`, `dev`, `staging`, `pilot-prod`, and `prod`;
- permits provider simulators only for `local` and `dev`;
- permits `unconfigured` provider states in production-like environments so unavailable features fail honestly;
- requires credential fields when official providers such as Meta Cloud WhatsApp, Razorpay, Exotel, Fireworks, OpenAI, or Deepgram are selected.

Package commands:

```sh
npm --workspace @clinic-os/config run typecheck
npm --workspace @clinic-os/config run lint
npm --workspace @clinic-os/config run test
npm --workspace @clinic-os/config run build
```
