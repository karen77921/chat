import { spawn } from "node:child_process";
const MAX_STDERR_LENGTH = 8_192;
const spawnInjector = (executable, args, options) => spawn(executable, [...args], options);
export class InjectorDeliveryError extends Error {
    constructor(message) {
        super(message);
        this.name = "InjectorDeliveryError";
    }
}
export class CommandInjectorAdapter {
    #config;
    #logger;
    #spawn;
    constructor(config, logger, spawnImpl = spawnInjector) {
        this.#config = config;
        this.#logger = logger;
        this.#spawn = spawnImpl;
    }
    async wake(input) {
        input.signal.throwIfAborted();
        this.#logger.info("starting injector delivery", { reason: input.reason });
        await new Promise((resolve, reject) => {
            const childEnv = { ...process.env };
            delete childEnv.GARDEN_MACHINE_TOKEN;
            const child = this.#spawn(this.#config.executable, this.#config.args, {
                ...(this.#config.workingDirectory
                    ? { cwd: this.#config.workingDirectory }
                    : {}),
                env: childEnv,
                shell: false,
                signal: input.signal,
                stdio: ["pipe", "ignore", "pipe"],
            });
            let stderr = "";
            let settled = false;
            const finish = (error) => {
                if (settled)
                    return;
                settled = true;
                error ? reject(error) : resolve();
            };
            child.stderr.setEncoding("utf8");
            child.stderr.on("data", (chunk) => {
                stderr = (stderr + chunk).slice(-MAX_STDERR_LENGTH);
            });
            child.stdin.on("error", () => undefined);
            child.once("error", (error) => finish(error));
            child.once("exit", (code, signal) => {
                if (code === 0) {
                    finish();
                    return;
                }
                const details = stderr.trim();
                finish(new InjectorDeliveryError(`injector exited with code ${String(code)}, signal ${String(signal)}` +
                    (details ? `: ${details}` : "")));
            });
            const payload = {
                version: 1,
                type: "garden_wake",
                reason: input.reason,
                message: input.message,
            };
            try {
                child.stdin.end(`${JSON.stringify(payload)}\n`, "utf8");
            }
            catch (error) {
                child.kill();
                finish(error instanceof Error ? error : new Error(String(error)));
            }
        });
        this.#logger.info("injector delivery completed", { reason: input.reason });
    }
}
//# sourceMappingURL=command-injector-adapter.js.map