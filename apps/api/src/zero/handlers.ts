import type { Database } from "@fp/db";
import { createMutatorRunner, runServerMutator } from "@fp/server";
import { queries, schema } from "@fp/sync";
import { mustGetQuery } from "@rocicorp/zero";
import { handleMutateRequest, handleQueryRequest } from "@rocicorp/zero/server";

/**
 * zero-cache 把浏览器的查询和写操作转发到这里（ZERO_QUERY_URL / ZERO_MUTATE_URL），并带上浏览器的 cookie。
 * userID 由调用方从登录会话里解析好传进来。
 */
export function createZeroHandlers(database: Database) {
  const runner = createMutatorRunner(database);

  return {
    query(request: Request, userID: string) {
      return handleQueryRequest({
        schema,
        request,
        userID,
        handler: (name, args) => mustGetQuery(queries, name).fn({ args, ctx: { userID } }),
      });
    },

    mutate(request: Request, userID: string) {
      return handleMutateRequest({
        dbProvider: runner.zqlDb,
        request,
        userID,
        handler: (transact) =>
          transact(async (tx, name, args) => {
            await runServerMutator(tx, name, args, { userID });
          }),
      });
    },

    /** 在服务端直接执行 ZQL 查询（开放接口用；查询本身带权限过滤，和浏览器里一样）。 */
    zql: runner.zqlDb,

    /** 不经过 HTTP 直接在一个服务端事务里执行 mutator。测试和服务端内部调用用。 */
    run(name: string, args: unknown, userID: string) {
      return runner.run(name, args, { userID });
    },
  };
}
