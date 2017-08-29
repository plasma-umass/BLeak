import {Server as WebSocketServer} from 'ws';

const wss = new WebSocketServer({ port: 8765 });

wss.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
    console.log('received: %s', message);
    const msg = JSON.parse(<string> message);
    ws.send(JSON.stringify(msg.response));
  });
});