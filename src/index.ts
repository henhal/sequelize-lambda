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

/**
 * A sequelize manager handling a sequelize instance with options ideal for running in AWS Lambda and handling the
 * Lambda lifecycle to re-use sequelize instances across Lambda invocations.
 */
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

  /**
   * Get the sequelize instance created by `create` or `register`` or undefined if none created yet.
   */
  static get(): Sequelize | undefined {
    return this.sequelize;
  }

  /**
   * Create a sequelize instance using the supplied constructor function with the supplied args, and
   * additional options ideal for running in AWS Lambda added to the args.
   * @param Sequelize Constructor function
   * @param args Arguments
   */
  static create<Args extends any[]>(Sequelize: new (...args: Args) => Sequelize, ...args: Args): Sequelize {
    addOptions(args, this.options);

    return this.sequelize = new Sequelize(...args);
  }

  /**
   * Create a sequelize instance using the supplied factory function which should use the supplied
   * options, ideal for running in AWS Lambda added to the args.
   * @param factory Factory function
   */
  static register(factory: (options: typeof SequelizeManager.options) => Sequelize): Sequelize {
    return this.sequelize = factory(this.options);
  }

  /**
   * Initialize any sequelize instance for a new Lambda invocation. If no instance is created/registered,
   * nothing happens.
   */
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

  /**
   * Call before finishing a Lambda invocation to close and clean up connections etc.
   */
  static async close(): Promise<boolean> {
    const cm = this.sequelize?.connectionManager;

    if (!cm) return false;

    await cm.close();
    return true;
  }

  /**
   * Wrap a Lambda handler function to automatically add calls to `init` and `close` around it.
   * @param handler
   */
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