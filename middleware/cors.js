const cors = require("cors");

const createCorsOptions = (environment) => {
  if (environment === "production") {
    return {
      origin: "https://dpxa.github.io",
      optionsSuccessStatus: 200,
    };
  } else {
    return {
      origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
      optionsSuccessStatus: 200,
    };
  }
};

module.exports = { createCorsOptions };
