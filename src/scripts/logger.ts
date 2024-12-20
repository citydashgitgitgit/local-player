// import fs from "fs";
// import moment from "moment";
const LOG_FILE_PATH = process.env.NEXT_PUBLIC_LOG_FILE_PATH || "./logs.txt";

export const enum MESSAGE_TYPES {
	INFO = "INFO",
	ERROR = "ERROR",
}

export const writeLog = (type: MESSAGE_TYPES, message: string) : void => {
	// const text = `[${moment().format("DD/MM/YYYY HH:mm:ss")}] ${type}: ${message} \n`;
	// fs.appendFileSync(LOG_FILE_PATH, text);
}