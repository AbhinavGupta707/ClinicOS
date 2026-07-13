export type RazorpayActivationState =
  | "absent"
  | "registered"
  | "configured"
  | "sandbox_verified"
  | "production_verified"
  | "degraded"
  | "disabled";
