import readline from 'node:readline';

export async function promptText(label) {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error(`Missing required value for ${label}. Provide it as a flag or environment variable.`);
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

	return await new Promise((resolve) => {
		rl.question(`${label}: `, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

export async function promptSecret(label) {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error(`Missing required value for ${label}. Provide it as a flag or environment variable.`);
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

	rl.stdoutMuted = true;
	rl._writeToOutput = function _writeToOutput(stringToWrite) {
		if (rl.stdoutMuted) {
			if (stringToWrite.includes('\n')) {
				rl.output.write('\n');
				return;
			}

			rl.output.write('*');
			return;
		}

		rl.output.write(stringToWrite);
	};

	return await new Promise((resolve) => {
		rl.stdoutMuted = false;
		rl.output.write(`${label}: `);
		rl.stdoutMuted = true;
		rl.question('', (answer) => {
			rl.output.write('\n');
			rl.close();
			resolve(answer.trim());
		});
	});
}
