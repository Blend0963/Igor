import { WebSocket } from "undici";
import { websocketUrl } from "./exposed-entities.js";

/**
 * One websocket command and its result, for the few Home Assistant APIs that
 * have no REST equivalent (long-term statistics). Opens, authenticates, sends
 * the command, closes. Throws on any failure, with Home Assistant's message
 * when there is one, so a tool can hand it to the model.
 */
export async function wsCommand<T>(baseUrl: string, token: string, command: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
  const url = websocketUrl(baseUrl);
  return new Promise<T>((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      reject(new Error(`Could not open the Home Assistant websocket: ${err instanceof Error ? err.message : err}`));
      return;
    }
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // already closed
      }
      if (error) reject(error);
      else resolve(value as T);
    };
    const timer = setTimeout(() => finish(new Error("Home Assistant did not answer in time")), timeoutMs);
    socket.addEventListener("error", () => finish(new Error("Home Assistant websocket error")));
    socket.addEventListener("close", () => finish(new Error("Home Assistant closed the websocket")));
    socket.addEventListener("message", (event) => {
      let msg: { type?: string; success?: boolean; result?: T; error?: { message?: string } };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return finish(new Error("Home Assistant sent something that is not JSON"));
      }
      if (msg.type === "auth_required") socket.send(JSON.stringify({ type: "auth", access_token: token }));
      else if (msg.type === "auth_ok") socket.send(JSON.stringify({ id: 1, ...command }));
      else if (msg.type === "auth_invalid") finish(new Error("Home Assistant rejected the token"));
      else if (msg.type === "result") {
        if (msg.success === false) finish(new Error(msg.error?.message ?? "Home Assistant refused the command"));
        else finish(undefined, msg.result as T);
      }
    });
  });
}
