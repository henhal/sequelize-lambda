import {Handler} from 'aws-lambda';

interface Sequelize {
  connectionManager: {
    initPools(): void;
    close(): Promise<void>;
    getConnection?: unknown;
  }
}

function addOptions(args: any[], options: unknown) {
  for (const arg of args) {
    if (typeof arg === 'object') {
      Object.assign(arg, options);
      return;
    }
  }

  args.push(options);
}

export default class SequelizeManager {
  private static sequelize: Sequelize | undefined;
  private static readonly options = {
    pool: {
      max: 2,
      min: 0,
      idle: 0,
      acquire: 3000,
      evict: 6000 // will be overridden by approximate lambda timeout
    }
  };

  static get(): Sequelize | undefined {
    return this.sequelize;
  }

  static create<Args extends any[]>(Sequelize: new (...args: Args) => Sequelize, ...args: Args): Sequelize {
    addOptions(args, this.options);

    return this.sequelize = new Sequelize(...args);
  }

  static init(): boolean {
    const cm = this.sequelize?.connectionManager;

    if (!cm) return false;

    cm.initPools();

    // restore `getConnection()` if it has been overwritten by `close()`
    if (cm.hasOwnProperty("getConnection")) {
      delete cm.getConnection;
    }
    return true;
  }

  static async close(): Promise<boolean> {
    const cm = this.sequelize?.connectionManager;

    if (!cm) return false;

    await cm.close();
    return true;
  }

  static wrapHandler<E, R>(handler: Handler<E, R>): Handler<E, R> {
    return async (event, context) => {
      try {
        this.options.pool.evict = context.getRemainingTimeInMillis();
        this.init();
        return await handler(event, context, 0 as any) as R;
      } finally {
        await this.close();
      }
    }
  }
}