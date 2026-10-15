export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM", "SIGBREAK"];
export function installShutdownHandlers(controller, signalSource = process) {
    const stop = () => controller.abort(new Error("shutdown requested"));
    for (const signal of SHUTDOWN_SIGNALS) {
        signalSource.once(signal, stop);
    }
    return () => {
        for (const signal of SHUTDOWN_SIGNALS) {
            signalSource.removeListener(signal, stop);
        }
    };
}
//# sourceMappingURL=shutdown.js.map