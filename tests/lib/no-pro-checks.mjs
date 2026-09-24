/**
 * The no-pro battery's checks: which tool each calls, and the condition over
 * the tool's reply that decides whether it held. Every condition can fail.
 * The battery script supplies the server connection, each call's timeout and
 * the printing; scoring is `battery-score.mjs`'s.
 */

import { runCheck, scoreCheck } from "./battery-score.mjs";

/** @typedef {import("./battery-score.mjs").ProbeOutcome} ProbeOutcome */
/** @typedef {import("./battery-score.mjs").ScoredCheck} ScoredCheck */

/** @typedef {{ type: string, text?: string, [key: string]: unknown }} ReplyContent */

/** @typedef {{ content?: ReplyContent[], isError?: boolean }} ToolReply */

/**
 * Calls one tool on the server under test; rejects on a crash or a timeout.
 * @typedef {(name: string, args: Record<string, unknown>, timeoutMs: number) => Promise<ToolReply>} CallTool
 */

/** @typedef {{ id: string, probe: (callTool: CallTool) => Promise<ProbeOutcome> }} NoProCheck */

/**
 * The debug port the server under test uses, and whether Comet answers on it.
 * @typedef {{ port: number, answers: () => Promise<boolean> }} DebugPort
 */

const SERVER_DEFAULT_PORT = 9223;

const INVALID_MODE = "invalid_mode_xyz";

/**
 * The server's debug port: `COMET_PORT` when it is a valid port, otherwise
 * 9223, the same rule the server applies.
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
export function debugPortFromEnv(env) {
  const port = Number.parseInt(env.COMET_PORT ?? "", 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? port
    : SERVER_DEFAULT_PORT;
}

/** @param {ToolReply} reply */
function replyText(reply) {
  return (reply.content ?? [])
    .map((item) => (item.type === "text" ? item.text : ""))
    .join("\n");
}

/** @param {ToolReply} reply */
function succeeded(reply) {
  return reply.isError !== true;
}

/**
 * [1.2]: connect returned no error and says it connected, started or running.
 * @param {ToolReply} reply
 */
export function connected(reply) {
  return (
    succeeded(reply) && /connected|started|running/i.test(replyText(reply))
  );
}

/**
 * [5.1]: an image, or a text long enough to carry one.
 * @param {ToolReply} reply
 */
export function hasScreenshot(reply) {
  return (reply.content ?? []).some(
    (item) =>
      item.type === "image" ||
      (item.type === "text" && (item.text?.length ?? 0) > 100),
  );
}

/**
 * [6.1]: the tab listing returned no error.
 * @param {ToolReply} reply
 */
export function tabsListed(reply) {
  return succeeded(reply);
}

/**
 * [7.1], [7.3-reconnect]: the reply names a mode.
 * @param {ToolReply} reply
 */
export function reportsMode(reply) {
  return /search|research|labs|learn/i.test(replyText(reply));
}

/**
 * [7.2-<mode>]: the reply says the switch to that mode happened.
 * @param {string} mode
 * @param {ToolReply} reply
 */
export function switchedTo(mode, reply) {
  return (
    succeeded(reply) &&
    replyText(reply).trim().toLowerCase().startsWith(`switched to ${mode} mode`)
  );
}

/**
 * [9.4]: the invalid mode is an error result, and the server still answers
 * the next call.
 * @param {ToolReply} invalidModeReply
 * @param {ToolReply} nextReply
 */
export function invalidModeHandled(invalidModeReply, nextReply) {
  return (
    !succeeded(invalidModeReply) &&
    succeeded(nextReply) &&
    reportsMode(nextReply)
  );
}

/**
 * @param {ToolReply} reply
 * @param {number} length
 */
function excerpt(reply, length) {
  return replyText(reply).slice(0, length);
}

/**
 * @param {string} id
 * @param {string} tool
 * @param {Record<string, unknown>} args
 * @param {number} timeoutMs
 * @param {(reply: ToolReply) => ProbeOutcome} judge
 * @returns {NoProCheck}
 */
