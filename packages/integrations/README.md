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

## CP7 Messaging Provider Contract

WhatsApp messaging uses `MessagingProvider` from `src/messaging-provider.ts`.

- `MetaWhatsAppCloudProvider` models the official Meta WhatsApp Cloud `/messages` API, webhook challenge verification, `x-hub-signature-256` raw-body verification, inbound message normalization, status normalization, and template lifecycle mapping.
- Tests use injectable fetch fixtures. Live Meta calls are blocked unless the provider is constructed with an explicit live-call option, so local tests never need sandbox credentials or network access.
- Provider health is honest: missing API identifiers are `not_configured`, missing required app-secret verification is `unavailable`, missing webhook verify token or disabled live-call flag is `degraded`, and complete config with an injected fetch or explicit live-call option reports available while noting when a live health probe is disabled.
- Opt-out and opt-in policy is enforced before provider calls. Opted-out recipients and unknown opt-in for business-initiated sends are blocked unless a documented essential override is present; marketing and recall cannot bypass opt-out.
- Freeform and media messages require an open WhatsApp customer-service conversation window. Business-initiated sends must use approved templates.
- `WHATSAPP_PROVIDER=simulator` maps to an unavailable provider boundary for production configuration. Contract fixtures should use `MetaWhatsAppCloudProvider` with injected fetch rather than accepting fake product sends.

### CP7 Migration/Data Handoff

This lane does not add database migrations. The migration/data lane should persist at least:

- `message_templates` and `message_template_versions` with provider key, provider template id, name, language, category, lifecycle state, provider status, rejection reason, raw provider payload reference, timestamps, and uniqueness on tenant/provider/name/language/version.
- `messages` and `message_delivery_attempts` with tenant, clinic, patient/conversation references, provider message id, idempotency key, correlation id, lifecycle state, purpose, PHI flag, template version reference, and outbound request metadata.
- `message_status_events` with provider message id, normalized status, provider status, occurred-at, idempotency key, correlation id, raw webhook event reference/hash, conversation id, pricing category, and failure reason fields.
- `raw_webhook_events` for WhatsApp payloads before normalization, including provider/account ids, headers, raw body hash, verification status, received-at, and replay/dead-letter state.
- `communication_preferences`, `opt_in_records`, and `opt_out_records` that can be checked before every provider send.
