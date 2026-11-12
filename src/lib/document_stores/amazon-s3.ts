import log from '../log.js';
import { loadModule } from '../optional-client.js';
import type { DocumentStore, StorageOptions, StoreCallback } from '../types.js';

interface S3Client {
  getObject(params: unknown): Promise<{ Body: { toString(encoding: string): string } }>;
  putObject(params: unknown): Promise<unknown>;
}

// The AWS SDK is imported lazily: a deployment that does not select this store
// never needs the package installed.
export default class AmazonS3DocumentStore implements DocumentStore {
  private readonly expire: number | string | false | undefined;
  private readonly bucket: string | undefined;
  private readonly region: string | undefined;
  private clientPromise: Promise<S3Client> | null = null;

  constructor(options: StorageOptions, client?: unknown) {
    // Only redis takes a pre-built client; every other store builds its own.
    void client;
    this.expire = options.expire;
    this.bucket = options.bucket;
    this.region = options.region;
    this.clientPromise = null;
  }

  client(): Promise<S3Client> {
    if (!this.clientPromise) {
      this.clientPromise = loadModule<{
        default: { S3: new (options: unknown) => S3Client };
      }>('aws-sdk', import.meta.url).then(({ default: AWS }) => {
        const s3 = new AWS.S3({ region: this.region });
        return {
          getObject: (params) => s3.getObject(params),
          putObject: (params) => s3.putObject(params)
        };
      });
    }
    return this.clientPromise;
  }

  get(key: string, callback: StoreCallback<string | false>, skipExpire: boolean): void {
    this.client()
      .then((client) => client.getObject({ Bucket: this.bucket, Key: key }))
      .then((data) => {
        callback(data.Body.toString('utf-8'));
        if (this.expire && !skipExpire) {
          log.warn({}, 'amazon s3 store cannot set expirations on keys');
        }
      })
      .catch(() => callback(false));
  }

  set(key: string, data: string, callback: StoreCallback<boolean>, skipExpire?: boolean): void {
    this.client()
      .then((client) =>
        client.putObject({
          Bucket: this.bucket,
          Key: key,
          Body: data,
          ContentType: 'text/plain'
        })
      )
      .then(() => {
        callback(true);
        if (this.expire && !skipExpire) {
          log.warn({}, 'amazon s3 store cannot set expirations on keys');
        }
      })
      .catch(() => callback(false));
  }
}
