import { WakeDispatcher } from "./runtime/dispatcher.js";
import { GardenSseClient, GardenStreamError, } from "./sse/client.js";
function runtimeWakeFromEvent(event, messageMap) {
    return {
        reason: event.reason,
        message: messageMap[event.reason] ?? event.message,
    };
}
export async function runBridge(config, adapter, logger, signal, dependencies = {}) {
    const client = dependencies.createClient?.() ??
        new GardenSseClient({
            baseUrl: config.baseUrl,
            machineToken: config.machineToken,
            connectTimeoutMs: config.timeouts.connectMs,
            logger,
        });
    const dispatcher = new WakeDispatcher(adapter, logger, {
        deliveryTimeoutMs: config.timeouts.runtimeDeliveryMs,
        closeTimeoutMs: config.timeouts.runtimeCloseMs,
    });
    const reportedDiagnostics = new Set();
    try {
        logger.info("connecting to Garden SSE", { origin: config.baseUrl.origin });
        const result = await client.streamOnce({
            onEvent: (event) => {
                if (event.kind === "connected") {
                    logger.info("Garden SSE connected", { protocolVersion: event.version });
                }
                else {
                    dispatcher.enqueue(runtimeWakeFromEvent(event, config.wakeMessageMap));
                }
            },
            onIgnored: (diagnostic) => {
                if (reportedDiagnostics.has(diagnostic.cause)) {
                    return;
                }
                reportedDiagnostics.add(diagnostic.cause);
                logger[diagnostic.severity === "warn" ? "warn" : "debug"]("ignored Garden SSE event", { cause: diagnostic.cause });
            },
        }, signal);
        if (signal.aborted || result.stopped) {
            return;
        }
        await dispatcher.idle();
        throw new GardenStreamError("terminal", result.connected
            ? "Garden SSE stream ended; restart the bridge manually after checking Garden status"
            : "Garden SSE stream ended before the connected event");
    }
    finally {
        await dispatcher.close();
    }
}
//# sourceMappingURL=runner.js.map