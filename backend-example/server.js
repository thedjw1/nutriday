const runtime = require('./server_complete');

if (require.main === module) {
  runtime
    .getBootstrap()
    .then(({ startServer }) => startServer())
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = runtime;
