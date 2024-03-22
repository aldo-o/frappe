const { Server } = require("socket.io");
const http = require("node:http");

const fs = require("fs");
const path = require("path");
const { get_conf, get_redis_subscriber } = require("../node_utils");
const conf = get_conf();

const server = http.createServer();

let io = new Server(server, {
	cors: {
		// Should be fine since we are ensuring whether hostname and origin are same before adding setting listeners for s socket
		origin: true,
		credentials: true,
	},
	cleanupEmptyChildNamespaces: true,
});

// Multitenancy implementation.
// allow arbitrary sitename as namespaces
// namespaces get validated during authentication.
const realtime = io.of(/^\/.*$/);

// load and register middlewares
const authenticate = require("./middlewares/authenticate");
realtime.use(authenticate);
// =======================

// load and register handlers
const frappe_handlers = require("./handlers/frappe_handlers");
function on_connection(socket) {
	frappe_handlers(realtime, socket);

	socket.installed_apps.forEach((app) => {
		let file = `../../${app}/realtime/handlers.js`;
		let abs_path = path.resolve(__dirname, file);
		if (fs.existsSync(abs_path)) {
			try {
				let handler_factory = require(file);
				handler_factory(socket);
			} catch (err) {
				console.warn(`failed to load event handlers from ${abs_path}`);
				console.warn(err);
			}
		}
	});

	// ESBUild "open in editor" on error
	socket.on("open_in_editor", async (data) => {
		await subscriber.connect();
		subscriber.publish("open_in_editor", JSON.stringify(data));
	});
}

realtime.on("connection", on_connection);
// =======================

// Consume events sent from python via redis pub-sub channel.
const subscriber = get_redis_subscriber();

(async () => {
	await subscriber.connect();
	subscriber.subscribe("events", (message) => {
		message = JSON.parse(message);
		let namespace = "/" + message.namespace;
		if (message.room) {
			io.of(namespace).to(message.room).emit(message.event, message.message);
		} else {
			// publish to ALL sites only used for things like build event.
			realtime.emit(message.event, message.message);
		}
	});
})();
// =======================

let uds = conf.socketio_uds;
let port = conf.socketio_port;
server.listen(uds || port, () => {
	console.log("Realtime service listening on: ", uds || port);
});
