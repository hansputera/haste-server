import log from '../log.js';
import { loadModule } from '../optional-client.js';
import type { DocumentStore, StorageOptions, StoreCallback } from '../types.js';

// Minimal structural view of `@aws-sdk/client-s3` (AWS SDK for JavaScript v3),
// which is an optional client only installed by deployments that select this
// store.
//
// v2 (`aws-sdk`) reached end-of-support; v3 is the maintained line and takes a
// command object per call instead of a promise-returning method per operation.
interface S3Command {
  readonly input: unknown;
}
interface S3Response {
  Body?: { transformToString(encoding?: string): Promise<string> };
}
interface S3ClientInstance {
  send(command: S3Command): Promise<S3Response>;
}
interface S3Module {
  S3Client: new (options: { region?: string }) => S3ClientInstance;
  GetObjectCommand: new (input: { Bucket?: string; Key: string }) => S3Command;
  PutObjectCommand: new (input: {
    Bucket?: string;
    Key: string;
    Body: string;
    ContentType: string;
  }) => S3Command;
}

// The AWS SDK is imported lazily: a deployment that does not select this store
// never needs the package installed.
export default class AmazonS3DocumentStore implements DocumentStore {
  private readonly expire: number | string | false | undefined;
  private readonly bucket: string | undefined;
  private readonly region: string | undefined;
  private clientPromise: Promise<{ client: S3ClientInstance; module: S3Module }> | null = null;

  constructor(options: StorageOptions, client?: unknown) {
    // Only redis takes a pre-built client; every other store builds its own.
    void client;
    this.expire = options.expire;
    this.bucket = options.bucket;
    this.region = options.region;
    this.clientPromise = null;
  }

  client(): Promise<{ client: S3ClientInstance; module: S3Module }> {
    if (!this.clientPromise) {
      this.clientPromise = loadModule<S3Module>('@aws-sdk/client-s3').then((module) => {
        const client = new module.S3Client({ region: this.region });
        return { client, module };
      });
    }
    return this.clientPromise;
  }

  get(key: string, callback: StoreCallback<string | false>, skipExpire: boolean): void {
    this.client()
      .then(async ({ client, module }) => {
        const response = await client.send(
          new module.GetObjectCommand({ Bucket: this.bucket, Key: key })
        );
        const body = response.Body;

        if (!body) return callback(false);

        callback(await body.transformToString('utf-8'));
        if (this.expire && !skipExpire) {
          log.warn({}, 'amazon s3 store cannot set expirations on keys');
        }
      })
      .catch(() => callback(false));
  }

  set(key: string, data: string, callback: StoreCallback<boolean>, skipExpire?: boolean): void {
    this.client()
      .then(async ({ client, module }) => {
        await client.send(
          new module.PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: data,
            ContentType: 'text/plain'
          })
        );

        callback(true);
        if (this.expire && !skipExpire) {
          log.warn({}, 'amazon s3 store cannot set expirations on keys');
        }
      })
      .catch(() => callback(false));
  }
}
