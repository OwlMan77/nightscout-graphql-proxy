"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_http_1 = require("node:http");
const graphql_yoga_1 = require("graphql-yoga");
const schema_1 = require("./src/schema");
const resolvers_1 = require("./src/resolvers");
const schema = (0, graphql_yoga_1.createSchema)({
    typeDefs: schema_1.typeDefs,
    resolvers: resolvers_1.resolvers
});
const yoga = (0, graphql_yoga_1.createYoga)({
    schema,
    graphqlEndpoint: '/graphql'
});
const server = (0, node_http_1.createServer)(yoga);
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.info(`Server is running on http://localhost:${PORT}/graphql`);
});
