# ClinicOS Keycloak Contract

`realm-import/clinic-os-local.json` remains a synthetic local-only realm. It is not promotable.

Production-like realms are rendered from `production/clinic-os-realm.template.json` with
`promotion/bind-realm.mjs`. The binding contains only public realm/origin/redirect values; the
renderer rejects missing bindings, wildcard redirects, users, credentials, secret-bearing fields,
non-PKCE clients, offline access, weak refresh reuse, and non-canonical output. The output path must
not already exist, so promotion never silently overwrites reviewed material.

The web client is confidential and BFF-only. Its secret is generated after realm creation, placed in
Secrets Manager, and never added to realm JSON. Mobile is a public client with one exact claimed
HTTPS or registered app redirect. Both require Authorization Code + PKCE S256, receive the explicit
`clinic-os-api` audience, have no implicit/password/service-account grants, and cannot request
offline access.

`topology/production-ha.json` is the machine-readable handoff to the Terraform lane. Missing
hostname, database, proxy, origin, redirect, or secret bindings must prevent deployment/readiness.
`operations/backup-restore-policy.json` deliberately treats PostgreSQL PITR as authoritative; a
realm export is not a backup of sessions, revocations, workflow state, or admin events. Signing-key
rotation keeps the previous public key available until the maximum token lifetime and skew window
have elapsed.

Privileged MFA is enforced twice: JML assigns a Keycloak required action, and ClinicOS rejects
privileged/break-glass access unless verified token `amr`/`acr` demonstrates MFA. Product roles,
tenant membership, clinic assignment, capabilities, break-glass scope, and authority revision stay
in ClinicOS rather than realm roles.
