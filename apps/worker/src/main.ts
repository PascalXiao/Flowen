import { connect } from "@fp/db";
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { config } from "./config.ts";
import { CLOCK_WORKFLOW_ID } from "./shared.ts";
import { connectTemporal, createWorker } from "./worker.ts";

const database = connect(config.databaseUrl);
const connection = await connectTemporal();
const worker = await createWorker(database, connection);

// 自动化时钟全局只跑一个：已经在跑就不再启动
const clientConnection = await Connection.connect({ address: config.temporalAddress });
try {
  await new Client({ connection: clientConnection, namespace: config.temporalNamespace }).workflow.start(
    "automationClockWorkflow",
    { workflowId: CLOCK_WORKFLOW_ID, taskQueue: config.taskQueue },
  );
} catch (error) {
  if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
} finally {
  await clientConnection.close();
}
console.log(`Temporal worker 已启动：${config.temporalAddress} / ${config.taskQueue}`);
try {
  await worker.run();
} finally {
  await connection.close();
  await database.close();
}
