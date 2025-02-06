import fs from "fs";
import {NextApiRequest, NextApiResponse} from "next";
import { v4 as uuidv4 } from 'uuid';
import appRoot from 'app-root-path';
import axios from "axios";

const playerIdFilePath: string = `${appRoot.path}/board_meta/id.txt`;
export const adObjectIdFilePath: string = `${appRoot.path}/board_meta/adObjectUuid.txt`;

function getPlayerId(): string | undefined {
    if (!fs.existsSync(playerIdFilePath)) return;
    return fs.readFileSync(playerIdFilePath, "utf8");
}

async function getAdObjectUuid(deviceUuid: string): Promise<string|undefined> {
    try {
        console.log(`--- checking ${deviceUuid} ---`);
        const { data } = await axios.get(`${process.env.NEXT_PUBLIC_SERVER_URL}/device/get_link/${deviceUuid.trim()}`);
        const adObjectUuid = data.url?.split("uuid=")[1];
        console.log("Ad object uuid from server", adObjectUuid);
        return adObjectUuid;
    } catch(e) {
        console.error("Error getting ad object uuid from server", e);
        return;
    }
}

async function registerPlayer(): Promise<void> {
    const deviceId: string = uuidv4();
    await axios.post(process.env.NEXT_PUBLIC_SERVER_URL + "/device/register", {
        device_id: deviceId,
        temperature: 0,
        cpu_load: 0,
        memory_usage: 0,
        browser_status: "ok"
    });
    console.log("device registered with uuid", deviceId);
    fs.writeFileSync(playerIdFilePath, deviceId.trim(), "utf-8");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
    if (req.method === "GET") {
        const deviceId = getPlayerId();
        if (!deviceId) {
            await registerPlayer();
            res.send("Device registered");
        } else {
            console.log("device already registered with deviceId", deviceId);
            const adObjectId = await getAdObjectUuid(deviceId);
            if (adObjectId) {
                console.log("Writing assigned ad object id to the file...");
                fs.writeFileSync(adObjectIdFilePath, adObjectId);
            } else {
                console.log("No ad object assigned to this device!");
            }

            res.send("Device already registered with deviceId " + deviceId);
        }
    }
}