function singleCall(id, tool, args, timeoutMs, judge) {
  return {
    id,
    probe: async (callTool) => judge(await callTool(tool, args, timeoutMs)),
  };
}

/** @param {string} mode */
function modeSwitch(mode) {
  return singleCall(`7.2-${mode}`, "comet_mode", { mode }, 20000, (reply) => ({
    held: switchedTo(mode, reply),
    note: excerpt(reply, 60),
  }));
}

/**
 * [1.2]: Comet already answers on the server's debug port, and connect
 * succeeds. Without the port, no tool is called: connect would launch Comet,
 * or kill and relaunch one running on another port.
 * @param {DebugPort} debugPort
 * @returns {NoProCheck}
 */
function connectCheck(debugPort) {
  const connect = singleCall("1.2", "comet_connect", {}, 30000, (reply) => ({
    held: connected(reply),
    note: excerpt(reply, 80),
  }));
  return {
    id: connect.id,
    probe: async (callTool) =>
      (await debugPort.answers())
        ? connect.probe(callTool)
        : {
            held: false,
            note: `Comet is not running with its debug port on ${debugPort.port}`,
          },
  };
}

/** @type {NoProCheck} */
const INVALID_MODE_REJECTED = {
  id: "9.4",
  probe: async (callTool) => {
    const invalid = await callTool("comet_mode", { mode: INVALID_MODE }, 15000);
    const next = await callTool("comet_mode", {}, 10000);
    return {
      held: invalidModeHandled(invalid, next),
      note: `${excerpt(invalid, 60)} / then: ${excerpt(next, 30)}`,
    };
  },
};

/**
 * The checks after connect, in the order they run.
 * @type {readonly NoProCheck[]}
 */
const AFTER_CONNECT = [
  singleCall("5.1", "comet_screenshot", {}, 15000, (reply) => ({
    held: hasScreenshot(reply),
    note: hasScreenshot(reply)
      ? "non-empty screenshot"
      : JSON.stringify(reply.content).slice(0, 80),
  })),
  singleCall("6.1", "comet_tabs", {}, 10000, (reply) => ({
    held: tabsListed(reply),
    note: excerpt(reply, 80),
  })),
  singleCall("7.1", "comet_mode", {}, 15000, (reply) => ({
    held: reportsMode(reply),
    note: excerpt(reply, 60),
  })),
  ...["research", "labs", "learn", "search"].map(modeSwitch),
  singleCall("7.3-reconnect", "comet_mode", {}, 10000, (reply) => ({
    held: reportsMode(reply),
    note: excerpt(reply, 60),
  })),
  INVALID_MODE_REJECTED,
];

/**
 * @param {NoProCheck} check
 * @param {CallTool} callTool
 */
async function scored(check, callTool) {
  return scoreCheck(await runCheck(check.id, () => check.probe(callTool)));
}

/** @param {NoProCheck} check */
function notRun(check) {
  return scoreCheck({
    id: check.id,
    held: false,
    note: "not run: [1.2] connect failed",
  });
}

/**
 * Runs the battery against a server. When [1.2] fails, the other checks
 * are not run, and each is scored as failed: nothing passes without a
 * connection, and no call reaches a browser the battery could not connect to.
 * @param {CallTool} callTool
 * @param {DebugPort} debugPort
 * @param {(check: ScoredCheck) => void} [report] called as each check is scored
 * @returns {Promise<ScoredCheck[]>}
 */
export async function runNoProBattery(callTool, debugPort, report = () => {}) {
  const connect = await scored(connectCheck(debugPort), callTool);
  report(connect);
  const checks = [connect];
  const connectHeld = connect.verdict === "PASS";
  for (const check of AFTER_CONNECT) {
    const result = connectHeld ? await scored(check, callTool) : notRun(check);
    report(result);
    checks.push(result);
  }
  return checks;
}
