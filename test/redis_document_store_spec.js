import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

// The Redis store needs a live server. Rather than hang forever when one is
// absent (as the old mocha suite did), probe the port first and skip: the run
// then finishes everywhere with an explicit `# SKIP` instead of timing out.
const redisReachable = () =>
  new Promise((resolve) => {
    const socket = net.connect(6379, '127.0.0.1');
    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });

const reachable = await redisReachable();

describe(
  'redis_document_store',
  {
    skip: reachable ? false : 'redis not reachable on 127.0.0.1:6379'
  },
  () => {
    let RedisDocumentStore;

    before(async () => {
      ({ default: RedisDocumentStore } = await import('../dist/lib/document_stores/redis.js'));
    });

    after(async () => {
      if (RedisDocumentStore && RedisDocumentStore.client) {
        await RedisDocumentStore.client.quit();
        RedisDocumentStore.client = false;
      }
    });

    describe('set', () => {
      it('should be able to set a key and have an expiration set', async () => {
        const store = new RedisDocumentStore({ expire: 10 });
        const stored = await new Promise((resolve) => store.set('hello1', 'world', resolve));
        assert.equal(stored, true);

        const ttl = await RedisDocumentStore.client.ttl('hello1');
        assert.ok(ttl > 1);
      });

      it('should not set an expiration when told not to', async () => {
        const store = new RedisDocumentStore({ expire: 10 });
        const stored = await new Promise((resolve) => store.set('hello2', 'world', resolve, true));
        assert.equal(stored, true);

        assert.equal(await RedisDocumentStore.client.ttl('hello2'), -1);
      });

      it('should not set an expiration when expiration is off', async () => {
        const store = new RedisDocumentStore({ expire: false });
        const stored = await new Promise((resolve) => store.set('hello3', 'world', resolve));
        assert.equal(stored, true);

        assert.equal(await RedisDocumentStore.client.ttl('hello3'), -1);
      });
    });
  }
);
