import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();

function roomCode() {
  let code;
  do code = crypto.randomBytes(3).toString("hex").toUpperCase();
  while (rooms.has(code));
  return code;
}

function makePlayer(id, name) {
  return {
    id, name: String(name || "ผู้เล่น").slice(0, 20),
    dice: [1,2,3,4,5].map(() => 1 + Math.floor(Math.random()*6)),
    positions: [
      {x:22,y:30},{x:40,y:30},{x:58,y:30},{x:32,y:58},{x:50,y:58}
    ],
    faceUp: true,
    ws: null
  };
}

function publicState(room, viewerId) {
  return {
    code: room.code,
    players: [...room.players.values()].map(p => ({
      id:p.id, name:p.name, faceUp:p.faceUp,
      // Only reveal dice to the owner when their board is face-down.
      dice: (p.faceUp || p.id === viewerId) ? p.dice : null,
      positions: (p.faceUp || p.id === viewerId) ? p.positions : null
    }))
  };
}

function sendState(room) {
  for (const p of room.players.values()) {
    if (p.ws?.readyState === 1)
      p.ws.send(JSON.stringify({type:"state", state:publicState(room,p.id)}));
  }
}

function sendError(ws, message) {
  ws.send(JSON.stringify({type:"error", message}));
}

wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return sendError(ws,"ข้อมูลไม่ถูกต้อง"); }

    if (msg.type === "create") {
      const code = roomCode();
      const id = crypto.randomUUID();
      const room = {code, players:new Map()};
      const p = makePlayer(id,msg.name);
      p.ws=ws; room.players.set(id,p); rooms.set(code,room);
      ws.playerId=id; ws.roomCode=code;
      return sendState(room);
    }

    if (msg.type === "join") {
      const code=String(msg.code||"").trim().toUpperCase();
      const room=rooms.get(code);
      if (!room) return sendError(ws,"ไม่พบห้องนี้");
      if (room.players.size >= 6) return sendError(ws,"ห้องเต็มแล้ว (สูงสุด 6 คน)");
      const id=crypto.randomUUID(), p=makePlayer(id,msg.name);
      p.ws=ws; room.players.set(id,p); ws.playerId=id; ws.roomCode=code;
      return sendState(room);
    }

    const room=rooms.get(ws.roomCode);
    const me=room?.players.get(ws.playerId);
    if (!room || !me) return sendError(ws,"ยังไม่ได้เข้าห้อง");

    if (msg.type === "flip") {
      me.faceUp = !me.faceUp;
      sendState(room);
    }

    if (msg.type === "shake") {
      me.dice = me.dice.map(() => 1 + Math.floor(Math.random()*6));
      sendState(room);
    }

    if (msg.type === "move") {
      const i=Number(msg.index);
      const x=Math.max(5,Math.min(95,Number(msg.x)));
      const y=Math.max(8,Math.min(92,Number(msg.y)));
      if (Number.isInteger(i) && i>=0 && i<5 && Number.isFinite(x) && Number.isFinite(y)) {
        me.positions[i]={x,y};
        sendState(room);
      }
    }
  });

  ws.on("close",()=>{
    const room=rooms.get(ws.roomCode);
    if (!room) return;
    room.players.delete(ws.playerId);
    if (room.players.size===0) rooms.delete(room.code);
    else sendState(room);
  });
});

const PORT=process.env.PORT || 3000;
server.listen(PORT,()=>console.log(`Dice Bluff running on port ${PORT}`));
