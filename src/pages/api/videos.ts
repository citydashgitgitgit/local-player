import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
	const { path: requestedPath } = req.query;

	if (!requestedPath || Array.isArray(requestedPath)) {
		res.status(400).json({ error: 'Invalid path parameter' });
		return;
	}

	const videoPath = requestedPath.split("?")[0];

	if (!fs.existsSync(videoPath)) {
		console.log("NOT FOUND", videoPath);
		res.status(404).json({ error: 'File not found' });
		return;
	}

	const stat = fs.statSync(videoPath);
	const fileSize = stat.size;
	const range = req.headers.range;

	if (range) {
		const parts = range.replace(/bytes=/, '').split('-');
		const start = parseInt(parts[0], 10);
		const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

		if (start >= fileSize) {
			res.writeHead(416, {
				'Content-Range': `bytes */${fileSize}`,
			});
			res.end();
			return;
		}

		const chunkSize = (end - start) + 1;
		const fileStream = fs.createReadStream(videoPath, { start, end });

		res.writeHead(206, {
			'Content-Range': `bytes ${start}-${end}/${fileSize}`,
			'Accept-Ranges': 'bytes',
			'Content-Length': chunkSize,
			'Content-Type': 'video/mp4',
		});

		fileStream.pipe(res);
	} else {
		res.writeHead(200, {
			'Content-Length': fileSize,
			'Content-Type': 'video/mp4',
		});

		fs.createReadStream(videoPath).pipe(res);
	}
}
