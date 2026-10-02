"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ClinicOsApiClient, VersionedPublicResource } from "@clinic-os/api-client-generated";
import { fieldText } from "./workflow-values";

export function PatientSelector(props: {
  readonly client: Pick<ClinicOsApiClient, "listPatients">;
  readonly patientId: string | null;
  readonly onSelectPatient: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly VersionedPublicResource[]>([]);
  const [status, setStatus] = useState("Search by patient name or phone.");
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    []
  );

  async function search(event: FormEvent) {
    event.preventDefault();
    const term = query.trim();
    const current = ++generation.current;
    if (term.length < 2) {
      setResults([]);
      setStatus("Enter at least two characters.");
      return;
    }
    setStatus("Searching patients…");
    try {
      const response = await props.client.listPatients({
        query: {
          ...(/^[+\d][\d ()+-]+$/.test(term)
            ? { phone: term.replace(/[ ()-]/g, "") }
            : { query: term }),
          limit: 20
        }
      });
      if (generation.current !== current) return;
      setResults(response.patients);
      setStatus(
        response.patients.length
          ? "Showing at most 20 matches. Refine the search if needed."
          : "No matching patients in this search."
      );
    } catch {
      if (generation.current === current) {
        setResults([]);
        setStatus("Patient search failed. Try again.");
      }
    }
  }

  return (
    <section aria-label="Choose patient">
      <form onSubmit={(event) => void search(event)}>
        <label>
          Find patient
          <input
            value={query}
            onChange={(event) => {
              generation.current += 1;
              setQuery(event.target.value);
              setResults([]);
              setStatus("Search by patient name or phone.");
            }}
            autoComplete="off"
            placeholder="Name or phone"
          />
        </label>
        <button type="submit">Search</button>
      </form>
      <p role="status">{status}</p>
      {results.length ? (
        <ul>
          {results.map((patient) => (
            <li key={patient.id}>
              <button
                type="button"
                aria-current={props.patientId === patient.id ? "true" : undefined}
                onClick={() => props.onSelectPatient(patient.id)}
              >
                {fieldText(patient, "fullName") || "Unnamed patient"}
                {fieldText(patient, "phone") ? ` · ${fieldText(patient, "phone")}` : ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
