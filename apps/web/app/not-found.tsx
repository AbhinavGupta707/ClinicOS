import Link from "next/link";

export default function NotFound() {
  return (
    <main className="boot-screen">
      <section className="state-panel" aria-labelledby="not-found-title">
        <p className="state-kicker">Route not registered</p>
        <h1 id="not-found-title">This ClinicOS surface is not available.</h1>
        <p>Check registration and routing before investigating permissions or runtime behavior.</p>
        <Link className="text-link" href="/">
          Return to clinic day
        </Link>
      </section>
    </main>
  );
}
