import {
  S3PrivateMediaProvider,
  type MagicByteDetector,
  type MalwareEvidenceSignatureVerifier,
  type MalwareScannerTransport,
  type S3PresigningTransport,
  type S3PrivateMediaProviderConfig,
  type S3PrivateObjectTransport
} from "@clinic-os/integrations";
import type { ClinicalDentalHandlerDependencies } from "../../features/clinical-dental/types.ts";
import {
  RoutedMediaAuthorityFactory,
  S3ClinicalMediaProvider
} from "./clinical-media-provider.ts";
import {
  PostgresPrivateMediaAtomicPersistence,
  PostgresPrivateMediaPersistenceError
} from "./postgres-private-media-persistence.ts";

export interface PostgresS3TransactionMediaDependencies {
  readonly config: S3PrivateMediaProviderConfig;
  readonly objects: S3PrivateObjectTransport;
  readonly signer: S3PresigningTransport;
  readonly detector: MagicByteDetector;
  readonly scanner: MalwareScannerTransport;
  readonly evidenceVerifier: MalwareEvidenceSignatureVerifier;
}

/**
 * Builds a fresh private-media gateway inside the active mutation transaction. AWS transports are
 * safe shared clients; persistence and request authority are never shared across requests.
 */
export function createPostgresS3TransactionMediaProviderFactory(
  dependencies: PostgresS3TransactionMediaDependencies
): NonNullable<ClinicalDentalHandlerDependencies["transactionMediaProvider"]> {
  return (request, context) => {
    if (!context.sqlClient) {
      throw new PostgresPrivateMediaPersistenceError(
        "transaction_context_required",
        "Private media requires the active durable request transaction."
      );
    }

    const gateway = new S3PrivateMediaProvider(dependencies.config, {
      objects: dependencies.objects,
      signer: dependencies.signer,
      detector: dependencies.detector,
      scanner: dependencies.scanner,
      evidenceVerifier: dependencies.evidenceVerifier,
      persistence: new PostgresPrivateMediaAtomicPersistence(context.sqlClient, {
        tenantId: request.access.context.tenant.id,
        clinicId: request.access.clinicId,
        userId: request.access.context.user.id
      }),
      now: () => context.clock.now()
    });

    return new S3ClinicalMediaProvider({
      gateway,
      region: dependencies.config.region,
      authorityFactory: new RoutedMediaAuthorityFactory(() => ({
        actorId: request.access.context.user.id,
        correlationId: request.metadata.requestId
      }))
    });
  };
}
