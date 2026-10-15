import { ConfigError } from "../config.js";
import { CommandInjectorAdapter } from "./command-injector-adapter.js";
export function createRuntimeAdapter(config, logger) {
    if (!config.injector.executable) {
        throw new ConfigError("GARDEN_INJECTOR_EXECUTABLE is required for the run command");
    }
    return new CommandInjectorAdapter({
        executable: config.injector.executable,
        args: config.injector.args,
        workingDirectory: config.injector.workingDirectory,
    }, logger);
}
//# sourceMappingURL=create-adapter.js.map