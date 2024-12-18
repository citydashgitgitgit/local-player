import type {NextApiRequest, NextApiResponse} from "next";
import axios from "axios";
import fs from "fs";
import AWS from "aws-sdk";
import path from "path";

const playerContentFolder = process.env.NEXT_PUBLIC_PLAYER_CONTENT_FOLDER || "./player_content";

function downloadContent(fileName: string) {
	console.log(`File ${fileName} is downloading locally...`);
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

		const fileStream = fs.createWriteStream(savePath);

		//@ts-ignore
		s3.getObject(params)
			.createReadStream()
			.pipe(fileStream)
			.on('error', (err) => {
				throw Error(err.message);
			});
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
			console.log(`File ${fileName} is not necessary anymore, deleting...`);
			fs.unlink(fileName, (err) => {
				if (err) {
					console.log("Error deleting file", fileName);
				}
			});
		}
	}
}

function downloadNecessaryFiles(necessaryFileNames: { userUuid: string, fileName: string }[]) {
	for (const file of necessaryFileNames) {
		console.log(`ckecking ${playerContentFolder}/${file.userUuid}${file.fileName}`);
		fs.stat(`${playerContentFolder}/${file.userUuid}${file.fileName}`, (err, stats) => {
			if (err == null) {
				console.log(`File ${playerContentFolder}/${file.userUuid}${file.fileName} already exists, wont download`);
			}

			if (err?.code === "ENOENT") {
				downloadContent(`${file.userUuid}${file.fileName}`);
			}
		})
	}
}

function checkCurrentPlaylist({ playlist }) {
	const playlistContentFiles = [];
	for (const item of playlist) {
		const fileUrl = item.url;
		const contentUserUuid = item.userUuid;
		playlistContentFiles.push({
			userUuid: contentUserUuid,
			fileName: fileUrl.split(contentUserUuid)[1],
		});
	}

	removeUnnecessaryFiles(playlistContentFiles);
	downloadNecessaryFiles(playlistContentFiles);

	let baseFolder = process.env.NEXT_PUBLIC_PLAYER_CONTENT_FOLDER;
	//@ts-ignore
	baseFolder = baseFolder.replace("./public", "");

	return playlistContentFiles.map(file => `${baseFolder}/${file.userUuid}${file.fileName}`);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method === 'GET') {
		try {
			const response = await axios.post(
				process.env.NEXT_PUBLIC_SERVER_URL + "/get-drum-playlist-by-ad-object-uuid/" + process.env.NEXT_PUBLIC_AD_OBJECT_UUID,
				{ timestamp: new Date().getTime() },
				{
					headers: {
						"Content-Type": "application/json",
					}
				}
			);

			res.send({
				adObject: response.data.adObject,
				playlist: checkCurrentPlaylist(response.data),
			});
		} catch (error) {
			console.log(error.message);
			res.status(500).json({ error: 'Что-то пошло не так', details: error.message });
		}
	} else {
		res.status(405).json({ error: 'Метод не разрешён' });
	}
}
