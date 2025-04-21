import { createLogger, format, transports } from "winston";
import chalk from "chalk";
import DailyRotateFile from "winston-daily-rotate-file";
const { combine, colorize, timestamp, printf } = format;

const getStyle = (message: unknown, level: string): { _message: string; _level: string } => {
	switch (level) {
		case "info":
			return {
				_message: chalk.green(message),
				_level: chalk.bgGreen.bold(" INFO ")
			};
		case "error":
			return {
				_message: chalk.red(message),
				_level: chalk.bgRed.bold(" ERROR ")
			};
		case "debug":
			return {
				_message: chalk.cyan(message),
				_level: chalk.bgCyan.bold(" DEBUG ")
			};
		case "warn":
			return {
				_message: chalk.yellow(message),
				_level: chalk.bgYellow.bold(" WARN ")
			};
		default:
			return {
				_message: chalk.green(message),
				_level: chalk.bgGreen.bold("<Unknown Level")
			};
	}
};

const logFormat = printf(({ level, message, timestamp }) => {
	const { _message, _level } = getStyle(message, level);

	return `[${timestamp}] ${_level} ${_message}`;
});

const fileFormat = printf(({ level, message, timestamp }) => {
	return `[${timestamp}] ${level.toUpperCase()} ${message}`;
});

class Logger {
	private readonly _logger = createLogger({
		level: "debug",
		format: combine(timestamp(), logFormat),
		transports: [
			new transports.Console({
				format: colorize(),
				stderrLevels: ["error"]
			}),
			new DailyRotateFile({
				filename: "logs/%DATE%-error.log",
				datePattern: "YYYY-MM-DD",
				zippedArchive: true,
				level: "error",
				format: combine(
					timestamp({
						format: "YYYY-MM-DD HH:mm:ss.SSS"
					}),
					fileFormat
				)
			}),
			new DailyRotateFile({
				filename: "logs/%DATE%-all.log",
				datePattern: "YYYY-MM-DD",
				zippedArchive: true,
				format: combine(
					timestamp({
						format: "YYYY-MM-DD HH:mm:ss.SSS"
					}),
					fileFormat
				)
			})
		]
	});

	public info(text: string) {
		this._logger.log({ level: "info", message: text });
	}

	public error(text: string) {
		this._logger.log({ level: "error", message: text });
	}

	public debug(text: string) {
		this._logger.log({ level: "debug", message: text });
	}

	public warn(text: string) {
		this._logger.log({ level: "warn", message: text });
	}
}

export default new Logger();
