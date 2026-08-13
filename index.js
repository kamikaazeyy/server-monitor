const Fastify = require('fastify');
const cors = require('@fastify/cors');
const monitor = require('./monitor');

const app = Fastify({ logger: true });

app.register(cors, { origin: '*' });
app.register(monitor);

app.get('/health', async () => ({ status: 'ok', server: 'server-monitor' }));

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';

app.listen({ port, host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Server Monitor running on http://${host}:${port}/monitor`);
});
