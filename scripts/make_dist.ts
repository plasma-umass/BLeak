#!/usr/bin/env node
/**
 * Assembles the 'dist' folder for BLeak.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as rimraf from 'rimraf';

const shouldWatch = process.argv.indexOf("--watch") !== -1;
const buildFolder = path.resolve('build');
const distFolder = path.resolve('dist');
const htmlFolder = path.resolve('html');
if (!fs.existsSync(buildFolder)) {
  console.error("Cannot find build folder! Make sure you run this script from the root folder.");
  process.exit(1);
}

function mkdir(dir: string): void {
	try {
		fs.mkdirSync(dir, 0o755);
	} catch(e) {
		if (e.code !== "EEXIST") {
			throw e;
		}
	}
}

async function copyDir(src: string, dest: string): Promise<void> {
	mkdir(dest);
	const files = fs.readdirSync(src);
	let promises: Promise<void>[] = [];
	for (const file of files) {
    const from = path.join(src, file);
    const to = path.join(dest, file);
		const current = fs.lstatSync(from);
		if (current.isDirectory()) {
			promises.push(copyDir(from, to));
		} else if (current.isSymbolicLink()) {
			const symlink = fs.readlinkSync(from);
			fs.symlinkSync(symlink, to);
		} else {
			promises.push(copy(from, to));
		}
	}
	return Promise.all(promises) as Promise<any>;
}

async function copy(src: string, dest: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const oldFile = fs.createReadStream(src);
		const newFile = fs.createWriteStream(dest);
		oldFile.pipe(newFile).on('close', resolve).on('error', reject);
	});
}

async function main(): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		rimraf(distFolder, (err) => {
			if (err) {
				console.error(`Error removing existing dist folder:`);
				console.error(err);
				return reject(err);
			}
			mkdir(distFolder);
			const promises: Promise<void>[] = [];
			promises.push(copyDir(path.join(buildFolder, 'node', 'src'), path.join(distFolder, 'node')));
			promises.push(copyDir(htmlFolder, path.join(distFolder, 'viewer')));

			const viewerSrcFolder = path.join(buildFolder, 'browser');
			['viewer.js', 'viewer.js.map'].forEach((file) => {
				promises.push(copy(path.join(viewerSrcFolder, file), path.join(distFolder, 'viewer', file)));
			});
			promises.push(copy(path.resolve('node_modules', 'd3', 'build', 'd3.min.js'), path.join(distFolder, 'viewer', 'd3.min.js')));
			promises.push(copy(path.resolve('node_modules', 'react-treeview', 'react-treeview.css'), path.join(distFolder, 'viewer', 'react-treeview.css')));

			resolve(Promise.all(promises) as Promise<any>);
		});
	});
}

const WATCH_GRANULARITY = 2000;
function watch(): void {
	let lastChangeTimestamp = 0;
	let isBuilding = false;
	let timer: NodeJS.Timer = null;
	function resetBuilding() {
		console.log(`[make_dist] Finished!`);
		isBuilding = false;
	}
	function timerFunction(timestamp: number) {
		if (lastChangeTimestamp !== timestamp || isBuilding) {
			timer = setTimeout(timerFunction, WATCH_GRANULARITY, lastChangeTimestamp);
		} else {
			timer = null;
			isBuilding = true;
			console.log(`[make_dist] Change detected! Copying files to dist...`)
			main().then(resetBuilding).catch(resetBuilding);
		}
	}

	fs.watch(buildFolder, {
		recursive: true
	}, function() {
		lastChangeTimestamp = Date.now();
		if (!timer) {
			timer = setTimeout(timerFunction, WATCH_GRANULARITY, lastChangeTimestamp);
		}
	});
	timerFunction(lastChangeTimestamp);
}

if (shouldWatch) {
	watch();
} else {
	main();
}
