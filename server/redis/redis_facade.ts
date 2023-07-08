import { error } from "console";
import * as Redis from "ioredis";

const defaultRedisSingleHost = "127.0.0.1:6379";
const defaultRedisClusterNodes = "127.0.0.1:6379,127.0.0.1:6380,127.0.0.1:6381,127.0.0.1:7379,127.0.0.1:7380,127.0.0.1:7381";
const redisMode = process.env.REDIS_MODE ? process.env.REDIS_MODE : "single"; // single|cluster
const redisUsername = process.env.REDIS_USERNAME ? process.env.REDIS_USERNAME : "";
const redisPassword = process.env.REDIS_PASSWORD ? process.env.REDIS_PASSWORD : "";
const redisSingleHost = (
  process.env.REDIS_SINGLE_HOST ? process.env.REDIS_SINGLE_HOST : defaultRedisSingleHost
).split(",");
const redisClusterNodes = (
  process.env.REDIS_CLUSTER_NODES ? process.env.REDIS_CLUSTER_NODES : defaultRedisClusterNodes
).split(",");

export default class RedisFacade {
  private static defaultInstance: RedisFacade;
  private redisCluster;
  private redis;

  public static getDefault() {
    if (!RedisFacade.defaultInstance) {
      RedisFacade.defaultInstance = new RedisFacade();
    }
    return RedisFacade.defaultInstance;
  }

  private constructor() {
    if (redisMode === "cluster") {
      console.info("Connecting redis cluster:", redisClusterNodes);
      const clusterNodes = redisClusterNodes.map((node) => {
        const [host, port] = node.split(":");
        return { host, port: parseInt(port) };
      });
      this.redisCluster = new Redis.Cluster(clusterNodes, {
        redisOptions: {
          username: redisUsername,
          password: redisPassword,
          db: 0,
          autoResubscribe: true,
          connectTimeout: 10000,
          commandTimeout: 10000,
          maxRetriesPerRequest: 20,
          monitor: false, // Error: Connection is in monitoring mode, can't process commands
        },
      });
    } else if (redisMode === "single") {
      console.info("Connecting redis single:", redisSingleHost);
      const [host, port] = redisSingleHost[0].split(":");
      this.redis = new Redis.Redis({
        host,
        port: parseInt(port),
        username: redisUsername,
        password: redisPassword,
        autoResubscribe: true,
        connectTimeout: 10000,
        commandTimeout: 10000,
        maxRetriesPerRequest: 20,
        monitor: false, // Error: Connection is in monitoring mode, can't process commands
      });
    } else {
      throw new Error("Invalid redis mode " + redisMode);
    }
  }

  public getRedisClient() {
    if (this.redisCluster) {
      return this.redisCluster;
    } else if (this.redis) {
      return this.redis;
    } else {
      throw new Error("Could't getting redis client");
    }
  }

  public async set(key: string, value: string) {
    try {
        await this.getRedisClient().set(key, value);
        console.log("set redis success. Key:", key, ":", value);
    } catch (error) {
      console.error("Error setting key:", key, "Error:", error);
    }
  }

  public async get(key: string) {
    try {
        const value = await this.getRedisClient().get(key);
        console.log("get redis success. Key:", key, ":", value);
        return value;
    } catch (error) {
      console.error("Error getting key:", key, "Error:", error);
    }
  }

  public async del(key: string) {
    try {
        await this.getRedisClient().del(key);
        console.log("delete redis success. Key:", key);
    } catch (error) {
      console.error("Error delete key:", key, "Error:", error);
    }
  }
}

// module.exports = RedisFacade;