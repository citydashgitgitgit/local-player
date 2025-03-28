import type {NextApiRequest, NextApiResponse} from "next";
import axios from "axios";
import fs from "fs";
import AWS from "aws-sdk";
import path from "path";
import {MESSAGE_TYPES, writeLog} from "@/scripts/logger";
import {adObjectIdFilePath} from "@/pages/api/checkPlayerId";
const appRoot = require('app-root-path');
import { createHash } from 'crypto';

const playerContentFolder = process.env.NEXT_PUBLIC_PLAYER_CONTENT_FOLDER || "./player_content";

// Кэш текущих загрузок
const downloadInProgress: { [key: string]: Promise<boolean> } = {};

async function downloadContent(fileName: string) {
	writeLog(MESSAGE_TYPES.INFO, `File ${fileName} is downloading locally...`);
	try {
		const spacesEndpoint = process.env.NEXT_PUBLIC_SPACE_ENDPOINT;
		const s3 = new AWS.S3({
			endpoint: spacesEndpoint,
			accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID,
			secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY,
		});

		const params = {
			Bucket: process.env.NEXT_PUBLIC_AWS_BUCKET_NAME,
			Key: "dev/" + fileName,
		};

		const savePath = path.resolve(playerContentFolder, fileName);
		const folderForFile = savePath.split('/').slice(0, -1).join('/');
		if (!fs.existsSync(folderForFile)) {
			fs.mkdirSync(folderForFile);
		}

		return new Promise((resolve, reject) => {
			const fileStream = fs.createWriteStream(savePath);

			//@ts-ignore
			s3.getObject(params)
				.createReadStream()
				.pipe(fileStream)
				.on('error', (err) => {
					reject(new Error(`Error downloading file: ${err.message}`));
				})
				.on('close', () => {
					resolve(true);
				})
		})
	} catch(error) {
		// @ts-ignore
		throw Error(error.message);
	}
}

async function downloadContentWithResume(fileName: string) {
	const spacesEndpoint = process.env.NEXT_PUBLIC_SPACE_ENDPOINT;
	const s3 = new AWS.S3({
		endpoint: spacesEndpoint,
		accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID,
		secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY,
	});

	const params = {
		Bucket: process.env.NEXT_PUBLIC_AWS_BUCKET_NAME,
		Key: "dev/" + fileName,
	};

	const savePath = path.resolve(playerContentFolder, fileName);
	const tempPath = `${savePath}.download`;
	const folderForFile = path.dirname(savePath);

	// Создаем папку, если она не существует
	if (!fs.existsSync(folderForFile)) {
		fs.mkdirSync(folderForFile, { recursive: true });
	}

	return new Promise(async (resolve, reject) => {
		try {
			// Получаем информацию о файле в S3
			const headData = await s3.headObject(params).promise();
			const fileSize = headData.ContentLength;

			// Проверяем существующий файл
			let downloadedBytes = 0;
			if (fs.existsSync(tempPath)) {
				const stats = fs.statSync(tempPath);
				downloadedBytes = stats.size;
			}

			// Если файл уже полностью скачан, просто переименовываем
			if (downloadedBytes === fileSize) {
				fs.renameSync(tempPath, savePath);
				resolve(true);
				return;
			}

			// Настройка параметров загрузки с возобновлением
			const downloadParams = {
				...params,
				Range: `bytes=${downloadedBytes}-`
			};

			// Создаем поток для дозагрузки
			const writeStream = fs.createWriteStream(tempPath, { flags: 'a' });

			const downloadStream = s3.getObject(downloadParams).createReadStream();

			downloadStream.on('data', (chunk) => {
				writeStream.write(chunk);
			});

			downloadStream.on('end', () => {
				writeStream.end();
				// Переименовываем временный файл в финальный
				fs.renameSync(tempPath, savePath);
				resolve(true);
			});

			downloadStream.on('error', (err) => {
				writeStream.end();
				reject(new Error(`Download error: ${err.message}`));
			});

		} catch (error) {
			reject(new Error(`Preparation error: ${error.message}`));
		}
	});
}

