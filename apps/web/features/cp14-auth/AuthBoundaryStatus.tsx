import type { Cp14AuthAvailability } from "./auth-state";

export function AuthBoundaryStatus({ state }: { state: Cp14AuthAvailability }) {
  return (
    <section aria-live="polite" data-auth-status={state.status}>
      <h2>{state.title}</h2>
      <p>{state.detail}</p>
      {state.loginAllowed ? (
        <a href="/auth/login" data-auth-action="login">
          Continue to secure sign-in
        </a>
      ) : (
        <p role="status">Contact the ClinicOS administrator; access remains disabled.</p>
      )}
    </section>
  );
}
