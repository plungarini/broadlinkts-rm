// src/index.ts
import assert from 'assert';
import crypto from 'crypto';
import dgram, { RemoteInfo, Socket } from 'dgram';
import { EventEmitter } from 'events';
import os from 'os';

// RM Devices (without RF support)
const rmDeviceTypes: Record<number, string> = {};
rmDeviceTypes[parseInt(String(0x2737), 16)] = 'Broadlink RM Mini';
rmDeviceTypes[parseInt(String(0x27c7), 16)] = 'Broadlink RM Mini 3 A';
rmDeviceTypes[parseInt(String(0x27c2), 16)] = 'Broadlink RM Mini 3 B';
rmDeviceTypes[parseInt(String(0x27de), 16)] = 'Broadlink RM Mini 3 C';
rmDeviceTypes[parseInt(String(0x5f36), 16)] = 'Broadlink RM Mini 3 D';
rmDeviceTypes[parseInt(String(0x273d), 16)] = 'Broadlink RM Pro Phicomm';
rmDeviceTypes[parseInt(String(0x2712), 16)] = 'Broadlink RM2';
rmDeviceTypes[parseInt(String(0x2783), 16)] = 'Broadlink RM2 Home Plus';
rmDeviceTypes[parseInt(String(0x277c), 16)] = 'Broadlink RM2 Home Plus GDT';
rmDeviceTypes[parseInt(String(0x278f), 16)] = 'Broadlink RM Mini Shate';

// RM Devices (with RF support)
const rmPlusDeviceTypes: Record<number, string> = {};
rmPlusDeviceTypes[parseInt(String(0x272a), 16)] = 'Broadlink RM2 Pro Plus';
rmPlusDeviceTypes[parseInt(String(0x2787), 16)] = 'Broadlink RM2 Pro Plus v2';
rmPlusDeviceTypes[parseInt(String(0x278b), 16)] = 'Broadlink RM2 Pro Plus BL';
rmPlusDeviceTypes[parseInt(String(0x2797), 16)] = 'Broadlink RM2 Pro Plus HYC';
rmPlusDeviceTypes[parseInt(String(0x27a1), 16)] = 'Broadlink RM2 Pro Plus R1';
rmPlusDeviceTypes[parseInt(String(0x27a6), 16)] = 'Broadlink RM2 Pro PP';
rmPlusDeviceTypes[parseInt(String(0x279d), 16)] = 'Broadlink RM3 Pro Plus';
rmPlusDeviceTypes[parseInt(String(0x27a9), 16)] = 'Broadlink RM3 Pro Plus v2'; // (model RM 3422)
rmPlusDeviceTypes[parseInt(String(0x27c3), 16)] = 'Broadlink RM3 Pro';

// Known Unsupported Devices
const unsupportedDeviceTypes: Record<number, string> = {};
unsupportedDeviceTypes[parseInt(String(0), 16)] = 'Broadlink SP1';
unsupportedDeviceTypes[parseInt(String(0x2711), 16)] = 'Broadlink SP2';
unsupportedDeviceTypes[parseInt(String(0x2719), 16)] = 'Honeywell SP2';
unsupportedDeviceTypes[parseInt(String(0x7919), 16)] = 'Honeywell SP2';
unsupportedDeviceTypes[parseInt(String(0x271a), 16)] = 'Honeywell SP2';
unsupportedDeviceTypes[parseInt(String(0x791a), 16)] = 'Honeywell SP2';
unsupportedDeviceTypes[parseInt(String(0x2733), 16)] = 'OEM Branded SP Mini';
unsupportedDeviceTypes[parseInt(String(0x273e), 16)] = 'OEM Branded SP Mini';
unsupportedDeviceTypes[parseInt(String(0x2720), 16)] = 'Broadlink SP Mini';
unsupportedDeviceTypes[parseInt(String(0x7d07), 16)] = 'Broadlink SP Mini';
unsupportedDeviceTypes[parseInt(String(0x753e), 16)] = 'Broadlink SP 3';
unsupportedDeviceTypes[parseInt(String(0x2728), 16)] = 'Broadlink SPMini 2';
unsupportedDeviceTypes[parseInt(String(0x2736), 16)] = 'Broadlink SPMini Plus';
unsupportedDeviceTypes[parseInt(String(0x2714), 16)] = 'Broadlink A1';
unsupportedDeviceTypes[parseInt(String(0x4eb5), 16)] = 'Broadlink MP1';
unsupportedDeviceTypes[parseInt(String(0x2722), 16)] =
	'Broadlink S1 (SmartOne Alarm Kit)';
unsupportedDeviceTypes[parseInt(String(0x4e4d), 16)] =
	'Dooya DT360E (DOOYA_CURTAIN_V2) or Hysen Heating Controller';
