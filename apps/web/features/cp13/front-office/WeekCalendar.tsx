"use client";
import { useMemo, useState } from "react";
import type { ClinicOsApiClient } from "@clinic-os/api-client-generated";
import { useWorkflowData, WorkflowCard } from "../shared/WorkflowData";
import { clinicDisplayTime, fieldText } from "../shared/workflow-values";

export function weekDates(date: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Choose a valid date.");
  const start = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== date)
    throw new Error("Choose a valid date.");
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) =>
    new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10)
  );
}
export function WeekCalendar(props: {
  client: ClinicOsApiClient;
  date: string;
  timeZone: string;
  onChooseDay: (date: string) => void;
  disabled: boolean;
}) {
  const days = useMemo(() => weekDates(props.date), [props.date]),
    [provider, setProvider] = useState("");
  const week = useWorkflowData(
    () => Promise.all(days.map((date) => props.client.getMorningDashboard({ query: { date } }))),
    [props.client, days[0]]
  );
  const doctors = useWorkflowData(() => props.client.listClinicDoctors(), [props.client]);
  const schedules = useWorkflowData(() => props.client.listProviderSchedules(), [props.client]);
  return (
    <WorkflowCard
      title="Week schedule"
      loading={week.loading}
      error={week.error}
      onRefresh={() => void week.refresh().catch(() => undefined)}
    >
      <label>
        Show doctor
        <select value={provider} onChange={(event) => setProvider(event.target.value)}>
          <option value="">All doctors</option>
          {doctors.data?.clinicDoctors.map((doctor) => (
            <option
              key={fieldText(doctor, "providerUserId")}
              value={fieldText(doctor, "providerUserId")}
            >
              {fieldText(doctor, "displayName")}
            </option>
          ))}
        </select>
      </label>
      {doctors.error || schedules.error ? (
        <p role="alert">Doctor working hours could not be loaded. Retry the week view.</p>
      ) : null}
      <div className="week-calendar">
        {days.map((date) => {
          const dashboard = week.data?.find((item) => item.dashboard.date === date)?.dashboard;
          return (
            <section key={date}>
              <h3>
                <button
                  type="button"
                  disabled={props.disabled}
                  onClick={() => props.onChooseDay(date)}
                >
                  {new Intl.DateTimeFormat("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC"
                  }).format(new Date(`${date}T12:00:00Z`))}
                </button>
              </h3>
              {provider ? (
                <p>
                  {schedules.data?.providerSchedules
                    .filter(
                      (row) =>
                        row.providerUserId === provider &&
                        row.active === true &&
                        Number(row.dayOfWeek) === new Date(`${date}T12:00:00Z`).getUTCDay() &&
                        fieldText(row, "effectiveFrom") <= date &&
                        (!row.effectiveUntil || fieldText(row, "effectiveUntil") >= date)
                    )
                    .map(
                      (row) =>
                        `${fieldText(row, "startsAt").slice(0, 5)}–${fieldText(row, "endsAt").slice(0, 5)}`
                    )
                    .join(", ") || "No working hours configured"}
                </p>
              ) : null}
              {dashboard?.appointmentsTruncated ? (
                <p role="alert">
                  This day exceeds the display limit. Open the day and refine the schedule.
                </p>
              ) : null}
              {dashboard ? (
                <ul>
                  {dashboard.clinicDayAppointments
                    .filter((item) => !provider || item.providerUserId === provider)
                    .map((item) => (
                      <li key={item.id}>
                        <strong>{clinicDisplayTime(item.startAt, props.timeZone)}</strong>
                        <span>{item.patientName}</span>
                        <span>
                          {item.providerName} · {item.appointmentTypeName}
                        </span>
                        <span>
                          {item.status.replaceAll("_", " ")}
                          {item.chairName ? ` · ${item.chairName}` : ""}
                        </span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p>{week.error ? "Unavailable" : "Loading…"}</p>
              )}
              {dashboard &&
              !dashboard.clinicDayAppointments.some(
                (item) => !provider || item.providerUserId === provider
              ) ? (
                <p>No appointments</p>
              ) : null}
            </section>
          );
        })}
      </div>
      <p>
        Open a day to book or change a visit. Times use {props.timeZone}. Refresh to retrieve
        current bookings.
      </p>
    </WorkflowCard>
  );
}
