import { TableClient } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type Collection = 'babies' | 'users' | 'sessions' | 'passkeys' | 'challenges' | 'events' | 'revisions' | 'pushSubscriptions' | 'reminderStates' | 'meta';

export interface Store {
  initialize(): Promise<void>;
  get<T>(collection: Collection, id: string): Promise<T | undefined>;
  list<T>(collection: Collection): Promise<T[]>;
  put<T>(collection: Collection, id: string, value: T): Promise<void>;
  remove(collection: Collection, id: string): Promise<void>;
}

export class MemoryStore implements Store {
  protected values = new Map<string, unknown>();
  async initialize() {}
  async get<T>(collection: Collection, id: string) { return this.values.get(`${collection}:${id}`) as T | undefined; }
  async list<T>(collection: Collection) {
    const prefix = `${collection}:`;
    return [...this.values.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value as T);
  }
  async put<T>(collection: Collection, id: string, value: T) { this.values.set(`${collection}:${id}`, value); }
  async remove(collection: Collection, id: string) { this.values.delete(`${collection}:${id}`); }
}

export class FileStore extends MemoryStore {
  private saveChain = Promise.resolve();
  constructor(private readonly path: string) { super(); }

  async initialize() {
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8')) as Record<string, unknown>;
      this.values = new Map(Object.entries(saved));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private persist() {
    this.saveChain = this.saveChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, JSON.stringify(Object.fromEntries(this.values), null, 2));
      await rename(temporary, this.path);
    });
    return this.saveChain;
  }

  override async put<T>(collection: Collection, id: string, value: T) {
    await super.put(collection, id, value);
    await this.persist();
  }

  override async remove(collection: Collection, id: string) {
    await super.remove(collection, id);
    await this.persist();
  }
}

export class AzureTableStore implements Store {
  private readonly client: TableClient;

  constructor() {
    const tableName = process.env.AZURE_TABLE_NAME || 'leologger';
    const connection = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (connection) this.client = TableClient.fromConnectionString(connection, tableName);
    else {
      const account = process.env.AZURE_STORAGE_ACCOUNT;
      if (!account) throw new Error('AZURE_STORAGE_ACCOUNT is required for Azure storage mode');
      this.client = new TableClient(`https://${account}.table.core.windows.net`, tableName, new DefaultAzureCredential());
    }
  }

  async initialize() { await this.client.createTable().catch((error: { statusCode?: number }) => { if (error.statusCode !== 409) throw error; }); }

  async get<T>(collection: Collection, id: string) {
    try {
      const entity = await this.client.getEntity<{ data: string }>(collection, id);
      return JSON.parse(entity.data) as T;
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) return undefined;
      throw error;
    }
  }

  async list<T>(collection: Collection) {
    const results: T[] = [];
    for await (const entity of this.client.listEntities<{ data: string }>({ queryOptions: { filter: `PartitionKey eq '${collection}'` } })) {
      results.push(JSON.parse(entity.data) as T);
    }
    return results;
  }

  async put<T>(collection: Collection, id: string, value: T) {
    await this.client.upsertEntity({ partitionKey: collection, rowKey: id, data: JSON.stringify(value) }, 'Replace');
  }

  async remove(collection: Collection, id: string) {
    await this.client.deleteEntity(collection, id).catch((error: { statusCode?: number }) => { if (error.statusCode !== 404) throw error; });
  }
}

export function createStore(): Store {
  if (process.env.STORE_MODE === 'azure') return new AzureTableStore();
  if (process.env.STORE_MODE === 'memory' || process.env.NODE_ENV === 'test') return new MemoryStore();
  return new FileStore(process.env.DATA_FILE || '.data/store.json');
}
