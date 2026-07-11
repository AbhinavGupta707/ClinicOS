import { createGuardDutyS3MalwareEvidenceLambdaHandlerFromEnvironment } from "@clinic-os/integrations";

/** Fail-closed module initialization validates all scanner authority before Lambda accepts work. */
export const handler = createGuardDutyS3MalwareEvidenceLambdaHandlerFromEnvironment();
