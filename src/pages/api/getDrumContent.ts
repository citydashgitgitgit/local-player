import type {NextApiRequest, NextApiResponse} from "next";
import axios from "axios";
import fs from "fs";
import AWS from "aws-sdk";
import path from "path";
import {MESSAGE_TYPES, writeLog} from "@/scripts/logger";
const appRoot = require('app-root-path');

const playerContentFolder = process.env.NEXT_PUBLIC_PLAYER_CONTENT_FOLDER || "./player_content";

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

function removeUnnecessaryFiles(necessaryFiles: { userUuid: string, fileName: string }[]) {
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

	const necessaryFileNames = necessaryFiles.map(file => `${pathToCheck}/${file.userUuid}${file.fileName}`);

	for (const fileName of fileNames) {
		if (!necessaryFileNames.includes(fileName)){
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
	const asyncDownloads = [];

	necessaryFileNames.forEach(file => {
		fs.stat(`${playerContentFolder}/${file.userUuid}${file.fileName}`, (err, stats) => {
			if (err?.code === "ENOENT") {
				asyncDownloads.push(downloadContent(`${file.userUuid}${file.fileName}`));
			}
		})
	})

	return await Promise.all(asyncDownloads);
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
	removeUnnecessaryFiles(playlistContentFiles);


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
			const response = await axios.post(
				process.env.NEXT_PUBLIC_SERVER_URL + "/get-drum-playlist-by-ad-object-uuid/" + process.env.NEXT_PUBLIC_AD_OBJECT_UUID,
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
			fs.writeFileSync("playlist.json", JSON.stringify(playlist));
			fs.writeFileSync("adObject.json", JSON.stringify(response.data.adObject));
			res.send({ adObject, playlist });
		} catch (error) {
			console.log("couldn't receive data from citydash server. Trying to read from local files");
			playlist = JSON.parse(fs.readFileSync("playlist.json", "utf8") || "[]");
			adObject = JSON.parse(fs.readFileSync("adObject.json", "utf8") || "{}");

			res.send({ adObject, playlist });
		}
	} else {
		res.status(405).json({ error: 'Метод не разрешён' });
	}
}