unsupportedDeviceTypes[parseInt(String(0x4ead), 16)] =
	'Dooya DT360E (DOOYA_CURTAIN_V2) or Hysen Heating Controller';
unsupportedDeviceTypes[parseInt(String(0x947a), 16)] = 'BroadLink Outlet';

/**
 * Device class.
 * Here it extends EventEmitter for simplicity and typing convenience.
 */
export class Device extends EventEmitter {
	host: RemoteInfo | { address: string; port: number };
	mac: Buffer;
	log: (...args: any[]) => void = console.log;
	debug?: boolean;
	type: number;
	model: string;
	count: number;
	key: Buffer;
	iv: Buffer;
	id: Buffer;
	socket!: Socket;

	// RF methods optional
	enterRFSweep?: () => void;
	checkRFData?: () => void;
	checkRFData2?: () => void;

	constructor(
		host: RemoteInfo | { address: string; port: number },
		macAddress: Buffer,
		deviceType: number,
		port?: number
	) {
		super();
		this.host = host;
		this.mac = macAddress;
		this.type = deviceType;
		this.model =
			rmDeviceTypes[deviceType] || rmPlusDeviceTypes[deviceType] || '';
		this.count = Math.floor(Math.random() * 0xffff) & 0xffff;
		this.key = Buffer.from([
			0x09, 0x76, 0x28, 0x34, 0x3f, 0xe9, 0x9e, 0x23, 0x76, 0x5c, 0x15, 0x13,
			0xac, 0xcf, 0x8b, 0x02,
		]);
		this.iv = Buffer.from([
			0x56, 0x2e, 0x17, 0x99, 0x6d, 0x09, 0x3d, 0x28, 0xdd, 0xb3, 0xba, 0x69,
			0x5a, 0x2e, 0x6f, 0x58,
		]);
		this.id = Buffer.from([0, 0, 0, 0]);

		this.setupSocket();

		const isRFSupported = Boolean(rmPlusDeviceTypes[deviceType]);
		if (isRFSupported) this.addRFSupport();
	}

	setupSocket() {
		const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
		this.socket = socket;

		socket.on('message', (response: Buffer) => {
			const encryptedPayload = Buffer.alloc(
				Math.max(0, response.length - 0x38)
			);
			response.copy(encryptedPayload, 0, 0x38);

			const err = response[0x22] | (response[0x23] << 8);
			if (err !== 0) return;

			const decipher = crypto.createDecipheriv(
				'aes-128-cbc',
				this.key,
				this.iv
			);
			// original code: decipher.setAutoPadding(false)
			// keep parity
			decipher.setAutoPadding(false);
			let payload = decipher.update(encryptedPayload);
			const p2 = decipher.final();
			if (p2) payload = Buffer.concat([payload, p2]);

			if (!payload) return;

			const command = response[0x26];

			if (command === 0xe9) {
				this.key = Buffer.alloc(0x10);
				payload.copy(this.key, 0, 0x04, 0x14);

				this.id = Buffer.alloc(0x04);
				payload.copy(this.id, 0, 0x00, 0x04);

				this.emit('deviceReady');
			} else if (command === 0xee || command === 0xef) {
				this.onPayloadReceived(err, payload);
			} else {
				console.log('Unhandled Command: ', command);
			}
		});

		socket.bind();
	}

	authenticate() {
		const payload = Buffer.alloc(0x50, 0);
		// Fill 0x04..0x12 with ASCII '1'
		for (let i = 0x04; i <= 0x12; i++) payload[i] = 0x31;
		payload[0x1e] = 0x01;
		payload[0x2d] = 0x01;
		payload[0x30] = 'T'.charCodeAt(0);
		payload[0x31] = 'e'.charCodeAt(0);
		payload[0x32] = 's'.charCodeAt(0);
		payload[0x33] = 't'.charCodeAt(0);
		payload[0x34] = ' '.charCodeAt(0);
		payload[0x35] = ' '.charCodeAt(0);
		payload[0x36] = '1'.charCodeAt(0);

		this.sendPacket(0x65, payload);
	}

