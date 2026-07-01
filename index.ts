import 'dotenv/config';
import { createServer } from 'node:http';
import { createYoga, createSchema } from 'graphql-yoga';
import { typeDefs } from './src/schema';
import { resolvers } from './src/resolvers';

const schema = createSchema({
  typeDefs,
  resolvers
});

const yoga = createYoga({
  schema,
  graphqlEndpoint: '/graphql'
});

const server = createServer(yoga);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.info(`Server is running on http://localhost:${PORT}/graphql`);
});
