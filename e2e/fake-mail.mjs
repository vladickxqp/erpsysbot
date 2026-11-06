// A mail server for the browser tests: takes every message and shows what it took.
// SMTP on 2526; GET http://127.0.0.1:3326/mails lists the raw messages. A recipient
// starting with "refuse" is turned away, the way a real server refuses a mailbox.
import { createServer as http } from "node:http";
import { createServer as smtp } from "node:net";

const mails = [];

smtp((socket) => {
  let data = false;
  let refused = false;
  let body = [];
  let rest = "";
  socket.write("220 fake ESMTP\r\n");
  socket.on("error", () => {});
  socket.on("data", (chunk) => {
    const rows = (rest + chunk.toString("utf8")).split("\r\n");
    rest = rows.pop();
    for (const row of rows) {
      if (data) {
        if (row === ".") {
          data = false;
          mails.push(body.join("\n"));
          body = [];
          socket.write("250 2.0.0 taken\r\n");
        } else body.push(row);
      } else if (/^(EHLO|HELO)/i.test(row)) socket.write("250 fake\r\n");
      else if (/^RCPT TO:\s*<refuse/i.test(row)) {
        refused = true;
        socket.write("550 5.1.1 mailbox unavailable\r\n");
      } else if (/^(MAIL|RCPT|RSET)/i.test(row)) socket.write("250 ok\r\n");
      else if (/^DATA/i.test(row)) {
        data = !refused;
        socket.write(refused ? "503 no recipients\r\n" : "354 go\r\n");
      } else if (/^QUIT/i.test(row)) socket.end("221 bye\r\n");
      else socket.write("250 ok\r\n");
    }
  });
}).listen(2526, "127.0.0.1");

http((_, response) => {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(mails));
}).listen(3326, "127.0.0.1");