	sendPacket(command: number, payload: Buffer, debug = false) {
		const { log, socket } = this;
		this.count = (this.count + 1) & 0xffff;

		let packet = Buffer.alloc(0x38, 0);
		packet[0x00] = 0x5a;
		packet[0x01] = 0xa5;
		packet[0x02] = 0xaa;
		packet[0x03] = 0x55;
		packet[0x04] = 0x5a;
		packet[0x05] = 0xa5;
		packet[0x06] = 0xaa;
		packet[0x07] = 0x55;
		packet[0x24] = 0x2a;
		packet[0x25] = 0x27;
		packet[0x26] = command;
		packet[0x28] = this.count & 0xff;
		packet[0x29] = this.count >> 8;
		packet[0x2a] = this.mac[5];
		packet[0x2b] = this.mac[4];
		packet[0x2c] = this.mac[3];
		packet[0x2d] = this.mac[2];
		packet[0x2e] = this.mac[1];
		packet[0x2f] = this.mac[0];
		packet[0x30] = this.id[0];
		packet[0x31] = this.id[1];
		packet[0x32] = this.id[2];
		packet[0x33] = this.id[3];

		let checksum = 0xbeaf;
		for (const byte of payload) {
			checksum += byte;
			checksum = checksum & 0xffff;
		}

		const cipher = crypto.createCipheriv('aes-128-cbc', this.key, this.iv);
		const encrypted = cipher.update(payload);

		packet[0x34] = checksum & 0xff;
		packet[0x35] = checksum >> 8;

		packet = Buffer.concat([packet, encrypted]);

		checksum = 0xbeaf;
		for (let i = 0; i < packet.length; i++) {
			checksum += packet[i];
			checksum = checksum & 0xffff;
		}
		packet[0x20] = checksum & 0xff;
		packet[0x21] = checksum >> 8;

		if (debug && log)
			log('\x1b[33m[DEBUG]\x1b[0m packet', packet.toString('hex'));

		socket.send(
			packet,
			0,
			packet.length,
			(this.host as any).port,
			(this.host as any).address,
			(err) => {
				if (debug && err && log)
					log('\x1b[33m[DEBUG]\x1b[0m send packet error', err);
				if (debug && log) log('\x1b[33m[DEBUG]\x1b[0m successfuly sent packet');
			}
		);
	}

	onPayloadReceived(err: number, payload: Buffer) {
		const param = payload[0];
		switch (param) {
			case 1: {
				const temp = (payload[0x4] * 10 + payload[0x5]) / 10.0;
				this.emit('temperature', temp);
				break;
			}
			case 4: {
				const data = Buffer.alloc(payload.length - 4);
				payload.copy(data, 0, 4);
				this.emit('rawData', data);
				break;
			}
			case 26: {
				const data = Buffer.alloc(1);
				payload.copy(data, 0, 0x4);
				if (data[0] !== 0x1) break;
				this.emit('rawRFData', data);
				break;
			}
			case 27: {
				const data = Buffer.alloc(1);
				payload.copy(data, 0, 0x4);
				if (data[0] !== 0x1) break;
				this.emit('rawRFData2', data);
				break;
			}
		}
	}

	checkData() {
		const packet = Buffer.alloc(16, 0);
		packet[0] = 4;
		this.sendPacket(0x6a, packet);
	}

	sendData(data: Buffer, debug = false) {
		let packet = Buffer.from([0x02, 0x00, 0x00, 0x00]);
		packet = Buffer.concat([packet, data]);
		this.sendPacket(0x6a, packet, debug);
	}

	enterLearning() {
		const packet = Buffer.alloc(16, 0);
		packet[0] = 3;
		this.sendPacket(0x6a, packet);
	}

	checkTemperature() {
		const packet = Buffer.alloc(16, 0);
		packet[0] = 1;
		this.sendPacket(0x6a, packet);
	}

	cancelLearn() {
		const packet = Buffer.alloc(16, 0);
		packet[0] = 0x1e;
		this.sendPacket(0x6a, packet);
	}

	addRFSupport() {
		this.enterRFSweep = () => {
			const packet = Buffer.alloc(16, 0);
			packet[0] = 0x19;
			this.sendPacket(0x6a, packet);
		};
		this.checkRFData = () => {
			const packet = Buffer.alloc(16, 0);
			packet[0] = 0x1a;
			this.sendPacket(0x6a, packet);
		};
		this.checkRFData2 = () => {
			const packet = Buffer.alloc(16, 0);
			packet[0] = 0x1b;
			this.sendPacket(0x6a, packet);
		};
	}
}

/**
 * Broadlink class - discovery and device management.
 */
export class Broadlink extends EventEmitter {
	devices: Record<string, Device | 'Not Supported'> = {};
	sockets: Socket[] = [];
	log?: (...args: any[]) => void;
	debug?: boolean;

	constructor() {
		super();
	}

	discover() {
		// Close existing sockets
		this.sockets.forEach((s) => s.close());
		this.sockets = [];

		const ipAddresses = this.getIPAddresses();
		ipAddresses.forEach((ipAddress) => {
			const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
			this.sockets.push(socket);

			socket.on('listening', () => this.onListening(socket, ipAddress));
			socket.on('message', (msg: Buffer, rinfo: RemoteInfo) =>
				this.onMessage(msg, rinfo)
			);

			socket.bind(0, ipAddress);
		});
	}

