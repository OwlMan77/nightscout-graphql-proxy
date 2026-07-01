require('dotenv').config();
const { createServer } = require('node:http');
const { createYoga, createSchema } = require('graphql-yoga');
const { typeDefs } = require('./src/schema');
const { resolvers } = require('./src/resolvers');

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
