import AWS from 'aws-sdk';
import fs from 'fs';
import path from 'path';
import type {NextApiRequest, NextApiResponse} from "next";

if (!process.env.NEXT_PUBLIC_AWS_BUCKET_NAME) throw Error("NEXT_PUBLIC_AWS_BUCKET_NAME was not set");
if (!process.env.NEXT_PUBLIC_SPACE_ENDPOINT) throw Error("NEXT_PUBLIC_SPACE_ENDPOINT was not set");
if (!process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID) throw Error("NEXT_PUBLIC_AWS_ACCESS_KEY_ID was not set");
if (!process.env.NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY) throw Error("NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY was not set");
if (!process.env.NEXT_PUBLIC_PLAYER_CONTENT_FOLDER) throw Error("NEXT_PUBLIC_PLAYER_CONTENT_FOLDER was not set");



export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method === 'POST') {
		try {
			const { fileName } = req.body;
			console.log("Filename", fileName);

			const spacesEndpoint = process.env.NEXT_PUBLIC_SPACE_ENDPOINT;
			const s3 = new AWS.S3({
				endpoint: spacesEndpoint,
				accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID,
				secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY,
			});

			// Параметры запроса на скачивание файла
			const params = {
				Bucket: process.env.NEXT_PUBLIC_AWS_BUCKET_NAME,
				Key: "dev/0295efde-f432-4dbe-be98-a73d63751a76/7172249-hd_1080_1920_25fps.mp4.mp4",
			};

			const savePath = path.resolve(playerContentFolder, fileName);
			const fileStream = fs.createWriteStream(savePath);

			//@ts-ignore
			s3.getObject(params)
				.createReadStream()
				.pipe(fileStream)
				.on('close', () => {
					res.status(200).json({ message: `Файл ${fileName} успешно скачан и сохранён.` });
				})
				.on('error', (err) => {
					res.status(500).json({ error: 'Ошибка при скачивании файла', details: err.message });
				});
		} catch (error) {
			//@ts-ignore
			res.status(500).json({ error: 'Что-то пошло не так', details: error.message });
		}
	} else {
		res.status(405).json({ error: 'Метод не разрешён' });
	}
}
