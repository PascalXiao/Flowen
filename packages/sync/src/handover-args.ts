import { z } from "zod";

/** 工作移交的参数（单独一个文件：mutators.ts 注册 mutator 时要用，而 handover.ts 又依赖 mutators.ts）。 */
export const handoverArgs = z.object({
  spaceId: z.string(),
  fromUserId: z.string(),
  toUserId: z.string(),
  roles: z.boolean().default(true),
  fields: z.boolean().default(true),
  tasks: z.boolean().default(true),
});
