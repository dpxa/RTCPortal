module.exports = {
  server: {
    port: process.env.PORT || 3000,
    cors: {
      origin: "https://dpxa.github.io",
    },
  },
  socketIO: {
    transports: ["websocket", "polling"],
  },
};
