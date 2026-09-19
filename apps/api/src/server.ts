import {buildApp} from './app';

const port = Number.parseInt(process.env.API_PORT ?? '4100', 10);
const app = buildApp();

await app.listen({host: '127.0.0.1', port});
