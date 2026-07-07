import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerDashboardProjection, type OwnerDashboardProjectionData } from "../src/index.ts";

const from = "2026-07-01T00:00:00.000Z";
const to = "2026-07-07T23:59:59.999Z";
const generatedAt = "2026-07-07T12:00:00.000Z";

test("owner dashboard derives source-backed revenue and continuity exceptions from source rows", () => {
  const dashboard = buildOwnerDashboardProjection({
    from,
    to,
    generatedAt,
    data: projectionData()
  });

  assert.equal(dashboard.appointments.scheduled, 3);
  assert.equal(dashboard.appointments.completed, 1);
  assert.equal(dashboard.appointments.noShow, 1);
  assert.equal(dashboard.appointments.noShowRateBasisPoints, 3333);

  assert.equal(dashboard.revenue.invoicedMinor, 1_500_000);
  assert.equal(dashboard.revenue.collectedMinor, 900_000);
  assert.equal(dashboard.revenue.outstandingMinor, 600_000);
  assert.deepEqual(dashboard.revenue.attributionCompleteness, {
    invoiceCount: 2,
    invoiceWithRevenueTouchCount: 1,
    invoiceWithAppointmentSourceCount: 1,
    unresolvedInvoiceCount: 0
  });
  assert.deepEqual(
    dashboard.revenue.bySource.map((source) => ({
      source: source.source,
      appointments: source.appointmentCount,
      invoices: source.invoiceCount,
      invoiced: source.invoicedMinor,
      collected: source.collectedMinor,
      noShows: source.noShowCount
    })),
    [
      {
        source: "google",
        appointments: 1,
        invoices: 1,
        invoiced: 900_000,
        collected: 900_000,
        noShows: 0
      },
      {
        source: "practo",
        appointments: 1,
        invoices: 1,
        invoiced: 600_000,
        collected: 0,
        noShows: 1
      },
      {
        source: "referral",
        appointments: 1,
        invoices: 0,
        invoiced: 0,
        collected: 0,
        noShows: 0
      }
    ]
  );

  assert.equal(dashboard.recalls.due, 3);
  assert.equal(dashboard.recalls.completed, 1);
  assert.equal(dashboard.recalls.overdue, 2);
  assert.equal(dashboard.recalls.completedRateBasisPoints, 3333);

  assert.equal(dashboard.tasks.open, 3);
  assert.equal(dashboard.tasks.overdue, 2);
  assert.equal(dashboard.tasks.completed, 1);
  assert.equal(dashboard.sops.due, 2);
  assert.equal(dashboard.sops.completed, 1);
  assert.equal(dashboard.sops.overdue, 1);

  assert.equal(dashboard.labs.activeCases, 2);
  assert.equal(dashboard.labs.overdueCases, 1);
  assert.equal(dashboard.labs.reworkRequired, 1);
  assert.equal(dashboard.labs.pendingReconciliation, 1);
  assert.equal(dashboard.labs.reconciliationVarianceMinor, 2_000);

  assert.equal(dashboard.inventory.openExceptions, 2);
  assert.equal(dashboard.inventory.criticalExceptions, 1);
  assert.equal(dashboard.inventory.procurementRequests, 1);
  assert.equal(dashboard.inventory.resolvedExceptions, 1);

  assert.equal(dashboard.treatmentAndPayments.presentedPlanCount, 2);
  assert.equal(dashboard.treatmentAndPayments.acceptedPlanCount, 1);
  assert.equal(dashboard.treatmentAndPayments.unacceptedMinor, 600_000);
  assert.equal(dashboard.treatmentAndPayments.completedButUninvoicedMinor, 250_000);
  assert.equal(dashboard.treatmentAndPayments.overdueInvoiceMinor, 600_000);

  assert.equal(dashboard.incidents.opened, 2);
  assert.equal(dashboard.incidents.open, 1);
  assert.equal(dashboard.incidents.highSeverityOpen, 1);
  assert.equal(dashboard.incidents.correctiveActionsAssigned, 1);
  assert.equal(dashboard.incidents.correctiveActionsCompleted, 1);
  assert.equal(dashboard.incidents.correctiveActionsOverdue, 1);
});

