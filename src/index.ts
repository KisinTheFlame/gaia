import http from "node:http";

const port = Number(process.env.PORT ?? 3000);

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ message: "Hello from TypeScript backend" }));
});

server.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
