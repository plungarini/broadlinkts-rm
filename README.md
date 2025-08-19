# BroadlinkJS RM (TypeScript)

## Overview

This package is a **TypeScript port** of the popular [broadlinkjs-rm](https://github.com/lprhodes/broadlinkjs-rm) library by [@lprhodes](https://github.com/lprhodes).  
It provides an easy way to **discover and control Broadlink RM devices** (IR and RF) directly from Node.js applications, now with full type definitions out of the box.

## Features

- 📡 Discover Broadlink RM devices on your local network
- 🎛️ Send and learn **IR and RF commands**
- 🌡️ Read temperature data (on supported devices)
- ✅ Written in **TypeScript** with complete typings
- ⚡ Drop-in replacement for `broadlinkjs-rm` with the same API

## Installation

```bash
npm install broadlinkjs-rm-ts
```

## Usage

```ts
import Broadlink from 'broadlinkjs-rm-ts';

// Create a Broadlink instance
const broadlink = new Broadlink();

// Start discovering devices on the local network
broadlink.discover();

// When a device is found and ready to use
broadlink.on('deviceReady', (device) => {
	console.log('✅ Device discovered:', device.host);

	// Put the device into learning mode
	device.enterLearning();

	// Listen for learned IR/RF codes
	device.on('rawData', (data: Buffer) => {
		console.log('📡 Learned code:', data.toString('hex'));
	});
});
```

## Credits

This project is a TypeScript adaptation of the excellent work by [@lprhodes](https://github.com/lprhodes) in [broadlinkjs-rm](https://github.com/lprhodes/broadlinkjs-rm).

It also builds upon the research and contributions of:

- [@momodalo](https://github.com/momodalo) with [broadlinkjs](https://github.com/momodalo/broadlinkjs)
- [@mjg59](https://github.com/mjg59) with [python-broadlink](https://github.com/mjg59/python-broadlink)

Huge thanks to all of them for laying the foundation of Broadlink support in the open-source community.