function projectionData(): OwnerDashboardProjectionData {
  return {
    patients: [
      { id: id("2001"), source: "google", createdAt: "2026-07-01T08:00:00.000Z" },
      { id: id("2002"), source: "practo", createdAt: "2026-07-02T08:00:00.000Z" },
      { id: id("2003"), source: "referral", createdAt: "2026-07-03T08:00:00.000Z" }
    ],
    leads: [
      {
        id: id("3001"),
        patientId: id("2001"),
        source: "google",
        status: "booked",
        firstSeenAt: "2026-07-01T08:05:00.000Z"
      },
      {
        id: id("3002"),
        patientId: id("2002"),
        source: "practo",
        status: "booked",
        firstSeenAt: "2026-07-02T08:05:00.000Z"
      }
    ],
    appointments: [
      {
        id: id("4001"),
        patientId: id("2001"),
        leadId: id("3001"),
        status: "completed",
        source: "google",
        startAt: "2026-07-03T09:00:00.000Z"
      },
      {
        id: id("4002"),
        patientId: id("2002"),
        leadId: id("3002"),
        status: "no_show",
        source: "practo",
        startAt: "2026-07-03T10:00:00.000Z"
      },
      {
        id: id("4003"),
        patientId: id("2003"),
        leadId: null,
        status: "confirmed",
        source: "referral",
        startAt: "2026-07-06T10:00:00.000Z"
      }
    ],
    encounters: [
      {
        id: id("5001"),
        patientId: id("2001"),
        appointmentId: id("4001"),
        status: "closed",
        createdAt: "2026-07-03T09:10:00.000Z"
      },
      {
        id: id("5002"),
        patientId: id("2002"),
        appointmentId: id("4002"),
        status: "cancelled",
        createdAt: "2026-07-03T10:10:00.000Z"
      }
    ],
    attributionTouches: [
      {
        id: id("6001"),
        patientId: id("2001"),
        leadId: id("3001"),
        appointmentId: id("4001"),
        invoiceId: id("9001"),
        source: "google",
        touchType: "revenue_touch",
        occurredAt: "2026-07-03T10:30:00.000Z"
      }
    ],
    treatmentPlans: [
      {
        id: id("7001"),
        patientId: id("2001"),
        status: "accepted",
        totalMinor: 900_000,
        presentedAt: "2026-07-03T09:25:00.000Z",
        acceptedAt: "2026-07-03T09:35:00.000Z",
        createdAt: "2026-07-03T09:20:00.000Z"
      },
      {
        id: id("7002"),
        patientId: id("2002"),
        status: "presented",
        totalMinor: 600_000,
        presentedAt: "2026-07-04T09:25:00.000Z",
        acceptedAt: null,
        createdAt: "2026-07-04T09:20:00.000Z"
      }
    ],
    procedures: [
      {
        id: id("8001"),
        patientId: id("2001"),
        encounterId: id("5001"),
        treatmentPlanId: id("7001"),
        invoiceId: id("9001"),
        status: "completed",
        totalMinor: 900_000,
        performedAt: "2026-07-03T09:50:00.000Z"
      },
      {
        id: id("8002"),
        patientId: id("2002"),
        encounterId: id("5002"),
        treatmentPlanId: id("7002"),
        invoiceId: id("9002"),
        status: "completed",
        totalMinor: 600_000,
        performedAt: "2026-07-04T10:00:00.000Z"
      },
      {
        id: id("8003"),
        patientId: id("2003"),
        encounterId: id("5001"),
        treatmentPlanId: id("7001"),
        invoiceId: null,
        status: "completed",
        totalMinor: 250_000,
        performedAt: "2026-07-05T10:00:00.000Z"
      }
    ],
    invoices: [
      {
        id: id("9001"),
        patientId: id("2001"),
        treatmentPlanId: id("7001"),
        status: "issued",
        paymentStatus: "paid",
        currency: "INR",
        totalMinor: 900_000,
        paidMinor: 900_000,
        balanceMinor: 0,
        issuedAt: "2026-07-03T10:15:00.000Z",
        dueAt: "2026-07-03T18:00:00.000Z"
      },
      {
        id: id("9002"),
        patientId: id("2002"),
        treatmentPlanId: id("7002"),
        status: "issued",
        paymentStatus: "unpaid",
        currency: "INR",
        totalMinor: 600_000,
        paidMinor: 0,
        balanceMinor: 600_000,
        issuedAt: "2026-07-04T10:15:00.000Z",
        dueAt: "2026-07-05T18:00:00.000Z"
      }
    ],
    payments: [
      {
        id: id("a001"),
        invoiceId: id("9001"),
        status: "manually_recorded",
        amountMinor: 900_000,
        receivedAt: "2026-07-03T10:30:00.000Z"
      }
    ],
    recalls: [
      {
        id: id("b001"),
        patientId: id("2001"),
        source: "google",
        status: "completed",
        dueAt: "2026-07-02T09:00:00.000Z",
        completedAt: "2026-07-02T11:00:00.000Z",
        bookedAppointmentId: id("4001")
      },
      {
        id: id("b002"),
        patientId: id("2002"),
        source: "practo",
        status: "contacted",
        dueAt: "2026-07-04T09:00:00.000Z",
        completedAt: null,
        bookedAppointmentId: null
      },
      {
        id: id("b003"),
        patientId: id("2003"),
        source: "referral",
        status: "due",
        dueAt: "2026-07-06T09:00:00.000Z",
        completedAt: null,
        bookedAppointmentId: null
      }
    ],
    tasks: [
      {
        id: id("c001"),
        patientId: id("2001"),
        taskType: "post_op_follow_up",
        status: "done",
        dueAt: "2026-07-02T12:00:00.000Z",
        createdAt: "2026-07-01T12:00:00.000Z",
        updatedAt: "2026-07-02T13:00:00.000Z"
      },
      {
        id: id("c002"),
        patientId: id("2002"),
        taskType: "payment_due",
        status: "open",
        dueAt: "2026-07-05T12:00:00.000Z",
        createdAt: "2026-07-04T12:00:00.000Z",
        updatedAt: "2026-07-04T12:00:00.000Z"
      },
      {
        id: id("c003"),
        patientId: null,
        taskType: "procurement",
        status: "in_progress",
        dueAt: "2026-07-06T12:00:00.000Z",
        createdAt: "2026-07-05T12:00:00.000Z",
        updatedAt: "2026-07-05T12:00:00.000Z"
      },
      {
        id: id("c004"),
        patientId: null,
        taskType: "capa",
        status: "open",
        dueAt: "2026-07-09T12:00:00.000Z",
        createdAt: "2026-07-05T12:00:00.000Z",
        updatedAt: "2026-07-05T12:00:00.000Z"
      }
    ],
    sopRuns: [
      {
        id: id("d001"),
        templateKey: "switch-check",
        status: "completed",
        scheduledFor: "2026-07-02T08:00:00.000Z",
        completedAt: "2026-07-02T08:15:00.000Z"
      },
      {
        id: id("d002"),
        templateKey: "inventory-check",
        status: "scheduled",
        scheduledFor: "2026-07-05T08:00:00.000Z",
        completedAt: null
      }
    ],
    labCases: [
      {
        id: id("e001"),
        patientId: id("2001"),
        status: "rework_required",
        dueAt: "2026-07-05T09:00:00.000Z",
        createdAt: "2026-07-01T09:00:00.000Z",
        completedAt: null,
        reconciliationStatus: "pending",
        expectedAmountMinor: 45_000,
        invoiceAmountMinor: null
      },
      {
        id: id("e002"),
        patientId: id("2002"),
        status: "sent_to_lab",
        dueAt: "2026-07-08T09:00:00.000Z",
        createdAt: "2026-07-04T09:00:00.000Z",
        completedAt: null,
        reconciliationStatus: "not_required",
        expectedAmountMinor: 30_000,
        invoiceAmountMinor: null
      },
      {
        id: id("e003"),
        patientId: id("2003"),
        status: "completed",
        dueAt: "2026-07-04T09:00:00.000Z",
        createdAt: "2026-07-01T09:00:00.000Z",
        completedAt: "2026-07-05T09:00:00.000Z",
        reconciliationStatus: "variance",
        expectedAmountMinor: 20_000,
        invoiceAmountMinor: 22_000
      }
    ],
    inventoryExceptions: [
      {
        id: id("f001"),
        itemKey: "composite-a2",
        severity: "critical",
        status: "procurement_requested",
        detectedAt: "2026-07-02T08:00:00.000Z",
        resolvedAt: null,
        procurementTaskId: id("c003")
      },
      {
        id: id("f002"),
        itemKey: "gloves-m",
        severity: "medium",
        status: "open",
        detectedAt: "2026-07-03T08:00:00.000Z",
        resolvedAt: null,
        procurementTaskId: null
      },
      {
        id: id("f003"),
        itemKey: "etchant",
        severity: "low",
        status: "resolved",
        detectedAt: "2026-07-04T08:00:00.000Z",
        resolvedAt: "2026-07-05T08:00:00.000Z",
        procurementTaskId: null
      }
    ],
    incidents: [
      {
        id: id("a101"),
        category: "lab_delay",
        severity: "high",
        status: "open",
        occurredAt: "2026-07-04T12:00:00.000Z"
      },
      {
        id: id("a102"),
        category: "missed_payment_collection",
        severity: "medium",
        status: "closed",
        occurredAt: "2026-07-03T12:00:00.000Z"
      }
    ],
    correctiveActions: [
      {
        id: id("a201"),
        incidentId: id("a101"),
        status: "assigned",
        dueAt: "2026-07-05T18:00:00.000Z",
        assignedAt: "2026-07-04T13:00:00.000Z",
        completedAt: null
      },
      {
        id: id("a202"),
        incidentId: id("a102"),
        status: "completed",
        dueAt: "2026-07-05T18:00:00.000Z",
        assignedAt: "2026-07-03T13:00:00.000Z",
        completedAt: "2026-07-04T13:00:00.000Z"
      }
    ],
    dataSources: [
      {
        key: "domain-test",
        label: "Domain test source rows",
        status: "ready",
        recordCount: 42,
        provenance: ["packages/domain/test/owner-dashboard.test.ts"]
      }
    ]
  };
}

function id(suffix: string) {
  return `60000000-0000-4000-8000-00000000${suffix}`;
}