	getIPAddresses(): string[] {
		const interfaces = os.networkInterfaces();
		const ipAddresses: string[] = [];

		Object.keys(interfaces).forEach((iface) => {
			const current = interfaces[iface];
			if (!current) return;
			current.forEach((addr) => {
				if (addr.family === 'IPv4' && !addr.internal)
					ipAddresses.push(addr.address);
			});
		});

		return ipAddresses;
	}

	onListening(socket: Socket, ipAddress: string) {
		const { debug, log } = this;
		socket.setBroadcast(true);

		const splitIPAddress = ipAddress.split('.');
		const port = (socket.address() as any).port;
		if (debug && log)
			log(
				`\x1b[35m[INFO]\x1b[0m Listening for Broadlink devices on ${ipAddress}:${port} (UDP)`
			);

		const now = new Date();
		const timezone = now.getTimezoneOffset() / -3600;
		const packet = Buffer.alloc(0x30, 0);

		const year = now.getFullYear();

		if (timezone < 0) {
			packet[0x08] = 0xff + timezone - 1;
			packet[0x09] = 0xff;
			packet[0x0a] = 0xff;
			packet[0x0b] = 0xff;
		} else {
			packet[0x08] = timezone;
			packet[0x09] = 0;
			packet[0x0a] = 0;
			packet[0x0b] = 0;
		}
		packet[0x0c] = year & 0xff;
		packet[0x0d] = year >> 8;
		packet[0x0e] = now.getMinutes();
		packet[0x0f] = now.getHours();

		const subyear = year % 100;
		packet[0x10] = subyear;
		packet[0x11] = now.getDay();
		packet[0x12] = now.getDate();
		packet[0x13] = now.getMonth();
		packet[0x18] = parseInt(splitIPAddress[0], 10);
		packet[0x19] = parseInt(splitIPAddress[1], 10);
		packet[0x1a] = parseInt(splitIPAddress[2], 10);
		packet[0x1b] = parseInt(splitIPAddress[3], 10);
		packet[0x1c] = port & 0xff;
		packet[0x1d] = port >> 8;
		packet[0x26] = 6;

		let checksum = 0xbeaf;
		for (const byte of packet) checksum += byte;
		checksum = checksum & 0xffff;
		packet[0x20] = checksum & 0xff;
		packet[0x21] = checksum >> 8;

		// broadcast
		socket.send(packet, 0, packet.length, 80, '255.255.255.255', () => {});
	}

	onMessage(message: Buffer, host: RemoteInfo) {
		const macAddress = Buffer.alloc(6, 0);
		message.copy(macAddress, 0x00, 0x3d);
		message.copy(macAddress, 0x01, 0x3e);
		message.copy(macAddress, 0x02, 0x3f);
		message.copy(macAddress, 0x03, 0x3c);
		message.copy(macAddress, 0x04, 0x3b);
		message.copy(macAddress, 0x05, 0x3a);

		const key = macAddress.toString('hex');
		if (this.devices[key]) return;

		const deviceType = message[0x34] | (message[0x35] << 8);
		this.addDevice(host, macAddress, deviceType);
	}

	addDevice(
		host: RemoteInfo | { address: string; port: number },
		macAddress: Buffer,
		deviceType: number
	): Device | null {
		const { log, debug } = this;

		if (this.devices[macAddress.toString('hex')]) return null;

		const isHostObjectValid =
			typeof host === 'object' &&
			((host as any).port || (host as any).port === 0) &&
			(host as any).address;
		assert(
			isHostObjectValid,
			`createDevice: host should be an object e.g. { address: '192.168.1.32', port: 80 }`
		);
		assert(macAddress, `createDevice: A unique macAddress should be provided`);
		assert(
			deviceType,
			`createDevice: A deviceType from the rmDeviceTypes or rmPlusDeviceTypes list should be provided`
		);

		this.devices[macAddress.toString('hex')] = 'Not Supported';

		if (unsupportedDeviceTypes[deviceType]) return null;
		if (deviceType >= 0x7530 && deviceType <= 0x7918) return null;

		const isKnownDevice = Boolean(
			rmDeviceTypes[deviceType] || rmPlusDeviceTypes[deviceType]
		);
		if (!isKnownDevice) {
			if (log)
				log(
					`\n\x1b[35m[Info]\x1b[0m We've discovered an unknown Broadlink device. Please raise an issue with code: "${deviceType.toString(
						16
					)}" and IP: "${(host as any).address}".\n`
				);
			return null;
		}

		const device = new Device(host, macAddress, deviceType);
		device.log = log || console.log;
		device.debug = debug;
		(this.devices as any)[macAddress.toString('hex')] = device;

		device.on('deviceReady', () => {
			this.emit('deviceReady', device);
		});

		device.authenticate();
		return device;
	}
}
