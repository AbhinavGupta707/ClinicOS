# Integrations Package

Provider-neutral contracts for external systems. The worker uses these contracts for provider health
surfaces and for future outbox handlers without coupling domain code to a specific vendor.

The package currently defines:

- adapter capabilities,
- source-of-truth modes for dual-run/import flows,
- provider health status contracts,
- raw webhook and normalized external event envelopes,
- approved external action/result contracts.

## CP5 Payment Provider Contract

Payments use `PaymentProvider` from `src/payment-provider.ts`.

- `SimulatorPaymentProvider` is for local/test contract execution only. It creates invoice-specific QR/link requests but never marks an invoice paid without a signed simulator webhook event.
- `RazorpayPaymentProvider` is ready for dynamic invoice-specific Payment Links and Razorpay QR requests through injectable HTTP fetch calls. Tests use injectable fetch and signed fixture webhooks; they do not call the live sandbox.
- Razorpay webhook verification requires `RAZORPAY_WEBHOOK_SECRET`, uses the raw request body, and compares the HMAC-SHA256 digest against `x-razorpay-signature`.
- Replay/idempotency uses `x-razorpay-event-id` when present. Domain application must still guard provider payment ids because providers can deliver multiple event names for the same payment.
- `RAZORPAY_WEBHOOK_URL` may be empty in local CP5 runs. In that state provider health is `degraded`, creation capabilities remain explicit, and `RECEIVE_WEBHOOKS` is not advertised. Dashboard webhook registration is a deployment task once a public HTTPS callback exists.
