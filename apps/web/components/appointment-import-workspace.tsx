"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { PublicJsonObject } from "@clinic-os/api-client-generated";
import { createCp13ApiClient } from "@/lib/cp13-api-client";
import type { MeProfile } from "@/lib/me";
import { prepareAppointmentFile, type AppointmentObservation } from "@/lib/practo-appointment-file";
import { PatientSelector } from "@/features/cp13/shared/PatientSelector";
import { WorkflowAction, useWorkflowAction } from "@/features/cp13/shared/WorkflowAction";
import { fieldText, record } from "@/features/cp13/shared/workflow-values";
import { clinicDateTimeToInstant } from "@/features/cp13/front-office/front-desk";
export function AppointmentImportWorkspace({ profile }: { profile: MeProfile }) {
  const preparationGeneration = useRef(0);
  useEffect(
    () => () => {
      preparationGeneration.current++;
    },
    []
  );
  const client = useMemo(() => createCp13ApiClient(profile.clinic.id), [profile.clinic.id]);
  const action = useWorkflowAction(
    `${profile.tenant.id}:${profile.clinic.id}:${profile.user.id}`,
    "appointment source review"
  );
  const [imports, setImports] = useState<PublicJsonObject[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [runId, setRunId] = useState(""),
    [detail, setDetail] = useState<Awaited<ReturnType<typeof client.getAppointmentImport>> | null>(
      null
    ),
    [offset, setOffset] = useState(0),
    [row, setRow] = useState<PublicJsonObject | null>(null);
  const [prepared, setPrepared] = useState<{
      rows: AppointmentObservation[];
      digest: string;
    } | null>(null),
    [source, setSource] = useState(""),
    [ack, setAck] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("");
  const [patientId, setPatientId] = useState<string | null>(null),
    [decision, setDecision] = useState<"history" | "exclude" | "link" | "create">("history"),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [doctor, setDoctor] = useState(""),
    [type, setType] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [appointmentId, setAppointmentId] = useState("");
  const [doctors, setDoctors] = useState<PublicJsonObject[]>([]),
    [types, setTypes] = useState<PublicJsonObject[]>([]),
    [appointments, setAppointments] = useState<PublicJsonObject[]>([]),
    [lookupDate, setLookupDate] = useState("");
  const refresh = async () => {
    const list = await client.listAppointmentImports({});
    setImports([...list.imports]);
    setCursor(list.nextCursor);
    if (runId)
      setDetail(
        await client.getAppointmentImport({ path: { importId: runId }, query: { offset } })
      );
  };
  useEffect(() => {
    let live = true;
    void Promise.all([
      client.listAppointmentImports({}),
      client.listClinicDoctors({}),
      client.listAppointmentTypes({})
    ])
      .then(([i, d, t]) => {
        if (live) {
          setImports([...i.imports]);
          setCursor(i.nextCursor);
          setDoctors([...d.clinicDoctors]);
          setTypes([...t.appointmentTypes]);
        }
      })
      .catch(() => {
        if (live) setError("Import discovery or clinic configuration is unavailable.");
      });
    return () => {
      live = false;
    };
  }, [client]);
  useEffect(() => {
    let live = true;
    setDetail(null);
    setRow(null);
    if (runId)
      void client
        .getAppointmentImport({ path: { importId: runId }, query: { offset } })
        .then((r) => {
          if (live) setDetail(r);
        })
        .catch(() => {
          if (live) setError("Saved source review could not be loaded.");
        });
    return () => {
      live = false;
    };
  }, [client, runId, offset]);
  useEffect(() => {
    let live = true;
    setAppointments([]);
    setAppointmentId("");
    if (patientId && lookupDate)
      void client
        .listAppointments({ query: { date: lookupDate, limit: 100 } })
        .then((r) => {
          if (live) setAppointments(r.appointments.filter((a) => a.patientId === patientId));
        })
        .catch(() => {
          if (live) setError("Existing bookings could not be loaded.");
        });
    return () => {
      live = false;
    };
  }, [client, patientId, lookupDate]);
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!prepared || !ack) return;
    const file = prepared,
      sourceSystem = source.trim();
    if (!sourceSystem) {
      setError("Name this source consistently with earlier patient imports.");
      return;
    }
    await action.execute(
      async (key) => {
        const created = await client.createAppointmentImport({
          body: { sourceSystem, rowCount: file.rows.length, digest: file.digest },
          headers: { "idempotency-key": `${key}:manifest` }
        });
        const id = String(created.import.id);
        for (let n = 0; n < file.rows.length; n += 100) {
          setProgress(
            `Saving source observations ${n + 1}–${Math.min(n + 100, file.rows.length)} of ${file.rows.length}`
          );
          await client.stageAppointmentObservations({
            path: { importId: id },
            body: { offset: n, rows: file.rows.slice(n, n + 100) },
            headers: { "idempotency-key": `${key}:rows:${n}` }
          });
        }
        await client.sealAppointmentImport({
          path: { importId: id },
          body: {},
          headers: { "idempotency-key": `${key}:seal` }
        });
        const saved = await client.getAppointmentImport({ path: { importId: id } });
        setImports((items) => [saved.import, ...items.filter((item) => item.id !== id)]);
        setOffset(0);
        setRunId(id);
        setDetail(saved);
        setProgress(
          "Source file complete. Every observation still needs an explicit review decision."
        );
        return id;
      },
      async () => {
        setPrepared(null);
        setAck(false);
      }
    );
  }
  async function review(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!row) return;
    try {
      if ((decision === "create" || decision === "link") && (!patientId || !confirmed))
        throw new Error("Choose the patient and confirm the source identity and booking details.");
      const booking =
        decision === "create"
          ? {
              patientId: patientId!,
              providerUserId: doctor,
              appointmentTypeId: type,
              startAt: clinicDateTimeToInstant(start, profile.clinic.timezone!),
              endAt: clinicDateTimeToInstant(end, profile.clinic.timezone!)
            }
          : undefined;
      await action.execute(
        (key) =>
          client.reviewAppointmentObservation({
            path: { importId: runId, rowId: String(row.id) },
            body: {
              decision,
              reason,
              confirmedDetails: confirmed,
              ...(booking ? { booking } : {}),
              ...(decision === "link" ? { patientId: patientId!, appointmentId } : {})
            },
            headers: { "idempotency-key": key }
          }),
        async () => {
          setRow(null);
          await refresh();
        }
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review could not be prepared.");
    }
  }
  function selectRow(item: PublicJsonObject) {
    setRow(item);
    setPatientId(null);
    setDecision("history");
    setReason("");
    setConfirmed(false);
    setDoctor("");
    setType("");
    setStart("");
    setEnd("");
    setAppointmentId("");
    setLookupDate("");
  }
  return (
    <section className="appointment-import-workspace" data-testid="appointment-import-workspace">
      <h2>Review Practo appointment evidence</h2>
      <p>
        This is a reviewed handoff, not scheduled sync. The export does not establish booking IDs,
        planned duration or visit type. A different file needs fresh review; missing rows never
        cancel bookings. Creating a reviewed booking does not request a patient confirmation
        message.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <WorkflowAction {...action} onRecover={() => void action.recover(refresh)} />
      <p role="status">{progress}</p>
      <form onSubmit={(e) => void upload(e)}>
        <fieldset disabled={action.locked || loading}>
          <legend>Upload source observations</legend>
          <label>
            Appointment source name
            <input
              required
              maxLength={100}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setAck(false);
              }}
            />
          </label>
          <label>
            Practo appointments.csv
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const generation = ++preparationGeneration.current;
                const file = e.target.files?.[0];
                setPrepared(null);
                setAck(false);
                setError("");
                if (file) {
                  setLoading(true);
                  void prepareAppointmentFile(file)
                    .then((result) => {
                      if (generation === preparationGeneration.current) setPrepared(result);
                    })
                    .catch((err) => {
                      if (generation === preparationGeneration.current)
                        setError(err instanceof Error ? err.message : "Unsupported file.");
                    })
                    .finally(() => {
                      if (generation === preparationGeneration.current) setLoading(false);
                    });
                }
              }}
            />
          </label>
          {prepared ? (
            <p>
              {prepared.rows.length} observations prepared. Patient identifiers/names, doctor names,
              source date and status will be sent. Notes and attendance timestamps are excluded.
              This is not a clinical-history import.
            </p>
          ) : null}
          <label>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I
            approve these fields and understand that no bookings will be created by uploading.
          </label>
          <button disabled={!prepared || !ack} type="submit">
            Save appointment evidence
          </button>
        </fieldset>
      </form>
      {loading ? <p>Checking the complete file locally…</p> : null}
      <fieldset disabled={action.locked}>
        <label>
          Saved appointment import
          <select
            value={runId}
            onChange={(e) => {
              setRunId(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Choose saved evidence</option>
            {imports.map((i) => (
              <option key={String(i.id)} value={String(i.id)}>
                {String(i.sourceSystem)} · {String(i.rowCount)} rows · {String(i.createdAt)}
              </option>
            ))}
          </select>
        </label>
        {cursor ? (
          <button
            type="button"
            onClick={() =>
              void client
                .listAppointmentImports({ query: { cursor } })
                .then((r) => {
                  setImports((v) => [...v, ...r.imports]);
                  setCursor(r.nextCursor);
                })
                .catch(() => setError("Could not load further imports."))
            }
          >
            More imports
          </button>
        ) : null}
      </fieldset>
      {detail ? (
        <>
          <p>
            File:{" "}
            {detail.import.sealedAt
              ? "complete and verified"
              : "incomplete — reselect the same file to resume"}{" "}
            · {detail.counts.map((c) => `${String(c.decision)}: ${String(c.count)}`).join(" · ")}
          </p>
          <ul>
            {detail.rows.map((r) => {
              const e = record(r.sourceData);
              return (
                <li key={String(r.id)}>
                  <button
                    disabled={action.locked || r.decision !== "pending" || !detail.import.sealedAt}
                    onClick={() => selectRow(r)}
                  >
                    Observation {Number(r.ordinal) + 1}: {String(e.patientName)} · {String(e.date)}{" "}
                    · {String(e.status)} · {String(r.decision)}
                  </button>
                  {r.appointmentId ? <span> Linked to ClinicOS booking</span> : null}
                </li>
              );
            })}
          </ul>
          <button
            disabled={action.locked || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Previous observations
          </button>
          {detail.nextOffset !== null ? (
            <button disabled={action.locked} onClick={() => setOffset(detail.nextOffset!)}>
              Next observations
            </button>
          ) : null}
        </>
      ) : null}
      {row ? (
        <section aria-label="Review selected source observation">
          {decision === "create" || decision === "link" ? (
            <fieldset disabled={action.locked}>
              <PatientSelector
                client={client}
                patientId={patientId}
                onSelectPatient={(id) => {
                  setPatientId(id);
                  setConfirmed(false);
                }}
              />
            </fieldset>
          ) : null}
          <form onSubmit={(e) => void review(e)}>
            <fieldset disabled={action.locked}>
              <legend>Review observation {Number(row.ordinal) + 1}</legend>
              <p>
                Source patient {fieldText(record(row.sourceData), "patientNumber")} ·{" "}
                {fieldText(record(row.sourceData), "patientName")} · doctor{" "}
                {fieldText(record(row.sourceData), "doctorName")} · source date{" "}
                {fieldText(record(row.sourceData), "date")} (timezone unverified)
              </p>
              <label>
                Observation decision
                <select
                  value={decision}
                  onChange={(e) => {
                    setDecision(e.target.value as typeof decision);
                    setConfirmed(false);
                  }}
                >
                  <option value="history">Retain as historical source evidence</option>
                  <option value="exclude">Exclude from booking migration</option>
                  <option value="link">Link a reviewed existing booking</option>
                  <option value="create">Create a reviewed upcoming booking</option>
                </select>
              </label>
              {decision === "create" || decision === "link" ? (
                <>
                  {decision === "create" ? (
                    <>
                      <label>
                        Reviewed doctor
                        <select
                          required
                          value={doctor}
                          onChange={(e) => {
                            setDoctor(e.target.value);
                            setConfirmed(false);
                          }}
                        >
                          <option value="">Choose doctor</option>
                          {doctors.map((d) => (
                            <option key={String(d.providerUserId)} value={String(d.providerUserId)}>
                              {String(d.displayName)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Reviewed visit type
                        <select
                          required
                          value={type}
                          onChange={(e) => {
                            setType(e.target.value);
                            setConfirmed(false);
                          }}
                        >
                          <option value="">Choose visit type</option>
                          {types.map((t) => (
                            <option key={String(t.id)} value={String(t.id)}>
                              {String(t.displayName)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p>
                        Enter verified planned times in {profile.clinic.timezone}. Check-in/out
                        timestamps do not establish duration.
                      </p>
                      <label>
                        Reviewed start
                        <input
                          type="datetime-local"
                          required
                          value={start}
                          onChange={(e) => {
                            setStart(e.target.value);
                            setConfirmed(false);
                          }}
                        />
                      </label>
                      <label>
                        Reviewed end
                        <input
                          type="datetime-local"
                          required
                          value={end}
                          onChange={(e) => {
                            setEnd(e.target.value);
                            setConfirmed(false);
                          }}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label>
                        Existing booking date
                        <input
                          type="date"
                          required
                          value={lookupDate}
                          onChange={(e) => setLookupDate(e.target.value)}
                        />
                      </label>
                      <label>
                        Existing patient booking
                        <select
                          required
                          value={appointmentId}
                          onChange={(e) => {
                            setAppointmentId(e.target.value);
                            setConfirmed(false);
                          }}
                        >
                          <option value="">Choose a booking</option>
                          {appointments.map((a) => (
                            <option key={String(a.id)} value={String(a.id)}>
                              {String(a.startAt)} · {String(a.status)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p>
                        At most 100 bookings are searched for the selected clinic day. Linking
                        preserves the existing booking unchanged.
                      </p>
                    </>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I verified the patient, source timezone and planned booking details; I am not
                    inferring them from attendance.
                  </label>
                </>
              ) : null}
              <label>
                Observation review reason
                <textarea
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <p>Saved decisions are permanent evidence. Review carefully before confirming.</p>
              <button type="submit">Confirm observation review</button>
            </fieldset>
          </form>
        </section>
      ) : null}
    </section>
  );
}
