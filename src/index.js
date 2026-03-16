import React from 'react';
import {render} from 'ink';
import {App} from './app.js';
import {parseCliConfig} from './config.js';
import {EXIT_FAILURE} from './exit-codes.js';
import {executeAuthCommand, formatTopLevelError, resolveRunConfig} from './commands.js';

async function main() {
	const parsedConfig = parseCliConfig();

	if (!parsedConfig.ok) {
		const output = parsedConfig.exitCode === 0 ? process.stdout : process.stderr;
		output.write(`${parsedConfig.message}\n`);
		process.exit(parsedConfig.exitCode);
	}

	if (parsedConfig.command.type !== 'run') {
		const exitCode = await executeAuthCommand(parsedConfig.command);
		process.exit(exitCode);
	}

	const runtimeConfig = await resolveRunConfig(parsedConfig.command);
	const exitCode = await new Promise((resolve) => {
		let renderer;

		renderer = render(React.createElement(App, {
			config: runtimeConfig,
			onComplete(code) {
				resolve(code);
				renderer.unmount();
			}
		}));
	});

	process.exit(exitCode);
}

main().catch((error) => {
	process.stderr.write(`${formatTopLevelError(error)}\n`);
	process.exit(EXIT_FAILURE);
});