export function removeUnnecessaryFiles() {
	const pathToCheck = process.env.NEXT_PUBLIC_PLAYER_CONTENT_FOLDER;
	const itemsInFolder = fs.readdirSync(pathToCheck);
	const fileNames = [];

	for (const item of itemsInFolder) {
		if (fs.lstatSync(`${pathToCheck}/${item}`).isFile()){
			fileNames.push(`${pathToCheck}/${item}`);
		} else if (fs.lstatSync(`${pathToCheck}/${item}`).isDirectory()){
			for (const file of fs.readdirSync(`${pathToCheck}/${item}`)) {
				fileNames.push(`${pathToCheck}/${item}/${file}`);
			}
		}
	}

	const necessaryFileNames = JSON.parse(fs.readFileSync("./board_meta/playlist.json").toString() || "[]");

	console.log("Removing unnecessary files...");
	console.log("Necessary files are", necessaryFileNames);
	for (const fileName of fileNames) {
		if (!necessaryFileNames.some((necessaryFileName: string) => necessaryFileName.includes(fileName.replace(".", "")))){
			writeLog(MESSAGE_TYPES.INFO, `File ${fileName} is not necessary anymore, deleting...`);
			fs.unlink(fileName, (err) => {
				if (err) {
					writeLog(MESSAGE_TYPES.ERROR, "Error deleting file " + fileName);
				}
			});
		}
	}
}

async function downloadNecessaryFiles(necessaryFileNames: { userUuid: string, fileName: string }[]) {
	const asyncDownloads: Promise<boolean>[] = [];

	for (const file of necessaryFileNames) {
		const fullFileName = `${file.userUuid}${file.fileName}`;
		const filePath = path.resolve(playerContentFolder, fullFileName);

		// Создаем уникальный ключ для файла
		const fileKey = createHash('md5').update(fullFileName).digest('hex');

		// Проверяем существование файла
		if (!fs.existsSync(filePath)) {
			// Если загрузка этого файла еще не идет
			if (!downloadInProgress[fileKey]) {
				console.log(`Downloading file: ${fullFileName}`);

				// Создаем обещание загрузки и кэшируем его
				const downloadPromise = downloadContentWithResume(fullFileName)
					.then(result => {
						// Удаляем запись о загрузке после завершения
						delete downloadInProgress[fileKey];
						return result;
					})
					.catch(error => {
						// Удаляем запись о загрузке в случае ошибки
						delete downloadInProgress[fileKey];
						throw error;
					});

				downloadInProgress[fileKey] = downloadPromise;
				asyncDownloads.push(downloadPromise);
			} else {
				console.log(`Download already in progress for: ${fullFileName}`);
				// Если загрузка уже идет, добавляем существующее обещание
				asyncDownloads.push(downloadInProgress[fileKey]);
			}
		} else {
			console.log(`File already exists: ${fullFileName}`);
		}
	}

	return Promise.all(asyncDownloads);
}

async function checkCurrentPlaylist({ playlist }) {
	const playlistContentFiles = [];
	for (const item of playlist) {
		const fileUrl = item.url;
		const contentUserUuid = item.userUuid;
		playlistContentFiles.push({
			userUuid: contentUserUuid,
			fileName: fileUrl.split(contentUserUuid)[1],
		});
	}

	await downloadNecessaryFiles(playlistContentFiles);

	let baseFolder = process.env.NEXT_PUBLIC_PLAYER_CONTENT_FOLDER;
	//@ts-ignore
	baseFolder = baseFolder.replace(".", "");

	return playlistContentFiles.map(file => `${appRoot.path}${baseFolder}/${file.userUuid}${file.fileName}`);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method === 'GET') {
		let playlist;
		let adObject;
		try {
			const adObjectUuid = fs.readFileSync(adObjectIdFilePath, "utf8");
			const response = await axios.post(
				process.env.NEXT_PUBLIC_SERVER_URL + "/get-drum-playlist-by-ad-object-uuid/" + adObjectUuid,
				{ timestamp: new Date().getTime() },
				{
					headers: {
						"Content-Type": "application/json",
						"Range": "bytes=0-500000"
					}
				}
			);

			console.log("received data from citydash server. Sending to player.");
			playlist = await checkCurrentPlaylist(response.data);
			adObject = response.data.adObject;

			// fs.writeFileSync("./board_meta/adObject.json", JSON.stringify(response.data.adObject));
			res.send({ adObject, playlist });
		} catch (error) {
			console.log("couldn't receive data from citydash server. Trying to read from local files");
			console.log("error", error);
			playlist = JSON.parse(fs.readFileSync("board_meta/playlist.json", "utf8") || "[]");
			adObject = JSON.parse(fs.readFileSync("board_meta/adObject.json", "utf8") || "{}");

			res.send({ adObject, playlist });
		}
	} else {
		res.status(405).json({ error: 'Метод не разрешён' });
	}
}
