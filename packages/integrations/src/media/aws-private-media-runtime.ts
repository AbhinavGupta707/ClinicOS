import { KMSClient } from "@aws-sdk/client-kms";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { AwsKmsMalwareEvidenceSignatureVerifier } from "./aws-kms-evidence-verifier.js";
import { AwsLambdaMalwareScannerTransport } from "./aws-lambda-malware-scanner-transport.js";
import { AwsS3PresigningTransport } from "./aws-s3-presigning-transport.js";
import { AwsS3PrivateObjectTransport } from "./aws-s3-private-object-transport.js";
import { FileTypeMagicByteDetector } from "./file-type-magic-byte-detector.js";
import type {
  MagicByteDetector,
  MalwareEvidenceSignatureVerifier,
  MalwareScannerTransport,
  S3PresigningTransport,
  S3PrivateObjectTransport
} from "./types.js";

export interface AwsPrivateMediaRuntimeConfig {
  readonly region: string;
  readonly bucket: string;
  readonly objectKmsKeyId: string;
  readonly scannerFunctionName: string;
  readonly scannerSigningKeyId: string;
  readonly presignedEndpointOrigins: readonly string[];
  readonly now?: () => Date;
}

export interface AwsPrivateMediaRuntime {
  readonly objects: S3PrivateObjectTransport;
  readonly signer: S3PresigningTransport;
  readonly detector: MagicByteDetector;
  readonly scanner: MalwareScannerTransport;
  readonly evidenceVerifier: MalwareEvidenceSignatureVerifier;
}

/**
 * Official AWS client composition for the API process. KMS Sign is intentionally absent: the API
 * can invoke the isolated signer and verify its evidence but cannot mint scanner evidence itself.
 */
export function createAwsPrivateMediaRuntime(
  config: AwsPrivateMediaRuntimeConfig
): AwsPrivateMediaRuntime {
  const now = config.now ?? (() => new Date());
  const s3 = new S3Client({ region: config.region });
  const kms = new KMSClient({ region: config.region });
  const lambda = new LambdaClient({ region: config.region });
  return Object.freeze({
    objects: new AwsS3PrivateObjectTransport(s3, {
      bucket: config.bucket,
      region: config.region,
      kmsKeyId: config.objectKmsKeyId
    }),
    signer: new AwsS3PresigningTransport(s3, {
      bucket: config.bucket,
      region: config.region,
      kmsKeyId: config.objectKmsKeyId,
      endpointOrigins: config.presignedEndpointOrigins,
      now
    }),
    detector: new FileTypeMagicByteDetector(),
    scanner: new AwsLambdaMalwareScannerTransport(lambda, {
      functionName: config.scannerFunctionName
    }),
    evidenceVerifier: new AwsKmsMalwareEvidenceSignatureVerifier(kms, {
      keyAlgorithms: {
        [config.scannerSigningKeyId]: ["RSASSA_PSS_SHA_256"]
      }
    })
  });
}
