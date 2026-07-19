import 'dotenv/config';
import { createServer } from 'node:http';
import { createYogaInstance } from './src/server';

const yoga = createYogaInstance();
const server = createServer(yoga);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.info(`Server is running on http://localhost:${PORT}/graphql`);
});
