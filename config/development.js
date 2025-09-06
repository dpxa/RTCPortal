module.exports = {
  server: {
    port: 3000,
    cors: {
      origin: "http://localhost:3000",
    },
  },
  socketIO: {
    transports: ["websocket", "polling"],
  },
};
